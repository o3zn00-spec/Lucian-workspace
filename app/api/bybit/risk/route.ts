import { NextResponse } from "next/server";
import { requireOwnerId } from "@/lib/auth/owner";
import { getTradingProfile } from "@/lib/bybit/trading";
import { updateRiskPolicy } from "@/lib/bybit/terminal";
import { initializeSpotRisk } from "@/lib/bybit/spot-risk";

export const runtime = "nodejs";

export async function GET() {
  try { return NextResponse.json(await getTradingProfile(await requireOwnerId())); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load risk policy." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try { return NextResponse.json(await updateRiskPolicy(await requireOwnerId(), await request.json() as Record<string, unknown>)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update risk policy." }, { status: 400 }); }
}

export async function POST(request: Request) {
  try { const userId = await requireOwnerId(); const input = await request.json() as {mode?:unknown}; return NextResponse.json(await initializeSpotRisk(userId, input.mode)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to initialize Spot accounting." }, { status: 400 }); }
}
