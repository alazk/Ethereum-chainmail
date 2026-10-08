import { db } from "./db";
import { SCHEMA, SEARCH_INDEX } from "./schema";
import publicLabels from "../data/labels.json";
import customLabels from "../data/labels-custom.json";
import incidentData from "../data/incidents.json";

export type Label = {
  address: string;
  name: string;
  kind: string;
  source?: string | null;
  incident?: string | null;
};
export type IncidentSeed = { slug: string; name: string; match?: string[] };

export const KINDS = ["exploiter", "protocol", "exchange", "sanctioned", "other"] as const;
const KIND_SET = new Set<string>(KINDS);

export function allIncidents(): IncidentSeed[] {
  return incidentData as IncidentSeed[];
}

// Which incident a seeded label belongs to: its own "incident" field, or the
// first incident whose name prefixes match the label's name.
function incidentFor(label: Label): string | null {
  if (label.incident) return label.incident;
  for (const inc of allIncidents()) {
    if (inc.match?.some((prefix) => label.name.startsWith(prefix))) return inc.slug;
  }
  return null;
}

// Public dataset first, custom labels after, so custom ones win.
export function allLabels(): Required<Label>[] {
  const merged = new Map<string, Required<Label>>();
  for (const label of [...(publicLabels as Label[]), ...(customLabels as Label[])]) {
    const address = label.address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error(`Bad address: ${label.address}`);
    if (!KIND_SET.has(label.kind)) throw new Error(`Bad kind "${label.kind}" for ${address}`);
    merged.set(address, {
      address,
      name: label.name,
      kind: label.kind,
      source: label.source ?? null,
      incident: incidentFor(label),
    });
  }
  return [...merged.values()];
}

// A fingerprint of the seed files, so labels are re-applied only when they change.
export function seedVersion(): bigint {
  const text = JSON.stringify([allLabels(), allIncidents()]);
  let h = 0xcbf29ce484222325n; // FNV-1a, 64-bit
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h & 0x7fffffffffffffffn; // fits a signed bigint column
}

export async function applySchema(): Promise<void> {
  await db().unsafe(SCHEMA);
  try {
    await db().unsafe(SEARCH_INDEX);
  } catch {
    // Search still works without the index, just slower.
  }
}

export async function upsertLabels(): Promise<number> {
  const sql = db();
  const incidents = allIncidents().map(({ slug, name }) => ({ slug, name }));
  if (incidents.length) {
    await sql`
      insert into incidents ${sql(incidents, "slug", "name")}
      on conflict (slug) do update set name = excluded.name`;
  }
  const rows = allLabels();
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await sql`
      insert into labels ${sql(chunk, "address", "name", "kind", "source", "incident")}
      on conflict (address) do update
        set name = excluded.name, kind = excluded.kind, source = excluded.source,
            incident = excluded.incident`;
  }
  return rows.length;
}

// Runs once per server instance: brings the schema up to date, and reloads
// the seed labels when the files in data/ have changed since the last load.
// A brand-new database gets set up by its first request this way.
let ready: Promise<void> | null = null;
export function ensureSetup(): Promise<void> {
  ready ??= (async () => {
    await applySchema();
    const version = seedVersion();
    const rows = await db()`select value from sync_state where key = 'seed_version'`;
    if (!rows.length || BigInt(rows[0].value) !== version) {
      await upsertLabels();
      await db()`
        insert into sync_state (key, value) values ('seed_version', ${version.toString()})
        on conflict (key) do update set value = excluded.value`;
    }
  })().catch((err) => {
    ready = null; // try again on the next request
    throw err;
  });
  return ready;
}

// For tests: forget that setup already ran in this process.
export function resetSetupForTests(): void {
  ready = null;
}
