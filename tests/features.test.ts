// Hack pages, admin helpers, search, translation and the X bot, against an
// in-process Postgres and fake external APIs.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = 54332;
const EXPLOITER = "0xb66cd966670d962c227b3eaba30a872dbfb995db"; // Euler Finance Exploiter 2 in the seed labels
const TEAM = "0x" + "e1".repeat(20);
const hex = (s: string) => "0x" + Buffer.from(s, "utf8").toString("hex");
const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");
let txn = 1;
const txh = () => "0x" + (txn++).toString(16).padStart(64, "0");

let pg: PGlite;
let server: PGLiteSocketServer;
let fake: http.Server;
const xRequests: { auth: string; body: string }[] = [];

beforeAll(async () => {
  pg = await PGlite.create();
  server = new PGLiteSocketServer({ db: pg, port: PORT, host: "127.0.0.1", maxConnections: 10 });
  await server.start();

  fake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/messages") {
        const text: string = JSON.parse(body).messages[0].content;
        const reply = text.includes("请")
          ? '{"language": "Chinese", "translation": "Please return the funds, we can talk"}'
          : '{"language": "English", "translation": null}';
        res.end(JSON.stringify({ content: [{ type: "text", text: reply }] }));
        return;
      }
      if (req.url === "/2/tweets") {
        xRequests.push({ auth: String(req.headers.authorization), body });
        res.end(JSON.stringify({ data: { id: String(1000 + xRequests.length) } }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  const port = (fake.address() as AddressInfo).port;

  process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${PORT}/postgres`;
  process.env.DATABASE_POOL_SIZE = "1";
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${port}/v1/messages`;
  process.env.X_API_URL = `http://127.0.0.1:${port}/2/tweets`;
  process.env.SITE_URL = "https://chainmail.example";

  const { ensureSetup } = await import("../lib/setup");
  await ensureSetup();

  const { extractMessage } = await import("../lib/extract");
  const { insertMessages } = await import("../lib/store");
  const old = new Date("2023-03-15T00:00:00Z");
  const now = new Date();
  const rows = [
    // The negotiation
    { from: TEAM, to: EXPLOITER, text: "We are the Euler team. Return 90% and keep 10% as a bounty.", at: old },
    { from: EXPLOITER, to: TEAM, text: "We want to make this easy on all those affected.", at: old },
    { from: EXPLOITER, to: EXPLOITER, text: "To the world: I was wrong.", at: old },
    // The crowd
    { from: addr(1), to: EXPLOITER, text: "please send me 1 eth", at: old },
    { from: addr(2), to: EXPLOITER, text: "请把资金还回来，我们可以谈", at: old },
    { from: addr(3), to: EXPLOITER, text: "https://x.com/someone", at: old }, // link only: spam
    // A message with a literal percent sign
    { from: addr(4), to: addr(5), text: "I'll take 15% and walk away", at: old },
  ].map((r) =>
    extractMessage({
      hash: txh(), blockNumber: 16_800_000 + txn, blockTime: r.at, index: 0,
      from: r.from, to: r.to, value: 0n, input: hex(r.text),
    })!,
  );
  // A fresh pile-on: 9 strangers writing to one new address today
  for (let i = 0; i < 9; i++) {
    rows.push(extractMessage({
      hash: txh(), blockNumber: 23_000_000 + txn, blockTime: now, index: 0,
      from: addr(100 + i), to: addr(999), value: 0n, input: hex(`give it back you thief, message ${i}`),
    })!);
  }
  await insertMessages(rows);
});

afterAll(async () => {
  const { db } = await import("../lib/db");
  await db().end();
  await server.stop();
  await pg.close();
  fake.close();
});

describe("labels and incidents", () => {
  it("seeds incidents and ties exploiters to them", async () => {
    const { db } = await import("../lib/db");
    const [euler] = await db()`select incident from labels where address = ${EXPLOITER}`;
    expect(euler.incident).toBe("euler");
    const [{ n }] = await db()`select count(*)::int as n from incidents`;
    expect(n).toBeGreaterThanOrEqual(10);
  });

  it("suggests the address that wrote to the exploiter and got a reply", async () => {
    const { teamSuggestions } = await import("../lib/admin");
    const s = await teamSuggestions();
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ address: TEAM, incident: "euler", wrote: 1, got: 1 });
  });

  it("builds the hack page once the team is labeled", async () => {
    const { saveLabel } = await import("../lib/admin");
    const { getIncident, getCrowd, listIncidents } = await import("../lib/incidents");
    await saveLabel({ address: TEAM, name: "Euler team", kind: "protocol", incident: "euler" });

    const data = (await getIncident("euler"))!;
    expect(data.core.map((m) => m.body)).toEqual([
      "We are the Euler team. Return 90% and keep 10% as a bounty.",
      "We want to make this easy on all those affected.",
      "To the world: I was wrong.",
    ]);
    expect(data.crowdCount).toBe(2); // the link-only ad is spam
    expect((await getCrowd("euler", 0)).length).toBe(2);

    const list = await listIncidents();
    expect(list[0]).toMatchObject({ slug: "euler", core: 3, crowd: 2, team: 1 });
  });

  it("makes stable slugs", async () => {
    const { slugify } = await import("../lib/admin");
    expect(slugify("Bybit (Feb 2025)")).toBe("bybit-feb-2025");
  });
});

