// Runs the real schema, inserts, spam sweep and feed queries against an
// in-process Postgres (PGlite), so no database server is needed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = 54329;
const hex = (s: string) => "0x" + Buffer.from(s, "utf8").toString("hex");
const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const txh = (n: number) => "0x" + n.toString(16).padStart(64, "0");

const EXPLOITER = "0xb66cd966670d962c227b3eaba30a872dbfb995db";
const PROTOCOL = addr(0xeee);

let pg: PGlite;
let server: PGLiteSocketServer;

beforeAll(async () => {
  pg = await PGlite.create();
  server = new PGLiteSocketServer({ db: pg, port: PORT, host: "127.0.0.1", maxConnections: 10 });
  await server.start();
  process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${PORT}/postgres`;
  // PGlite is single-threaded and mixes up parallel connections; real Postgres doesn't.
  process.env.DATABASE_POOL_SIZE = "1";
  process.env.CRON_SECRET = "cron-secret";
  process.env.ADMIN_SECRET = "admin-secret";

  const { db } = await import("../lib/db");
  const { applySchema } = await import("../lib/setup");
  await applySchema();
  await db()`insert into labels (address, name, kind) values
    (${EXPLOITER}, 'Euler Finance Exploiter 2', 'exploiter'),
    (${PROTOCOL}, 'Acme Protocol', 'protocol')`;
});

afterAll(async () => {
  const { db } = await import("../lib/db");
  await db().end();
  await server.stop();
  await pg.close();
});

async function seed() {
  const { extractMessage } = await import("../lib/extract");
  const { insertMessages } = await import("../lib/store");
  const t = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n));
  const raw = [
    // A negotiation: protocol writes, exploiter replies, protocol answers.
    { n: 1, from: PROTOCOL, to: EXPLOITER, text: "Return 90% and keep 10% as a bounty. security@acme.xyz", value: 0n },
    { n: 2, from: EXPLOITER, to: PROTOCOL, text: "I want to talk. Give me 48 hours.", value: 10n ** 16n },
    { n: 3, from: PROTOCOL, to: EXPLOITER, text: "Agreed. Clock starts now.", value: 0n },
    // An ordinary message between strangers.
    { n: 4, from: addr(1), to: addr(2), text: "gm, happy birthday 🎂", value: 0n },
    // A contract call that must be ignored.
    { n: 5, from: addr(3), to: addr(4), text: null, value: 0n },
    // Phishing.
    { n: 6, from: addr(5), to: addr(6), text: "Claim your airdrop now at https://drop-claim.xyz", value: 0n },
  ];
  // One sender spraying the same text at 12 addresses.
  for (let i = 0; i < 12; i++) {
    raw.push({ n: 100 + i, from: addr(7), to: addr(1000 + i), text: "hey, check your wallet, I sent you something", value: 0n });
  }

  const rows = raw
    .map((r) =>
      extractMessage({
        hash: txh(r.n),
        blockNumber: 21_000_000 + r.n,
        blockTime: t(r.n),
        index: 0,
        from: r.from,
        to: r.to,
        value: r.value,
        input: r.text === null ? "0xa9059cbb" + "00".repeat(64) : hex(r.text),
      }),
    )
    .filter((x) => x !== null);
  return { inserted: await insertMessages(rows), found: rows.length };
}

describe("database flow", () => {
  it("inserts messages and skips duplicates", async () => {
    const first = await seed();
    expect(first.found).toBe(17); // contract call dropped
    expect(first.inserted).toBe(17);
    const again = await seed();
    expect(again.inserted).toBe(0);
  });

  it("marks copy-paste blasts as spam", async () => {
    const { sweepSpam } = await import("../lib/spam-sweep");
    const marked = await sweepSpam([addr(7)]);
    expect(marked).toBe(12);
  });

  it("shows only visible messages, newest first", async () => {
    const { getFeed } = await import("../lib/queries");
    const feed = await getFeed("all");
    expect(feed.map((m) => m.body)).toEqual([
      "gm, happy birthday 🎂",
      "Agreed. Clock starts now.",
      "I want to talk. Give me 48 hours.",
      "Return 90% and keep 10% as a bounty. security@acme.xyz",
    ]);
    const negotiation = feed.find((m) => m.body.startsWith("Agreed"))!;
    expect(negotiation.thread_count).toBe(3);
    expect(negotiation.to_name).toBe("Euler Finance Exploiter 2");
    expect(negotiation.to_kind).toBe("exploiter");
  });

  it("filters to hacks and pages with a cursor", async () => {
    const { getFeed, cursorOf } = await import("../lib/queries");
    const hacks = await getFeed("hacks");
    expect(hacks).toHaveLength(3);
    const older = await getFeed("hacks", cursorOf(hacks[0]));
    expect(older.map((m) => m.body)).toEqual(hacks.slice(1).map((m) => m.body));
  });

  it("returns a thread in order regardless of address order", async () => {
    const { getThread } = await import("../lib/queries");
    const thread = await getThread(EXPLOITER.toUpperCase().replace("0X", "0x"), PROTOCOL);
    expect(thread.map((m) => m.from_addr)).toEqual([PROTOCOL, EXPLOITER, PROTOCOL]);
    expect(thread[1].value_wei).toBe("10000000000000000");
  });

  it("lists an address's messages", async () => {
    const { getAddressMessages, getLabel } = await import("../lib/queries");
    expect((await getAddressMessages(EXPLOITER)).length).toBe(3);
    expect(await getLabel(EXPLOITER)).toEqual({ name: "Euler Finance Exploiter 2", kind: "exploiter" });
  });

  it("lets a moderator hide a message", async () => {
    const { POST } = await import("../app/api/admin/hide/route");
    const denied = await POST(new Request("http://x/api/admin/hide", { method: "POST", body: "{}" }));
    expect(denied.status).toBe(401);

    const res = await POST(
      new Request("http://x/api/admin/hide", {
        method: "POST",
        headers: { authorization: "Bearer admin-secret" },
        body: JSON.stringify({ tx_hash: txh(4), status: "hidden" }),
      }),
    );
    expect(res.status).toBe(200);
    const { getFeed } = await import("../lib/queries");
    expect((await getFeed("all")).some((m) => m.tx_hash === txh(4))).toBe(false);
  });

  it("rejects the cron endpoint without the secret", async () => {
    const { GET } = await import("../app/api/cron/ingest/route");
    const res = await GET(new Request("http://x/api/cron/ingest"));
    expect(res.status).toBe(401);
  });
});

describe("first-run setup", () => {
  it("creates tables and loads labels on an empty database", async () => {
    const { db } = await import("../lib/db");
    const { ensureSetup, allLabels } = await import("../lib/setup");
    await db().unsafe("drop table messages; drop table labels; drop table sync_state");
    await ensureSetup();
    const [{ n }] = await db()`select count(*)::int as n from labels`;
    expect(n).toBe(allLabels().length);
    expect(n).toBeGreaterThan(400);
  });
});

describe("repeat rule", () => {
  it("keeps the first copy when a sender repeats a message to the same address", async () => {
    const { db } = await import("../lib/db");
    const { extractMessage } = await import("../lib/extract");
    const { insertMessages } = await import("../lib/store");
    const { sweepSpam } = await import("../lib/spam-sweep");
    const hexOf = (s: string) => "0x" + Buffer.from(s, "utf8").toString("hex");
    const rows = [1, 2, 3].map((i) =>
      extractMessage({
        hash: "0x" + (0xdead00 + i).toString(16).padStart(64, "0"),
        blockNumber: 30_000_000 + i, blockTime: new Date(), index: 0,
        from: "0x" + "9".repeat(40), to: "0x" + "8".repeat(40), value: 0n,
        input: hexOf("send me some ETH, pls"),
      })!,
    );
    await insertMessages(rows);
    expect(await sweepSpam(["0x" + "9".repeat(40)])).toBe(2);
    const visible = await db()`select tx_hash from messages where from_addr = ${"0x" + "9".repeat(40)} and status = 'visible'`;
    expect(visible.map((r) => r.tx_hash)).toEqual([rows[0].tx_hash]);
  });
});
