-- Every likely text message in Ethereum calldata within a date range.
-- Run in the BigQuery console, then export the result as CSV.
--
-- Cost: this scans the `input` column of the transactions table for the
-- dates you pick. Do a dry run first (the console shows "This query will
-- process X GB") and narrow the dates if it's more than you want to pay.
-- The first 1 TB per month is free.
--
-- The filters here are loose on purpose. The importer runs the same decoder
-- and spam rules as the live indexer, so anything that slips through here is
-- dropped there.

DECLARE start_ts TIMESTAMP DEFAULT TIMESTAMP('2023-01-01');
DECLARE end_ts   TIMESTAMP DEFAULT TIMESTAMP('2026-10-01');

WITH tx AS (
  SELECT
    `hash`,
    block_number,
    block_timestamp,
    transaction_index,
    from_address,
    to_address,
    CAST(value AS STRING) AS value,
    input,
    SAFE_CONVERT_BYTES_TO_STRING(FROM_HEX(SUBSTR(input, 3))) AS txt
  FROM `bigquery-public-data.crypto_ethereum.transactions`
  WHERE block_timestamp >= start_ts
    AND block_timestamp < end_ts
    AND to_address IS NOT NULL
    AND input != '0x'
    AND LENGTH(input) BETWEEN 6 AND 40002
)
SELECT `hash`, block_number, block_timestamp, transaction_index, from_address, to_address, value, input
FROM tx
WHERE txt IS NOT NULL                                -- valid UTF-8
  AND REGEXP_CONTAINS(txt, r'^\x00*[^\x00]+\x00*$')  -- no NUL bytes inside, so not ABI-encoded
  AND REGEXP_CONTAINS(txt, r'\pL.*\pL')              -- at least two letters
  AND NOT STARTS_WITH(txt, 'data:')                  -- skip inscriptions early
ORDER BY block_number;
