import { NextResponse } from "next/server";
import { hasBearer } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["visible", "spam", "hidden"]);

// Moderation. Body: { "tx_hash": "0x...", "status": "hidden" | "visible" | "spam" }
// Header: Authorization: Bearer $ADMIN_SECRET
export async function POST(request: Request) {
  if (!hasBearer(request, process.env.ADMIN_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { tx_hash?: string; status?: string } | null;
  const txHash = body?.tx_hash?.toLowerCase();
  const status = body?.status ?? "hidden";
  if (!txHash || !/^0x[0-9a-f]{64}$/.test(txHash) || !STATUSES.has(status)) {
    return NextResponse.json({ error: "need tx_hash and a valid status" }, { status: 400 });
  }

  const reason = status === "visible" ? null : status === "hidden" ? "hidden by moderator" : "marked spam by moderator";
  const result = await db()`
    update messages set status = ${status}, spam_reason = ${reason}
    where tx_hash = ${txHash}`;
  if (result.count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ tx_hash: txHash, status });
}
