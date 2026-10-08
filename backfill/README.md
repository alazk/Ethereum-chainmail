# Backfill

The live indexer only reads new blocks. These queries pull past messages from
Google BigQuery's free public Ethereum dataset so the site launches with
history.

- `recent.sql`: every message in a date range (the last year by default).
- `exploiters.sql`: every message ever sent to or from a labeled exploiter.
  This is what fills the "Hacks and negotiations" tab.
- `dune.sql`: an older, untested Dune version of the recent query.

Both BigQuery queries apply the app's spam rules before exporting, so the
files stay small.

## Steps

1. Open the [BigQuery console](https://console.cloud.google.com/bigquery).
   The free sandbox works without a card.
2. Paste a query. Before running, check the estimate in the top right of the
   editor ("This query will process ..."). The first 1 TB a month is free.
   If it's more, shorten the date range.
3. Run it, then use Save results → CSV. Small results download directly;
   bigger ones go to Google Drive first.
4. Import:

   ```
   npm run backfill:import -- backfill/recent.csv
   ```

The importer runs the same decoder and spam rules as the live indexer, skips
transactions it already has, and runs the spam sweep at the end, so it's safe
to re-run. CSV files in this folder are git-ignored.

After adding exploiter labels, regenerate both queries with
`node scripts/build-backfill-queries.cjs`.
