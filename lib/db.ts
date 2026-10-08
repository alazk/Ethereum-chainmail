import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

// One client per server instance. Small pool because serverless functions
// run many instances in parallel; prepare:false keeps pgbouncer/poolers happy.
const globalForDb = globalThis as unknown as { __chainmailSql?: Sql };

export function db(): Sql {
  if (!globalForDb.__chainmailSql) {
    // DATABASE_URL, or POSTGRES_URL as set by Vercel's Supabase/Neon integrations.
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL (or POSTGRES_URL) is not set");
    globalForDb.__chainmailSql = postgres(url, {
      max: Number(process.env.DATABASE_POOL_SIZE) || 3,
      prepare: false,
      idle_timeout: 20,
      onnotice: () => {}, // "already exists, skipping" notices from re-running the schema
      // postgres.js returns bigint and numeric columns as strings by default,
      // so block numbers and wei values never lose precision.
    });
  }
  return globalForDb.__chainmailSql;
}
