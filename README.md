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

1. **Vercel project.** Import this repo into Vercel.
2. **Database.** In the project's Storage tab, add Supabase (or Neon) from
   the marketplace and connect it to the project. Vercel sets `POSTGRES_URL`
   for you, which the app reads when `DATABASE_URL` isn't set. A database you
   created yourself works too: set `DATABASE_URL` to its pooled connection
   string.
3. **Environment variables.** Add `ETH_RPC_URL` (your Alchemy, QuickNode or
   Infura mainnet URL), plus `CRON_SECRET` and `ADMIN_SECRET` (any long random
   strings). Redeploy so they take effect.
4. **Tables.** Nothing to do. The first ingest run creates the tables and
   loads the labels. If you'd rather set it up by hand, paste `db/setup.sql`
   into the database's SQL editor, or run `npm run db:migrate` and
   `npm run db:seed-labels` locally.
5. **Schedule.** Vercel's free plan only allows cron jobs once a day, so
   `vercel.json` has a daily catch-up run. The real schedule is the GitHub
   Action in `.github/workflows/ingest.yml`, which calls the indexer every 15
   minutes. That gap lets a free Neon database sleep between runs and stay
   inside its monthly compute hours; with Supabase you can change it to
   `*/5`. In the repo settings, add two Actions secrets:
   - `CHAINMAIL_URL`: your deployment URL, like `https://chainmail.vercel.app`
   - `CRON_SECRET`: the same value as in Vercel

   Then run the workflow once by hand from the Actions tab to check it.
   On Vercel Pro you can skip the Action and change the schedule in
   `vercel.json` to `* * * * *`.

GitHub turns off scheduled workflows in public repos after 60 days without
a commit. If the feed stops moving, re-enable the workflow in the Actions tab.

## Backfill history

The indexer only reads new blocks. The `backfill` GitHub Action fills in the
past through the deployed app, using the same two secrets as the ingest
Action. Run it from the Actions tab:

- **mode `labels`** pulls every message ever sent to or from a labeled
  exploiter, from Blockscout's free API. This fills the hacks tab. Takes a
  minute or two.
- **mode `recent`** walks back block by block for the number of days you
  pick (default 30), through your RPC key. About 7,200 blocks per day of
  history; 30 days takes a few hours and a few million Alchemy compute units.
  The app remembers where it stopped, so re-running continues the walk.

For deeper history without spending RPC quota, `backfill/` also has BigQuery
queries and `npm run backfill:import` loads their CSV exports. See
[backfill/README.md](backfill/README.md).

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

## Hack pages

`/hacks` lists every incident, and `/hacks/<slug>` tells its story: what the
exploiter and the team wrote to each other, in order, with everyone else's
messages folded away underneath. An address shows up on a hack page when its
label has an `incident`. The seed incidents live in `data/incidents.json`.

## Admin

`/admin` is protected by `ADMIN_SECRET`. From there you can:

- add or change labels and create new hacks (saving an exploiter or team
  address pulls its past messages from Blockscout right away)
- approve suggested team addresses: unlabeled addresses that wrote to an
  exploiter and got a reply
- review possible new hacks: unlabeled addresses that suddenly got messages
  from many different senders
- hide, restore or mark messages as spam

Labels you add here are kept. Labels from the files in `data/` are reloaded
whenever those files change, which overwrites edits to those same addresses.

The older API endpoint still works for scripts:

```
curl -X POST https://your-site/api/admin/hide \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "content-type: application/json" \
  -d '{"tx_hash": "0x...", "status": "hidden"}'
```

## Translation (optional)

Set `ANTHROPIC_API_KEY` and each ingest run translates up to 10 non-English
messages with Claude, hack-page messages first. Translations show under the
original, marked as machine translations. `TRANSLATE_MODEL` changes the model.

## X bot (optional)

Set `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN` and `X_ACCESS_SECRET` from an
X developer app with read and write access. Each ingest run then posts up to
two new messages written by a labeled exploiter or team, linking to the hack
page. Only messages from the last 6 hours are posted, so backfills never flood
the account. `SITE_URL` sets the link base; on Vercel it defaults to the
production domain. X's API pricing changes, so check what posting costs on
your plan.

## How messages are found

A transaction counts as a message when its input data:

- decodes as valid UTF-8,
- has no NUL bytes inside it (contract calls are padded with them),
- is at least 95% readable characters with at least two letters,
- isn't just a hash or a hex string.

Then the spam rules run. These are hidden automatically:

- inscriptions (`data:` URIs and `{"p": ...}` JSON)
- long encoded strings with no spaces
- exchange and bot tags like `BFX_REFILL_SWEEP`
- messages that are nothing but a link
- links combined with bait words like "claim" or "airdrop"
- the same text sent by one address to 10 or more addresses
- the same text (20+ characters) sent by 25 or more different addresses
- repeats of a message the same sender already sent to the same address

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
