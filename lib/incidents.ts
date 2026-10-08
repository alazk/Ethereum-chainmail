import { db } from "./db";
import type { FeedMessage, LabelKind } from "./queries";

export type IncidentSummary = {
  slug: string;
  name: string;
  exploiters: number;
  team: number;
  core: number; // messages written by the exploiter or the team
  crowd: number; // messages from everyone else to the exploiter
  first_at: Date | null;
  last_at: Date | null;
};

export type IncidentParty = { address: string; name: string; kind: LabelKind };

const MESSAGE_COLUMNS = (sql: ReturnType<typeof db>) => sql`
  m.tx_hash, m.block_number, m.block_time, m.tx_index, m.from_addr, m.to_addr,
  m.value_wei, m.body, m.pair_key, m.lang, m.translation,
  lf.name as from_name, lf.kind as from_kind, lt.name as to_name, lt.kind as to_kind`;

export async function listIncidents(): Promise<IncidentSummary[]> {
  return db()<IncidentSummary[]>`
    with parties as (
      select incident, address, kind from labels where incident is not null
    ),
    core as (
      select p.incident, count(*)::int as n, min(m.block_time) as first_at, max(m.block_time) as last_at
      from messages m join parties p on p.address = m.from_addr
      where m.status = 'visible'
      group by p.incident
    ),
    crowd as (
      select p.incident, count(*)::int as n, min(m.block_time) as first_at, max(m.block_time) as last_at
      from messages m
      join parties p on p.address = m.to_addr and p.kind = 'exploiter'
      where m.status = 'visible'
        and not exists (select 1 from parties q where q.incident = p.incident and q.address = m.from_addr)
      group by p.incident
    )
    select i.slug, i.name,
      (select count(*)::int from parties p where p.incident = i.slug and p.kind = 'exploiter') as exploiters,
      (select count(*)::int from parties p where p.incident = i.slug and p.kind <> 'exploiter') as team,
      coalesce(core.n, 0) as core,
      coalesce(crowd.n, 0) as crowd,
      least(core.first_at, crowd.first_at) as first_at,
      greatest(core.last_at, crowd.last_at) as last_at
    from incidents i
    left join core on core.incident = i.slug
    left join crowd on crowd.incident = i.slug
    order by coalesce(core.n, 0) + coalesce(crowd.n, 0) = 0, greatest(core.last_at, crowd.last_at) desc nulls last`;
}

export async function getIncident(slug: string) {
  const sql = db();
  const [incident] = await sql<{ slug: string; name: string }[]>`
    select slug, name from incidents where slug = ${slug}`;
  if (!incident) return null;

  const parties = await sql<IncidentParty[]>`
    select address, name, kind from labels where incident = ${slug}
    order by kind = 'exploiter' desc, name`;
  const addresses = parties.map((p) => p.address);
  const exploiters = parties.filter((p) => p.kind === "exploiter").map((p) => p.address);
  if (!addresses.length) return { incident, parties, core: [], crowdCount: 0 };

  // The story: everything the exploiter and the team wrote, in order.
  const core = await sql<FeedMessage[]>`
    select ${MESSAGE_COLUMNS(sql)}, 0 as thread_count
    from messages m
    left join labels lf on lf.address = m.from_addr
    left join labels lt on lt.address = m.to_addr
    where m.status = 'visible' and m.from_addr = any(${addresses})
    order by m.block_number, m.tx_index
    limit 500`;

  const [{ n: crowdCount }] = exploiters.length
    ? await sql<{ n: number }[]>`
        select count(*)::int as n from messages
        where status = 'visible' and to_addr = any(${exploiters}) and from_addr <> all(${addresses})`
    : [{ n: 0 }];

  return { incident, parties, core, crowdCount };
}

// Everyone else who wrote to the exploiter, newest first.
export async function getCrowd(slug: string, offset: number, limit = 50): Promise<FeedMessage[]> {
  const sql = db();
  return sql<FeedMessage[]>`
    with parties as (select address, kind from labels where incident = ${slug})
    select ${MESSAGE_COLUMNS(sql)}, 0 as thread_count
    from messages m
    left join labels lf on lf.address = m.from_addr
    left join labels lt on lt.address = m.to_addr
    where m.status = 'visible'
      and m.to_addr in (select address from parties where kind = 'exploiter')
      and m.from_addr not in (select address from parties)
    order by m.block_number desc, m.tx_index desc
    offset ${offset} limit ${limit}`;
}
