import { db } from "./db";
import type { MessageRow } from "./extract";

const CURSOR_KEY = "eth_last_block";

export async function getCursor(): Promise<bigint | null> {
  const rows = await db()`select value from sync_state where key = ${CURSOR_KEY}`;
  return rows.length ? BigInt(rows[0].value) : null;
}

export async function setCursor(block: bigint): Promise<void> {
  await db()`
    insert into sync_state (key, value) values (${CURSOR_KEY}, ${block.toString()})
    on conflict (key) do update set value = excluded.value`;
}

const COLUMNS = [
  "tx_hash",
  "block_number",
  "block_time",
  "tx_index",
  "from_addr",
  "to_addr",
  "value_wei",
  "body",
  "status",
  "spam_reason",
  "pair_key",
] as const;

// Inserts in chunks; already-seen transactions are skipped, which makes
// re-running a block range or a backfill file harmless.
export async function insertMessages(rows: MessageRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const sql = db();
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const result = await sql`
      insert into messages ${sql(chunk, ...COLUMNS)}
      on conflict (tx_hash) do nothing`;
    inserted += result.count;
  }
  return inserted;
}
