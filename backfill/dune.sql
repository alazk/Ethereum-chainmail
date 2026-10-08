-- Dune (DuneSQL / Trino) version of the backfill query. Untested against
-- live data: if Dune rejects a function, the BigQuery version is the
-- reference. Keep the date range small; Dune limits result sizes on free plans.

with tx as (
  select
    hash,
    block_number,
    block_time,
    "index" as transaction_index,
    "from" as from_address,
    "to" as to_address,
    value,
    data,
    from_utf8(data) as txt
  from ethereum.transactions
  where block_time >= timestamp '2025-01-01'
    and block_time < timestamp '2026-10-01'
    and "to" is not null
    and length(data) between 2 and 20000
)
select
  hash,
  block_number,
  block_time as block_timestamp,
  transaction_index,
  from_address,
  to_address,
  cast(value as varchar) as value,
  data as input
from tx
where strpos(txt, U&'\FFFD') = 0                         -- from_utf8 marks invalid bytes with U+FFFD
  and strpos(trim(both chr(0) from txt), chr(0)) = 0     -- no NUL bytes inside
  and regexp_like(txt, '\p{L}.*\p{L}')
  and not starts_with(txt, 'data:')
order by block_number
