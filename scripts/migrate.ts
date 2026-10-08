import "./env";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../lib/db";

async function main() {
  const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8");
  await db().unsafe(schema);
  console.log("Schema is up to date.");
  await db().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
