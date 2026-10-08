import { db } from "./db";
import { extractMessage, type MessageRow } from "./extract";
import { rpcBlockNumber, rpcBlocks, type RpcBlock } from "./rpc";
import { getCursor, insertMessages } from "./store";
import { sweepSpam } from "./spam-sweep";
import { ensureSetup } from "./setup";

// ---------------------------------------------------------------------------
// Recent history: walks backwards from where the live indexer started, block
// by block, until it reaches `days` ago. Progress is kept in sync_state, so
// each call picks up where the last one stopped.
// ---------------------------------------------------------------------------

const LOW_KEY = "eth_backfill_low"; // lowest block already scanned
const BLOCKS_PER_DAY = 7200n; // 12-second blocks
const BATCH = 10; // blocks per RPC batch request

export type BackfillResult = {
  scannedFrom: string | null;
  scannedTo: string | null;
  blocks: number;
  found: number;
  inserted: number;
  remaining: string;
};

export function messagesFromRpcBlock(block: RpcBlock): MessageRow[] {
  const blockNumber = BigInt(block.number);
  const blockTime = new Date(Number(BigInt(block.timestamp)) * 1000);
  const rows: MessageRow[] = [];
  for (const tx of block.transactions) {
    // Cheap pre-check before decoding: plain transfers and tiny calls can't be messages.
    if (!tx.to || !tx.input || tx.input.length < 6) continue;
    const row = extractMessage({
      hash: tx.hash,
      blockNumber,
      blockTime,
      index: Number(BigInt(tx.transactionIndex)),
      from: tx.from,
      to: tx.to,
      value: BigInt(tx.value).toString(),
      input: tx.input,
    });
    if (row) rows.push(row);
  }
  return rows;
}

async function getState(key: string): Promise<bigint | null> {
  const rows = await db()`select value from sync_state where key = ${key}`;
  return rows.length ? BigInt(rows[0].value) : null;
}

async function setState(key: string, value: bigint): Promise<void> {
  await db()`
    insert into sync_state (key, value) values (${key}, ${value.toString()})
    on conflict (key) do update set value = excluded.value`;
}

export async function backfillRecent(days: number, maxBlocks: number): Promise<BackfillResult> {
  await ensureSetup();
  const url = process.env.ETH_RPC_URL;
  if (!url) throw new Error("ETH_RPC_URL is not set");

  const head = await rpcBlockNumber(url);
  const target = head - BLOCKS_PER_DAY * BigInt(days);

  let low = await getState(LOW_KEY);
  if (low === null) {
    // Start just below wherever the live indexer is; it covers everything above.
    low = (await getCursor()) ?? head;
  }
  if (low <= target) {
    return { scannedFrom: null, scannedTo: null, blocks: 0, found: 0, inserted: 0, remaining: "0" };
  }

  const top = low - 1n;
  const bottom = top - BigInt(maxBlocks) + 1n > target ? top - BigInt(maxBlocks) + 1n : target;
  const numbers: bigint[] = [];
  for (let n = top; n >= bottom; n--) numbers.push(n);

  // A few batches in flight at once; stays well under typical RPC rate limits.
  const rows: MessageRow[] = [];
  const PARALLEL = 3;
  for (let i = 0; i < numbers.length; i += BATCH * PARALLEL) {
    const groups: bigint[][] = [];
    for (let j = 0; j < PARALLEL; j++) {
      const g = numbers.slice(i + j * BATCH, i + (j + 1) * BATCH);
      if (g.length) groups.push(g);
    }
    const results = await Promise.all(groups.map((g) => rpcBlocks(url, g)));
    for (const blocks of results) for (const b of blocks) rows.push(...messagesFromRpcBlock(b));
  }

  const inserted = await insertMessages(rows);
  const senders = [...new Set(rows.map((r) => r.from_addr))];
  if (senders.length) await sweepSpam(senders);
  await setState(LOW_KEY, bottom);

  return {
    scannedFrom: bottom.toString(),
    scannedTo: top.toString(),
    blocks: numbers.length,
    found: rows.length,
    inserted,
    remaining: (bottom - target > 0n ? bottom - target : 0n).toString(),
  };
}

// ---------------------------------------------------------------------------
// Labeled addresses: pulls the full transaction history of every exploiter
// from Blockscout's free API (no key needed) and keeps the messages. This is
// what fills the hacks tab with old negotiations.
// ---------------------------------------------------------------------------

