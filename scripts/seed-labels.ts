// Loads data/labels.json and data/labels-custom.json into the labels table.
// Run it again after editing either file.
import "./env";
import { db } from "../lib/db";
import { upsertLabels } from "../lib/setup";

async function main() {
  const n = await upsertLabels();
  console.log(`Loaded ${n} labels.`);
  await db().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
