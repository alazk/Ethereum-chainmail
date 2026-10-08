import "./env";
import { db } from "../lib/db";
import { applySchema } from "../lib/setup";

async function main() {
  await applySchema();
  console.log("Schema is up to date.");
  await db().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
