import { createPublicClient, http, type Block } from "viem";
import { mainnet } from "viem/chains";
import { extractMessage, type MessageRow } from "./extract";
import { getCursor, insertMessages, setCursor } from "./store";
import { sweepSpam } from "./spam-sweep";
import { ensureSetup } from "./setup";
import { translatePending } from "./translate";
import { announceNew } from "./announce";

// Stay a couple of blocks behind the head so reorgs rarely touch us.
const CONFIRMATIONS = 2n;
const CONCURRENCY = 8;
export const DEFAULT_MAX_BLOCKS = 120; // ~24 minutes of chain per run

export type IngestResult = {
  from: string | null;
  to: string | null;
  head: string;
  blocks: number;
  found: number;
  inserted: number;
  markedSpam: number;
  behind: string; // blocks still left to catch up
  extras?: Record<string, unknown>;
};

// Follow-up work after new messages land. Failures here never fail the ingest.
async function afterIngest(): Promise<Record<string, unknown>> {
  const extras: Record<string, unknown> = {};
  try {
    extras.translation = await translatePending();
  } catch (err) {
    extras.translation = { error: (err as Error).message };
  }
  try {
    extras.x = await announceNew();
  } catch (err) {
    extras.x = { error: (err as Error).message };
  }
  return extras;
}

function client() {
  const url = process.env.ETH_RPC_URL;
  if (!url) throw new Error("ETH_RPC_URL is not set");
  return createPublicClient({ chain: mainnet, transport: http(url, { retryCount: 3 }) });
}

export function messagesFromBlock(block: Block<bigint, true>): MessageRow[] {
  const rows: MessageRow[] = [];
  const blockTime = new Date(Number(block.timestamp) * 1000);
  for (const tx of block.transactions) {
    const row = extractMessage({
      hash: tx.hash,
      blockNumber: block.number!,
      blockTime,
      index: tx.transactionIndex ?? 0,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      input: tx.input,
    });
    if (row) rows.push(row);
  }
  return rows;
}

export async function ingest(maxBlocks = DEFAULT_MAX_BLOCKS): Promise<IngestResult> {
  await ensureSetup();
  const rpc = client();
  const head = (await rpc.getBlockNumber()) - CONFIRMATIONS;

  let cursor = await getCursor();
  if (cursor === null) {
    const start = process.env.START_BLOCK ? BigInt(process.env.START_BLOCK) : head - 50n;
    cursor = start - 1n;
  }

  const from = cursor + 1n;
  const to = head < cursor + BigInt(maxBlocks) ? head : cursor + BigInt(maxBlocks);
  if (from > to) {
    return {
      from: null, to: null, head: head.toString(), blocks: 0, found: 0, inserted: 0, markedSpam: 0, behind: "0",
      extras: await afterIngest(),
    };
  }

  const numbers: bigint[] = [];
  for (let n = from; n <= to; n++) numbers.push(n);

  // Fetch in small parallel batches. If any block fails we throw before moving
  // the cursor, so the next run retries the whole range (inserts are idempotent).
  const rows: MessageRow[] = [];
  for (let i = 0; i < numbers.length; i += CONCURRENCY) {
    const batch = numbers.slice(i, i + CONCURRENCY);
    const blocks = await Promise.all(
      batch.map((blockNumber) => rpc.getBlock({ blockNumber, includeTransactions: true })),
    );
    for (const block of blocks) rows.push(...messagesFromBlock(block));
  }

  const inserted = await insertMessages(rows);
  const senders = [...new Set(rows.map((r) => r.from_addr))];
  const markedSpam = senders.length ? await sweepSpam(senders) : 0;
  await setCursor(to);

  return {
    from: from.toString(),
    to: to.toString(),
    head: head.toString(),
    blocks: numbers.length,
    found: rows.length,
    inserted,
    markedSpam,
    behind: (head - to).toString(),
    extras: await afterIngest(),
  };
}
