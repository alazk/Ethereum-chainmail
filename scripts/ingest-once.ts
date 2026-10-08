// Runs one ingest pass from your machine. Handy for testing your RPC and
// database before deploying. Usage: npm run ingest:once -- 50
import "./env";
import { db } from "../lib/db";
import { DEFAULT_MAX_BLOCKS, ingest } from "../lib/ingest";

async function main() {
  const blocks = Number(process.argv[2]) || DEFAULT_MAX_BLOCKS;
  const result = await ingest(blocks);
  console.log(result);
  await db().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
