# Chainmail

A live feed of the text messages people write inside Ethereum transactions.
Hackers and protocols negotiate bounties this way, drained victims write to
the wallet that robbed them, and people leave notes for strangers. Etherscan
shows one message at a time if you click "view input as UTF-8". Chainmail
collects all of them, labels the known addresses, and groups replies into
conversations.

- **Feed** (`/`): every new message, newest first. A second tab shows only
  messages to or from known exploiters.
- **Conversation** (`/thread/<a>/<b>`): everything two addresses said to each
  other, in order.
- **Address** (`/address/<addr>`): everything one address sent or received.

Built with Next.js, Postgres and viem. Runs on Vercel's free plan plus a free
Postgres (Neon or Supabase) and a free RPC key.

## Run it locally

You need Node 20+, a Postgres database and an Ethereum RPC URL.

```
cp .env.example .env.local     # fill in DATABASE_URL and ETH_RPC_URL
npm install
npm run db:migrate             # create tables
npm run db:seed-labels         # load known exchange, exploiter and sanctioned addresses
npm run ingest:once -- 50      # read the last 50 blocks
npm run dev                    # http://localhost:3000
```

Most blocks have no messages, so the feed may stay empty for a while at
first. The backfill below fixes that.

## Deploy

1. **Database.** Create a free Postgres on [Neon](https://neon.tech) or
   [Supabase](https://supabase.com). Copy the pooled connection string.
2. **RPC.** Get a mainnet URL from Alchemy, QuickNode or Infura. The indexer
   makes one call per block, a few thousand calls a day.
3. **Tables.** Either paste `db/setup.sql` into your database's SQL editor
   and run it, or put `DATABASE_URL` in `.env.local` and run
   `npm run db:migrate` and `npm run db:seed-labels` from your machine.
   After editing labels, regenerate the file with
   `npx tsx scripts/build-setup-sql.ts`.
4. **Vercel.** Import this repo and set four environment variables:
   `DATABASE_URL`, `ETH_RPC_URL`, `CRON_SECRET` and `ADMIN_SECRET` (any long
   random strings for the last two). Deploy.
5. **Schedule.** Vercel's free plan only allows cron jobs once a day, so
   `vercel.json` has a daily catch-up run. The real schedule is the GitHub
   Action in `.github/workflows/ingest.yml`, which calls the indexer every 5
   minutes. In the repo settings, add two Actions secrets:
   - `CHAINMAIL_URL`: your deployment URL, like `https://chainmail.vercel.app`
   - `CRON_SECRET`: the same value as in Vercel

   Then run the workflow once by hand from the Actions tab to check it.
   On Vercel Pro you can skip the Action and change the schedule in
   `vercel.json` to `* * * * *`.

GitHub turns off scheduled workflows in public repos after 60 days without
a commit. If the feed stops moving, re-enable the workflow in the Actions tab.

## Backfill history

The indexer only reads new blocks. To launch with years of past messages,
run the query in `backfill/bigquery.sql` on Google BigQuery's free public
Ethereum dataset, export the result as CSV, and import it:

```
npm run backfill:import -- backfill/messages.csv
```

Details and cost notes are in [backfill/README.md](backfill/README.md).

## Labels

Labels turn `0xb66c…95db` into "Euler Finance Exploiter 2" and drive the
hacks tab.

- `data/labels.json` has about 430 exchange, sanctioned and exploiter
  addresses from the MIT-licensed
  [etherscan-labels](https://github.com/brianleect/etherscan-labels) dataset.
  It's a 2023 snapshot, so it misses recent hacks.
- `data/labels-custom.json` is yours. Add addresses as you find them (kinds:
  `exploiter`, `protocol`, `exchange`, `sanctioned`, `other`) and run
  `npm run db:seed-labels` again. Custom labels override the dataset.

Start by tagging the big recent hacks and the protocol addresses that wrote
to them. Those threads are the ones people share.

## Moderation

Some messages contain threats or personal details. Hide one with:

```
curl -X POST https://your-site/api/admin/hide \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "content-type: application/json" \
  -d '{"tx_hash": "0x...", "status": "hidden"}'
```

`"status": "visible"` brings it back, `"spam"` marks it as spam.

## How messages are found

A transaction counts as a message when its input data:

- decodes as valid UTF-8,
- has no NUL bytes inside it (contract calls are padded with them),
- is at least 95% readable characters with at least two letters,
- isn't just a hash or a hex string.

Then the spam rules run. These are hidden automatically:

- inscriptions (`data:` URIs and `{"p": ...}` JSON)
- long encoded strings with no spaces
- links combined with bait words like "claim" or "airdrop"
- the same text sent by one address to 10 or more addresses
- the same text (20+ characters) sent by 25 or more different addresses

The rules live in `lib/decode.ts`, `lib/classify.ts` and
`lib/spam-sweep.ts`. After changing them, `npm run spam:rescan` reapplies the
table-wide rules to everything.

## Tests

```
npm test
```

The tests cover decoding, spam rules, block parsing and the full database
flow (inserts, spam sweep, feed, threads, moderation). They run against an
in-process Postgres, so no setup is needed.

## Not built yet

- Following an address and getting an alert when it writes
- Base and Arbitrum
- An LLM pass for spam the rules miss
- A bigger, fresher label set
