-- Chainmail schema. Safe to run more than once.
-- All addresses are stored lowercase.

create table if not exists messages (
  tx_hash      text primary key,
  block_number bigint      not null,
  block_time   timestamptz not null,
  tx_index     integer     not null,
  from_addr    text        not null,
  to_addr      text        not null,
  value_wei    numeric(78, 0) not null default 0,
  body         text        not null,
  body_hash    text generated always as (md5(body)) stored,
  -- visible | spam | hidden
  status       text        not null default 'visible',
  spam_reason  text,
  -- both addresses sorted and joined, so a conversation is one key
  pair_key     text        not null,
  inserted_at  timestamptz not null default now()
);

create index if not exists messages_feed_idx   on messages (block_number desc, tx_index desc);
create index if not exists messages_pair_idx   on messages (pair_key, block_number, tx_index);
create index if not exists messages_from_idx   on messages (from_addr, body_hash);
create index if not exists messages_to_idx     on messages (to_addr);
create index if not exists messages_body_idx   on messages (body_hash);
create index if not exists messages_status_idx on messages (status);

-- Known addresses: exploiters, protocols, exchanges, sanctioned wallets.
create table if not exists labels (
  address text primary key,
  name    text not null,
  -- exploiter | protocol | exchange | sanctioned | other
  kind    text not null,
  source  text
);

-- Ingest cursor and other small counters.
create table if not exists sync_state (
  key   text primary key,
  value bigint not null
);
