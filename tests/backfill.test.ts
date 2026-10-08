// Backfill against a fake JSON-RPC node and a fake Blockscout API, with an
// in-process Postgres.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = 54331;
const HEAD = 1_000_000;
const EXPLOITER = "0xb66cd966670d962c227b3eaba30a872dbfb995db";
const h = (n: number, w = 64) => "0x" + n.toString(16).padStart(w, "0");
const msg = (s: string) => "0x" + Buffer.from(s).toString("hex");

let pg: PGlite;
let server: PGLiteSocketServer;
let fake: http.Server;
let rpcCalls = 0;
const limitOnce = new Set<number>(); // blocks that answer "rate limited" the first time

function block(n: number) {
  const txs = [
    { input: n % 100 === 0 ? msg(`note in block ${n}`) : "0x", to: h(0xb0b, 40) },
    { input: "0xa9059cbb" + "00".repeat(64), to: h(0xc0de, 40) },
  ];
  return {
    number: h(n, 1),
    timestamp: h(1_700_000_000 + n * 12, 1),
    transactions: txs.map((t, i) => ({
      hash: h(n * 10 + i), transactionIndex: h(i, 1), from: h(0xa11ce, 40), to: t.to, value: "0x0", input: t.input,
    })),
  };
}

beforeAll(async () => {
  pg = await PGlite.create();
  server = new PGLiteSocketServer({ db: pg, port: PORT, host: "127.0.0.1", maxConnections: 10 });
  await server.start();

  fake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/api?")) {
        // Blockscout txlist: one page with a protocol message to the exploiter.
        const page = new URL(req.url, "http://x").searchParams.get("page");
        const result = page === "1"
          ? [
              { hash: h(1), blockNumber: "16800000", timeStamp: "1678700000", transactionIndex: "3",
                from: h(0xe11e, 40), to: EXPLOITER, value: "0", input: msg("We'd like to talk about returning the funds.") },
              { hash: h(2), blockNumber: "16800010", timeStamp: "1678700120", transactionIndex: "1",
                from: EXPLOITER, to: h(0xe11e, 40), value: "0", input: "0x" },
            ]
          : [];
        res.end(JSON.stringify({ status: result.length ? "1" : "0", message: result.length ? "OK" : "No transactions found", result }));
        return;
      }
      const p = JSON.parse(body);
      const one = (r: { id: number; method: string; params: string[] }) => {
        rpcCalls++;
        const n = r.method === "eth_getBlockByNumber" ? parseInt(r.params[0], 16) : -1;
        if (limitOnce.delete(n)) {
          return { jsonrpc: "2.0", id: r.id, error: { code: 429, message: "Your app has exceeded its compute units per second capacity." } };
        }
        return { jsonrpc: "2.0", id: r.id, result: r.method === "eth_blockNumber" ? h(HEAD, 1) : block(parseInt(r.params[0], 16)) };
      };
      res.end(JSON.stringify(Array.isArray(p) ? p.map(one) : one(p)));
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  const port = (fake.address() as AddressInfo).port;

  process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${PORT}/postgres`;
  process.env.DATABASE_POOL_SIZE = "1";
  process.env.ETH_RPC_URL = `http://127.0.0.1:${port}/`;
  process.env.BLOCKSCOUT_API = `http://127.0.0.1:${port}/api`;
  process.env.BLOCKSCOUT_GAP_MS = "0";
});

afterAll(async () => {
  const { db } = await import("../lib/db");
  await db().end();
  await server.stop();
  await pg.close();
  fake.close();
});

describe("backfillRecent", () => {
  it("walks backwards in chunks until it reaches the target", async () => {
    const { db } = await import("../lib/db");
    const { ensureSetup } = await import("../lib/setup");
    await ensureSetup();
    await db()`insert into sync_state (key, value) values ('eth_last_block', ${HEAD - 2})`;

    const { backfillRecent } = await import("../lib/backfill");
    // 1 day = 7,200 blocks; 3,000 per call means 3 calls.
    const a = await backfillRecent(1, 3000);
    expect(a).toMatchObject({ scannedTo: String(HEAD - 3), scannedFrom: String(HEAD - 3002), blocks: 3000 });
    expect(a.found).toBe(30); // one note every 100 blocks
    const b = await backfillRecent(1, 3000);
    const c = await backfillRecent(1, 3000);
    expect(c.remaining).toBe("0");
    expect(c.scannedFrom).toBe(String(HEAD - 7200));
    const d = await backfillRecent(1, 3000);
    expect(d.blocks).toBe(0);

    const [{ n }] = await db()`select count(*)::int as n from messages`;
    expect(n).toBe(a.found + b.found + c.found);
    expect(rpcCalls).toBeGreaterThan(700);
  });
});

describe("backfillLabels", () => {
  it("pulls exploiter history from Blockscout", async () => {
    const { backfillLabels } = await import("../lib/backfill");
    const { getFeed } = await import("../lib/queries");
    const r = await backfillLabels({ restart: true });
    expect(r.errors).toEqual([]);
    expect(r.remaining).toBe(0);
    expect(r.addresses).toBe(17);
    expect(r.found).toBe(17); // the fake API answers the same for every address
    expect(r.inserted).toBe(1);
    const hacks = await getFeed("hacks");
    expect(hacks.map((m) => m.body)).toEqual(["We'd like to talk about returning the funds."]);
    expect(hacks[0].to_name).toBe("Euler Finance Exploiter 2");
  });
});

describe("backfillLabels resuming", () => {
  it("does one address per call when out of time, then picks up where it stopped", async () => {
    const { backfillLabels } = await import("../lib/backfill");
    const first = await backfillLabels({ restart: true, budgetMs: 0 });
    expect(first).toMatchObject({ addresses: 17, done: 1, remaining: 16 });
    const second = await backfillLabels({ budgetMs: 0 });
    expect(second).toMatchObject({ done: 2, remaining: 15 });
    const rest = await backfillLabels();
    expect(rest).toMatchObject({ done: 17, remaining: 0 });
    const after = await backfillLabels();
    expect(after).toMatchObject({ done: 17, remaining: 0, found: 0 });
  });
});

describe("rpcBlocks", () => {
  it("retries blocks the provider rate-limited inside a batch", async () => {
    const { rpcBlocks } = await import("../lib/rpc");
    limitOnce.add(500_001);
    limitOnce.add(500_003);
    const blocks = await rpcBlocks(process.env.ETH_RPC_URL!, [500_000n, 500_001n, 500_002n, 500_003n]);
    expect(blocks.map((b) => parseInt(b.number, 16))).toEqual([500_000, 500_001, 500_002, 500_003]);
    expect(limitOnce.size).toBe(0);
  });
});
