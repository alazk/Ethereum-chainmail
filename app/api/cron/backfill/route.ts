import { NextResponse } from "next/server";
import { hasBearer } from "@/lib/auth";
import { backfillLabels, backfillRecent } from "@/lib/backfill";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/cron/backfill?mode=recent&days=30&blocks=600
// POST /api/cron/backfill?mode=labels
// Header: Authorization: Bearer $CRON_SECRET
export async function POST(request: Request) {
  if (!hasBearer(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = new URL(request.url).searchParams;
  const mode = q.get("mode") ?? "recent";

  try {
    if (mode === "labels") {
      return NextResponse.json(await backfillLabels());
    }
    const days = Math.min(Math.max(Number(q.get("days")) || 30, 1), 365);
    const blocks = Math.min(Math.max(Number(q.get("blocks")) || 600, 10), 3000);
    return NextResponse.json(await backfillRecent(days, blocks));
  } catch (err) {
    console.error("backfill failed", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
