import { db } from "./db";

export type LabelKind = "exploiter" | "protocol" | "exchange" | "sanctioned" | "other";

export type FeedMessage = {
  tx_hash: string;
  block_number: string;
  block_time: Date;
  tx_index: number;
  from_addr: string;
  to_addr: string;
  value_wei: string;
  body: string;
  pair_key: string;
  from_name: string | null;
  from_kind: LabelKind | null;
  to_name: string | null;
  to_kind: LabelKind | null;
  thread_count: number;
};

export type Filter = "all" | "hacks";
export const PAGE_SIZE = 40;

// "block-index" cursor so pages stay stable while new messages arrive.
export function parseCursor(raw: string | undefined): { block: string; index: number } | null {
  if (!raw) return null;
  const m = /^(\d+)-(\d+)$/.exec(raw);
  return m ? { block: m[1], index: Number(m[2]) } : null;
}

export function cursorOf(m: Pick<FeedMessage, "block_number" | "tx_index">): string {
  return `${m.block_number}-${m.tx_index}`;
}

export async function getFeed(filter: Filter, before?: string): Promise<FeedMessage[]> {
  const sql = db();
  const cursor = parseCursor(before);
  return sql<FeedMessage[]>`
    select m.tx_hash, m.block_number, m.block_time, m.tx_index, m.from_addr, m.to_addr,
           m.value_wei, m.body, m.pair_key,
           lf.name as from_name, lf.kind as from_kind,
           lt.name as to_name, lt.kind as to_kind,
           (select count(*)::int from messages t
             where t.pair_key = m.pair_key and t.status = 'visible') as thread_count
    from messages m
    left join labels lf on lf.address = m.from_addr
    left join labels lt on lt.address = m.to_addr
    where m.status = 'visible'
      ${filter === "hacks" ? sql`and (lf.kind = 'exploiter' or lt.kind = 'exploiter')` : sql``}
      ${cursor ? sql`and (m.block_number, m.tx_index) < (${cursor.block}::bigint, ${cursor.index})` : sql``}
    order by m.block_number desc, m.tx_index desc
    limit ${PAGE_SIZE}`;
}

export async function getThread(a: string, b: string): Promise<FeedMessage[]> {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const key = x < y ? `${x}:${y}` : `${y}:${x}`;
  return db()<FeedMessage[]>`
    select m.tx_hash, m.block_number, m.block_time, m.tx_index, m.from_addr, m.to_addr,
           m.value_wei, m.body, m.pair_key,
           lf.name as from_name, lf.kind as from_kind,
           lt.name as to_name, lt.kind as to_kind,
           0 as thread_count
    from messages m
    left join labels lf on lf.address = m.from_addr
    left join labels lt on lt.address = m.to_addr
    where m.pair_key = ${key} and m.status = 'visible'
    order by m.block_number asc, m.tx_index asc
    limit 500`;
}

export async function getAddressMessages(address: string, before?: string): Promise<FeedMessage[]> {
  const sql = db();
  const addr = address.toLowerCase();
  const cursor = parseCursor(before);
  return sql<FeedMessage[]>`
    select m.tx_hash, m.block_number, m.block_time, m.tx_index, m.from_addr, m.to_addr,
           m.value_wei, m.body, m.pair_key,
           lf.name as from_name, lf.kind as from_kind,
           lt.name as to_name, lt.kind as to_kind,
           (select count(*)::int from messages t
             where t.pair_key = m.pair_key and t.status = 'visible') as thread_count
    from messages m
    left join labels lf on lf.address = m.from_addr
    left join labels lt on lt.address = m.to_addr
    where (m.from_addr = ${addr} or m.to_addr = ${addr}) and m.status = 'visible'
      ${cursor ? sql`and (m.block_number, m.tx_index) < (${cursor.block}::bigint, ${cursor.index})` : sql``}
    order by m.block_number desc, m.tx_index desc
    limit ${PAGE_SIZE}`;
}

export async function getLabel(address: string): Promise<{ name: string; kind: LabelKind } | null> {
  const rows = await db()<{ name: string; kind: LabelKind }[]>`
    select name, kind from labels where address = ${address.toLowerCase()}`;
  return rows[0] ?? null;
}

export async function getSyncedBlock(): Promise<string | null> {
  const rows = await db()`select value from sync_state where key = 'eth_last_block'`;
  return rows[0]?.value ?? null;
}
