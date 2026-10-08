// Imports a CSV export from BigQuery or Dune (see backfill/README.md).
// Usage: npm run backfill:import -- backfill/messages.csv
//
// Expected columns: hash, block_number, block_timestamp, transaction_index,
// from_address, to_address, value, and either input (raw hex calldata) or
// body (already decoded text, as the queries in backfill/ produce).
import "./env";
import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { db } from "../lib/db";
import { extractMessage, type MessageRow } from "../lib/extract";
import { insertMessages } from "../lib/store";
import { sweepSpam } from "../lib/spam-sweep";

export function parseTimestamp(raw: string): Date {
  const s = raw.trim();
  if (/^\d+$/.test(s)) return new Date(Number(s) * 1000); // unix seconds
  // "2023-03-13 08:50:23 UTC" or "2023-03-13 08:50:23.000 UTC"
  const iso = s.replace(" UTC", "Z").replace(" ", "T");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Can't read timestamp "${raw}"`);
  return d;
}

export function inputOf(rec: Record<string, string>): string {
  if (rec.input) return rec.input;
  if (rec.body) return "0x" + Buffer.from(rec.body, "utf8").toString("hex");
  return "0x";
}

export function parseWei(raw: string): string {
  const s = (raw ?? "").trim();
  if (s === "") return "0";
  if (/^\d+$/.test(s)) return s;
  if (/^\d+\.0+$/.test(s)) return s.split(".")[0];
  const n = Number(s); // scientific notation from some exports
  return Number.isFinite(n) ? BigInt(Math.round(n)).toString() : "0";
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Pass the CSV path, e.g. npm run backfill:import -- backfill/messages.csv");

  const parser = createReadStream(file).pipe(parse({ columns: true, skip_empty_lines: true }));
  let seen = 0;
  let kept = 0;
  let inserted = 0;
  let batch: MessageRow[] = [];

  const flush = async () => {
    inserted += await insertMessages(batch);
    batch = [];
  };

  for await (const rec of parser as AsyncIterable<Record<string, string>>) {
    seen++;
    const row = extractMessage({
      hash: rec.hash,
      blockNumber: rec.block_number,
      blockTime: parseTimestamp(rec.block_timestamp),
      index: Number(rec.transaction_index),
      from: rec.from_address,
      to: rec.to_address || null,
      value: parseWei(rec.value),
      input: inputOf(rec),
    });
    if (row) {
      kept++;
      batch.push(row);
    }
    if (batch.length >= 2000) await flush();
    if (seen % 50_000 === 0) console.log(`read ${seen}, messages ${kept}, inserted ${inserted}`);
  }
  await flush();

  console.log(`Read ${seen} rows, ${kept} were messages, ${inserted} new. Running spam sweep...`);
  const marked = await sweepSpam();
  console.log(`Marked ${marked} as spam. Done.`);
  await db().end();
}

if (process.argv[1]?.endsWith("import-backfill.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