const BLOCKSCOUT = process.env.BLOCKSCOUT_API ?? "https://eth.blockscout.com/api";
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;
// Blockscout's free API rate-limits hard. Space requests out.
const SCOUT_GAP_MS = Number(process.env.BLOCKSCOUT_GAP_MS ?? 1500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastScoutCall = 0;

type ScoutTx = {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  transactionIndex: string;
  from: string;
  to: string;
  value: string;
  input: string;
};

async function scoutPage(address: string, page: number): Promise<ScoutTx[]> {
  const u = new URL(BLOCKSCOUT);
  u.search = new URLSearchParams({
    module: "account",
    action: "txlist",
    address,
    page: String(page),
    offset: String(PAGE_SIZE),
    sort: "asc",
  }).toString();
  for (let attempt = 0; ; attempt++) {
    const wait = lastScoutCall + SCOUT_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastScoutCall = Date.now();
    const res = await fetch(u, { headers: { accept: "application/json" } });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const ms = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
      await sleep(Math.min(ms, 20_000));
      continue;
    }
    if (!res.ok) throw new Error(`Blockscout HTTP ${res.status} for ${address}`);
    const body = (await res.json()) as { status: string; message: string; result: ScoutTx[] | string };
    if (Array.isArray(body.result)) return body.result;
    if (/no transactions/i.test(body.message)) return [];
    throw new Error(`Blockscout: ${body.message} for ${address}`);
  }
}

export function messagesFromScout(txs: ScoutTx[]): MessageRow[] {
  const rows: MessageRow[] = [];
  for (const tx of txs) {
    if (!tx.to || !tx.input || tx.input.length < 6) continue;
    const row = extractMessage({
      hash: tx.hash,
      blockNumber: tx.blockNumber,
      blockTime: new Date(Number(tx.timeStamp) * 1000),
      index: Number(tx.transactionIndex),
      from: tx.from,
      to: tx.to,
      value: tx.value,
      input: tx.input,
    });
    if (row) rows.push(row);
  }
  return rows;
}

export type LabelBackfillResult = {
  addresses: number;
  done: number;
  remaining: number;
  transactions: number;
  found: number;
  inserted: number;
  errors: string[];
  perAddress: Record<string, { transactions: number; messages: number }>;
};

const LABELS_NEXT_KEY = "labels_backfill_next"; // index of the next address to fetch
const LABELS_FAIL_KEY = "labels_backfill_fails"; // failed calls in a row on that address
const MAX_FAILS = 3;

// Works through the labeled addresses a few at a time, saving its place, so
// each call stays well inside the host's request time limit. Call it again
// until `remaining` is 0. `restart` starts over from the first address.
export async function backfillLabels(
  opts: { kinds?: string[]; budgetMs?: number; restart?: boolean } = {},
): Promise<LabelBackfillResult> {
  const kinds = opts.kinds ?? ["exploiter"];
  const budgetMs = opts.budgetMs ?? 150_000;
  const started = Date.now();
  await ensureSetup();

  const labels = await db()<{ address: string }[]>`
    select address from labels where kind = any(${kinds}) order by address`;
  if (opts.restart) {
    await setState(LABELS_NEXT_KEY, 0n);
    await setState(LABELS_FAIL_KEY, 0n);
  }
  let next = Number((await getState(LABELS_NEXT_KEY)) ?? 0n);
  let fails = Number((await getState(LABELS_FAIL_KEY)) ?? 0n);

  const result: LabelBackfillResult = {
    addresses: labels.length, done: next, remaining: Math.max(labels.length - next, 0),
    transactions: 0, found: 0, inserted: 0, errors: [], perAddress: {},
  };

  // Always try at least one address, then keep going while time allows.
  while (next < labels.length && (result.done === next || Date.now() - started < budgetMs)) {
    const { address } = labels[next];
    try {
      const rows: MessageRow[] = [];
      let seen = 0;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const txs = await scoutPage(address, page);
        seen += txs.length;
        rows.push(...messagesFromScout(txs));
        if (txs.length < PAGE_SIZE) break;
      }
      result.transactions += seen;
      result.found += rows.length;
      result.perAddress[address] = { transactions: seen, messages: rows.length };
      result.inserted += await insertMessages(rows);
      const senders = [...new Set(rows.map((r) => r.from_addr))];
      if (senders.length) await sweepSpam(senders);
      next++;
      fails = 0;
    } catch (err) {
      result.errors.push((err as Error).message);
      fails++;
      // Give up on an address after a few failed calls so it can't block the rest.
      if (fails >= MAX_FAILS) {
        next++;
        fails = 0;
      }
      await setState(LABELS_NEXT_KEY, BigInt(next));
      await setState(LABELS_FAIL_KEY, BigInt(fails));
      break; // let the next call retry after a pause
    }
    await setState(LABELS_NEXT_KEY, BigInt(next));
    await setState(LABELS_FAIL_KEY, BigInt(fails));
  }

  result.done = next;
  result.remaining = Math.max(labels.length - next, 0);
  return result;
}
