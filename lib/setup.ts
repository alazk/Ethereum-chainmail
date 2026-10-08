import { db } from "./db";
import { SCHEMA } from "./schema";
import publicLabels from "../data/labels.json";
import customLabels from "../data/labels-custom.json";

export type Label = { address: string; name: string; kind: string; source?: string | null };
const KINDS = new Set(["exploiter", "protocol", "exchange", "sanctioned", "other"]);

// Public dataset first, custom labels after, so custom ones win.
export function allLabels(): Label[] {
  const merged = new Map<string, Label>();
  for (const label of [...(publicLabels as Label[]), ...(customLabels as Label[])]) {
    const address = label.address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error(`Bad address: ${label.address}`);
    if (!KINDS.has(label.kind)) throw new Error(`Bad kind "${label.kind}" for ${address}`);
    merged.set(address, { address, name: label.name, kind: label.kind, source: label.source ?? null });
  }
  return [...merged.values()];
}

export async function applySchema(): Promise<void> {
  await db().unsafe(SCHEMA);
}

export async function upsertLabels(): Promise<number> {
  const sql = db();
  const rows = allLabels();
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await sql`
      insert into labels ${sql(chunk, "address", "name", "kind", "source")}
      on conflict (address) do update
        set name = excluded.name, kind = excluded.kind, source = excluded.source`;
  }
  return rows.length;
}

// Called before every ingest run. On a fresh database it creates the tables
// and loads the labels, so a new deployment sets itself up on its first run.
let ready = false;
export async function ensureSetup(): Promise<void> {
  if (ready) return;
  const [{ exists }] = await db()<{ exists: boolean }[]>`
    select to_regclass('public.messages') is not null as exists`;
  if (!exists) {
    await applySchema();
    await upsertLabels();
  }
  ready = true;
}
