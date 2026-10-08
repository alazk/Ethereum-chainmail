import { NextResponse } from "next/server";
import { hasBearer } from "@/lib/auth";
import { DEFAULT_MAX_BLOCKS, ingest } from "@/lib/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Called by Vercel cron (GET) and by the GitHub Action (POST).
// Both send "Authorization: Bearer $CRON_SECRET".
async function handle(request: Request) {
  if (!hasBearer(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("blocks"));
  const maxBlocks =
    Number.isFinite(requested) && requested > 0 ? Math.min(requested, 500) : DEFAULT_MAX_BLOCKS;

  try {
    const result = await ingest(maxBlocks);
    return NextResponse.json(result);
  } catch (err) {
    console.error("ingest failed", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
