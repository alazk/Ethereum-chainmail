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
    const res = await fetch(u, { headers: { accept: "application/json" } });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
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
  transactions: number;
  found: number;
  inserted: number;
  errors: string[];
};

export async function backfillLabels(kinds: string[] = ["exploiter"]): Promise<LabelBackfillResult> {
  await ensureSetup();
  const labels = await db()<{ address: string }[]>`
    select address from labels where kind = any(${kinds}) order by address`;

  const result: LabelBackfillResult = { addresses: labels.length, transactions: 0, found: 0, inserted: 0, errors: [] };
  for (const { address } of labels) {
    try {
      const rows: MessageRow[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const txs = await scoutPage(address, page);
        result.transactions += txs.length;
        rows.push(...messagesFromScout(txs));
        if (txs.length < PAGE_SIZE) break;
      }
      result.found += rows.length;
      result.inserted += await insertMessages(rows);
      const senders = [...new Set(rows.map((r) => r.from_addr))];
      if (senders.length) await sweepSpam(senders);
    } catch (err) {
      result.errors.push((err as Error).message);
    }
  }
  return result;
}
