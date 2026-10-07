// LUCIAN Phase 16 — Google OAuth status endpoint.
//
// GET /api/auth/google-status → { configured: boolean }
//
// The auth UI calls this to decide whether to render an enabled Google
// button or a disabled one with setup guidance. This is HONEST — it
// returns false when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are
// missing, never fakes "configured: true".

import { NextResponse } from "next/server";
import { isGoogleConfigured } from "@/lib/auth/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ configured: isGoogleConfigured() });
}
