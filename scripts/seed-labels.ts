import "./env";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "../lib/db";

type Label = { address: string; name: string; kind: string; source?: string };
const KINDS = new Set(["exploiter", "protocol", "exchange", "sanctioned", "other"]);

function load(file: string): Label[] {
  const path = join(process.cwd(), "data", file);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")) as Label[];
}

async function main() {
  // Custom labels load last, so they win over the public dataset.
  const merged = new Map<string, Label>();
  for (const label of [...load("labels.json"), ...load("labels-custom.json")]) {
    const address = label.address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error(`Bad address: ${label.address}`);
    if (!KINDS.has(label.kind)) throw new Error(`Bad kind "${label.kind}" for ${address}`);
    merged.set(address, { ...label, address, source: label.source ?? null } as Label);
  }

  const rows = [...merged.values()];
  const sql = db();
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await sql`
      insert into labels ${sql(chunk, "address", "name", "kind", "source")}
      on conflict (address) do update
        set name = excluded.name, kind = excluded.kind, source = excluded.source`;
  }
  console.log(`Loaded ${rows.length} labels.`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
