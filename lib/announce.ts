import { db } from "./db";
import { composePost, postToX, xKeysFromEnv, type XKeys } from "./x";

// Posts new messages written by a labeled exploiter or a hack's team to X.
// Only messages from the last few hours count, so a backfill never floods
// the account with old history.
const FRESH_HOURS = 6;
const PER_RUN = 2;

export function siteUrl(): string | null {
  const explicit = process.env.SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : null;
}

type Candidate = {
  tx_hash: string;
  body: string;
  translation: string | null;
  lang: string | null;
  from_name: string;
  from_kind: string;
  to_name: string | null;
  to_addr: string;
  from_addr: string;
  incident: string;
};

export async function announceNew(keys: XKeys | null = xKeysFromEnv()): Promise<{ posted: number; errors: string[] }> {
  const url = siteUrl();
  if (!keys || !url) return { posted: 0, errors: [] };

  const sql = db();
  const candidates = await sql<Candidate[]>`
    select m.tx_hash, m.body, m.translation, m.lang, m.from_addr, m.to_addr,
           lf.name as from_name, lf.kind as from_kind, lt.name as to_name, lf.incident
    from messages m
    join labels lf on lf.address = m.from_addr and lf.incident is not null
      and lf.kind in ('exploiter', 'protocol')
    left join labels lt on lt.address = m.to_addr
    where m.status = 'visible'
      and m.block_time > now() - make_interval(hours => ${FRESH_HOURS})
      and not exists (select 1 from posts p where p.tx_hash = m.tx_hash)
    order by m.block_number, m.tx_index
    limit ${PER_RUN}`;

  let posted = 0;
  const errors: string[] = [];
  for (const c of candidates) {
    // Claim it first so a crash mid-post can't cause a double post.
    const claimed = await sql`insert into posts (tx_hash) values (${c.tx_hash}) on conflict do nothing`;
    if (claimed.count === 0) continue;

    const recipient = c.to_addr === c.from_addr ? "itself" : c.to_name ?? `${c.to_addr.slice(0, 6)}…${c.to_addr.slice(-4)}`;
    const translated = c.translation && c.lang && c.lang !== "English";
    const header = `${c.from_name} wrote to ${recipient} onchain${translated ? ` (translated from ${c.lang})` : ""}:`;
    const text = composePost(header, translated ? c.translation! : c.body, `${url}/hacks/${c.incident}`);
    try {
      const id = await postToX(text, keys);
      await sql`update posts set tweet_id = ${id} where tx_hash = ${c.tx_hash}`;
      posted++;
    } catch (err) {
      const message = (err as Error).message;
      errors.push(message);
      await sql`update posts set error = ${message} where tx_hash = ${c.tx_hash}`;
    }
  }
  return { posted, errors };
}
