import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";

// ---------------------------------------------------------------------------
// Session: the admin types ADMIN_SECRET once; the cookie holds an HMAC of it,
// never the secret itself.
// ---------------------------------------------------------------------------

export const ADMIN_COOKIE = "cm_admin";

export function sessionToken(secret: string): string {
  return createHmac("sha256", secret).update("chainmail-admin-v1").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkSecret(given: string): boolean {
  const secret = process.env.ADMIN_SECRET;
  return !!secret && safeEqual(given, secret);
}

export async function isAdmin(): Promise<boolean> {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const value = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  return safeEqual(value, sessionToken(secret));
}

// ---------------------------------------------------------------------------
// Suggestions: unlabeled addresses that wrote to a labeled exploiter AND got
// a message back. That's nearly always the protocol team (or a negotiator).
// ---------------------------------------------------------------------------

export type TeamSuggestion = {
  address: string;
  incident: string;
  incident_name: string;
  wrote: number;
  got: number;
  sample: string | null;
};

export async function teamSuggestions(limit = 30): Promise<TeamSuggestion[]> {
  return db()<TeamSuggestion[]>`
    with ex as (
      select address, incident from labels where kind = 'exploiter' and incident is not null
    ),
    pairs as (
      select ex.incident,
             case when m.from_addr = ex.address then m.to_addr else m.from_addr end as address,
             (m.to_addr = ex.address) as to_exploiter,
             m.body, m.block_number
      from messages m
      join ex on ex.address in (m.from_addr, m.to_addr)
      where m.status <> 'hidden' and m.from_addr <> m.to_addr
    )
    select p.address, p.incident, i.name as incident_name,
           count(*) filter (where p.to_exploiter)::int as wrote,
           count(*) filter (where not p.to_exploiter)::int as got,
           (array_agg(left(p.body, 240) order by p.block_number) filter (where p.to_exploiter))[1] as sample
    from pairs p
    join incidents i on i.slug = p.incident
    where not exists (select 1 from labels l where l.address = p.address)
    group by p.address, p.incident, i.name
    having count(*) filter (where p.to_exploiter) > 0 and count(*) filter (where not p.to_exploiter) > 0
    order by count(*) desc
    limit ${limit}`;
}

// ---------------------------------------------------------------------------
// Possible new hacks: an unlabeled address that suddenly gets messages from
// many different strangers. Shown to the admin only; a famous wallet can
// trip this too, so a person decides.
// ---------------------------------------------------------------------------

export const FLAG_WINDOW_HOURS = 72;
export const FLAG_MIN_SENDERS = 8;
export const FLAG_MAX_BEFORE = 5;

export type HackFlag = {
  address: string;
  senders: number;
  messages: number;
  before: number;
  first_at: Date;
  samples: string[];
};

export async function hackFlags(): Promise<HackFlag[]> {
  return db()<HackFlag[]>`
    with recent as (
      select to_addr as address, count(distinct from_addr)::int as senders, count(*)::int as messages,
             min(block_time) as first_at
      from messages
      where status = 'visible' and block_time > now() - make_interval(hours => ${FLAG_WINDOW_HOURS})
      group by to_addr
      having count(distinct from_addr) >= ${FLAG_MIN_SENDERS}
    )
    select r.*,
      (select count(*)::int from messages o
        where o.to_addr = r.address and o.block_time <= now() - make_interval(hours => ${FLAG_WINDOW_HOURS})) as before,
      array(select left(s.body, 200) from messages s
            where s.to_addr = r.address and s.status = 'visible'
            order by s.block_number desc limit 3) as samples
    from recent r
    where not exists (select 1 from labels l where l.address = r.address)
      and (select count(*) from messages o
            where o.to_addr = r.address and o.block_time <= now() - make_interval(hours => ${FLAG_WINDOW_HOURS})) < ${FLAG_MAX_BEFORE}
    order by r.senders desc
    limit 20`;
}

// ---------------------------------------------------------------------------
// Labels and incidents
// ---------------------------------------------------------------------------

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function upsertIncident(name: string): Promise<string> {
  const slug = slugify(name);
  if (!slug) throw new Error("Incident name needs letters or numbers");
  await db()`
    insert into incidents (slug, name) values (${slug}, ${name.trim()})
    on conflict (slug) do nothing`;
  return slug;
}

export async function saveLabel(input: {
  address: string;
  name: string;
  kind: string;
  incident: string | null;
}): Promise<void> {
  await db()`
    insert into labels (address, name, kind, source, incident)
    values (${input.address.toLowerCase()}, ${input.name.trim()}, ${input.kind}, 'admin', ${input.incident})
    on conflict (address) do update
      set name = excluded.name, kind = excluded.kind, incident = excluded.incident, source = 'admin'`;
}

export async function removeLabel(address: string): Promise<void> {
  await db()`delete from labels where address = ${address.toLowerCase()}`;
}

export async function recentAdminLabels() {
  return db()<{ address: string; name: string; kind: string; incident: string | null; added_at: Date }[]>`
    select address, name, kind, incident, added_at from labels
    where source = 'admin' order by added_at desc limit 50`;
}

export async function incidentOptions() {
  return db()<{ slug: string; name: string }[]>`select slug, name from incidents order by name`;
}

export async function setMessageStatus(txHash: string, status: "visible" | "hidden" | "spam"): Promise<boolean> {
  const reason = status === "visible" ? null : status === "hidden" ? "hidden by moderator" : "marked spam by moderator";
  const r = await db()`
    update messages set status = ${status}, spam_reason = ${reason} where tx_hash = ${txHash.toLowerCase()}`;
  return r.count > 0;
}