describe("new hack flags", () => {
  it("flags an address many strangers just wrote to", async () => {
    const { hackFlags } = await import("../lib/admin");
    const flags = await hackFlags();
    expect(flags.map((f) => f.address)).toEqual([addr(999)]);
    expect(flags[0].senders).toBe(9);
    expect(flags[0].samples).toHaveLength(3);
  });
});

describe("search", () => {
  it("finds text and treats % literally", async () => {
    const { searchMessages, searchLabels } = await import("../lib/queries");
    expect((await searchMessages("bounty")).map((m) => m.from_addr)).toEqual([TEAM]);
    expect((await searchMessages("15%")).length).toBe(1);
    expect((await searchMessages("%")).map((m) => m.body)).toEqual(
      expect.arrayContaining(["I'll take 15% and walk away"]),
    );
    expect((await searchLabels("euler")).map((l) => l.name)).toContain("Euler Finance Exploiter 2");
  });
});

describe("translation", () => {
  it("does nothing without a key", async () => {
    const { translatePending } = await import("../lib/translate");
    delete process.env.ANTHROPIC_API_KEY;
    expect(await translatePending()).toEqual({ translated: 0, skipped: 0, errors: 0 });
  });

  it("translates non-English messages and skips English ones", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { translatePending } = await import("../lib/translate");
    const { db } = await import("../lib/db");
    await translatePending(50);
    const [zh] = await db()`select lang, translation from messages where body like '请%'`;
    expect(zh).toEqual({ lang: "Chinese", translation: "Please return the funds, we can talk" });
    const [en] = await db()`select lang, translation from messages where body like 'We are the Euler%'`;
    expect(en).toEqual({ lang: "English", translation: null });
  });

  it("reads the model's JSON even with extra text around it", async () => {
    const { parseTranslation } = await import("../lib/translate");
    expect(parseTranslation('Sure: {"language":"Russian","translation":"hello"}')).toEqual({
      language: "Russian",
      translation: "hello",
    });
    expect(parseTranslation("no json")).toBeNull();
  });
});

describe("X bot", () => {
  it("matches the OAuth 1.0a signature example from X's docs", async () => {
    const { oauthSignature } = await import("../lib/x");
    const sig = oauthSignature(
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json",
      {
        status: "Hello Ladies + Gentlemen, a signed OAuth request!",
        include_entities: "true",
        oauth_consumer_key: "xvz1evFS4wEEPTGEFPHBog",
        oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: "1318622958",
        oauth_token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        oauth_version: "1.0",
      },
      "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
      "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    );
    expect(sig).toBe("hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
  });

  it("keeps posts within 280 characters counting the link as 23", async () => {
    const { composePost } = await import("../lib/x");
    const post = composePost("Euler Finance Exploiter 2 wrote to Euler team onchain:", "x".repeat(1000), "https://chainmail.example/hacks/euler");
    const counted = post.length - "https://chainmail.example/hacks/euler".length + 23;
    expect(counted).toBeLessThanOrEqual(280);
    expect(post.endsWith("https://chainmail.example/hacks/euler")).toBe(true);
  });

  it("posts fresh exploiter and team messages once, and ignores old ones", async () => {
    const { announceNew } = await import("../lib/announce");
    const { extractMessage } = await import("../lib/extract");
    const { insertMessages } = await import("../lib/store");
    const keys = { apiKey: "k", apiSecret: "s", accessToken: "t", accessSecret: "ts" };

    // Everything so far is from 2023, so nothing to post.
    expect(await announceNew(keys)).toEqual({ posted: 0, errors: [] });

    await insertMessages([
      extractMessage({
        hash: txh(), blockNumber: 23_100_000, blockTime: new Date(), index: 0,
        from: EXPLOITER, to: TEAM, value: 0n, input: hex("Sending back 3000 ETH now."),
      })!,
    ]);
    expect(await announceNew(keys)).toEqual({ posted: 1, errors: [] });
    expect(await announceNew(keys)).toEqual({ posted: 0, errors: [] });

    expect(xRequests).toHaveLength(1);
    expect(xRequests[0].auth).toMatch(/^OAuth oauth_consumer_key="k", oauth_nonce="[0-9a-f]+", oauth_signature="/);
    const text = JSON.parse(xRequests[0].body).text as string;
    expect(text).toContain("Euler Finance Exploiter 2 wrote to Euler team onchain:");
    expect(text).toContain("Sending back 3000 ETH now.");
    expect(text).toContain("https://chainmail.example/hacks/euler");
  });

  it("does nothing without keys", async () => {
    const { announceNew } = await import("../lib/announce");
    expect(await announceNew(null)).toEqual({ posted: 0, errors: [] });
  });
});

describe("admin session", () => {
  it("checks the secret and never stores it in the cookie", async () => {
    process.env.ADMIN_SECRET = "correct horse";
    const { checkSecret, sessionToken } = await import("../lib/admin");
    expect(checkSecret("correct horse")).toBe(true);
    expect(checkSecret("wrong")).toBe(false);
    expect(sessionToken("correct horse")).not.toContain("horse");
    expect(sessionToken("correct horse")).toMatch(/^[0-9a-f]{64}$/);
  });
});
