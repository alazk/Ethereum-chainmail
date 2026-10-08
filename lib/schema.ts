// Database schema. Every statement is safe to run more than once, and it runs
// once per server instance, so new columns and tables reach existing
// databases without a separate migration step.
// All addresses are stored lowercase.
export const SCHEMA = `
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

-- Machine translation, filled in after insert. lang is the source language
-- name ("English" means no translation was needed).
alter table messages add column if not exists lang text;
alter table messages add column if not exists translation text;

create index if not exists messages_feed_idx   on messages (block_number desc, tx_index desc);
create index if not exists messages_pair_idx   on messages (pair_key, block_number, tx_index);
create index if not exists messages_from_idx   on messages (from_addr, body_hash);
create index if not exists messages_to_idx     on messages (to_addr);
create index if not exists messages_body_idx   on messages (body_hash);
create index if not exists messages_status_idx on messages (status);
create index if not exists messages_time_idx   on messages (block_time);

-- A hack or other event that groups labeled addresses together.
create table if not exists incidents (
  slug       text primary key,
  name       text not null,
  created_at timestamptz not null default now()
);

-- Known addresses: exploiters, protocols, exchanges, sanctioned wallets.
create table if not exists labels (
  address text primary key,
  name    text not null,
  -- exploiter | protocol | exchange | sanctioned | other
  kind    text not null,
  source  text
);
alter table labels add column if not exists incident text;
alter table labels add column if not exists added_at timestamptz not null default now();
create index if not exists labels_incident_idx on labels (incident);

-- Messages posted to X, so nothing is posted twice.
create table if not exists posts (
  tx_hash   text primary key,
  tweet_id  text,
  error     text,
  posted_at timestamptz not null default now()
);

-- One row per backfill call, so results can be checked from the database.
create table if not exists backfill_runs (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  mode   text not null,
  result jsonb not null
);

-- Ingest cursor and other small counters.
create table if not exists sync_state (
  key   text primary key,
  value bigint not null
);
`;

// Optional: speeds up text search. Some Postgres hosts don't allow it, so
// it's applied separately and failures are ignored.
export const SEARCH_INDEX = `
create extension if not exists pg_trgm;
create index if not exists messages_body_trgm_idx on messages using gin (body gin_trgm_ops);
`;
