// Runs the table-wide spam rules over everything. Use after a backfill import
// or after changing the thresholds in lib/spam-sweep.ts.
import "./env";
import { db } from "../lib/db";
import { sweepSpam } from "../lib/spam-sweep";

async function main() {
  const marked = await sweepSpam();
  console.log(`Marked ${marked} messages as spam.`);
  await db().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
