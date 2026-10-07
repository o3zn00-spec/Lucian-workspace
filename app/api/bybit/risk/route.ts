import { NextResponse } from "next/server";
import { requireOwnerId } from "@/lib/auth/owner";
import { getTradingProfile } from "@/lib/bybit/trading";
import { updateRiskPolicy } from "@/lib/bybit/terminal";

export const runtime = "nodejs";

export async function GET() {
  try { return NextResponse.json(await getTradingProfile(await requireOwnerId())); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load risk policy." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try { return NextResponse.json(await updateRiskPolicy(await requireOwnerId(), await request.json() as Record<string, unknown>)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update risk policy." }, { status: 400 }); }
}
