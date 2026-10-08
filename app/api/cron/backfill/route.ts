import { NextResponse } from "next/server";
import { hasBearer } from "@/lib/auth";
import { backfillLabels, backfillRecent } from "@/lib/backfill";
import { db } from "@/lib/db";

async function logRun(mode: string, result: unknown) {
  try {
    await db()`create table if not exists backfill_runs (
      id bigserial primary key, at timestamptz not null default now(), mode text not null, result jsonb not null)`;
    await db()`insert into backfill_runs (mode, result) values (${mode}, ${db().json(result as never)})`;
  } catch (err) {
    console.error("could not log backfill run", err);
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/cron/backfill?mode=recent&days=30&blocks=600
// POST /api/cron/backfill?mode=labels            (repeat until remaining is 0)
// POST /api/cron/backfill?mode=labels&restart=1  (start over from the first address)
// Header: Authorization: Bearer $CRON_SECRET
export async function POST(request: Request) {
  if (!hasBearer(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = new URL(request.url).searchParams;
  const mode = q.get("mode") ?? "recent";

  try {
    if (mode === "labels") {
      const result = await backfillLabels({ restart: q.get("restart") === "1" });
      await logRun(mode, result);
      return NextResponse.json(result);
    }
    const days = Math.min(Math.max(Number(q.get("days")) || 30, 1), 365);
    const blocks = Math.min(Math.max(Number(q.get("blocks")) || 600, 10), 3000);
    const result = await backfillRecent(days, blocks);
    await logRun(mode, { days, ...result });
    return NextResponse.json(result);
  } catch (err) {
    console.error("backfill failed", err);
    await logRun(mode, { error: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
