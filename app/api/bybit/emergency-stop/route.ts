import { NextResponse } from "next/server";
import { requireOwnerId } from "@/lib/auth/owner";
import { setEmergencyStop } from "@/lib/bybit/terminal";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try { return NextResponse.json(await setEmergencyStop(await requireOwnerId(), await request.json() as Record<string, unknown>)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Emergency-stop action failed." }, { status: 400 }); }
}
