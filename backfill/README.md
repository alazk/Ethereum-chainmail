# Backfill

The live indexer only sees new blocks. To launch with years of history, export
past messages once and import them.

1. Open the [BigQuery console](https://console.cloud.google.com/bigquery) and
   paste `bigquery.sql`. Change the two dates at the top, dry-run to see the
   cost, then run it.
2. Save the result as CSV (for large results: export to Google Cloud Storage,
   then download). Put the file in this folder, for example
   `backfill/messages.csv`. CSVs here are git-ignored.
3. Import it:

   ```
   npm run backfill:import -- backfill/messages.csv
   ```

The importer is safe to re-run. It skips transactions it already has and runs
the spam sweep at the end.

`dune.sql` does the same on Dune if you prefer it. Rename nothing: the query
already outputs the column names the importer expects.
