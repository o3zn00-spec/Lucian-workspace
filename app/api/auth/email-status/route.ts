// LUCIAN Phase 16 — Email delivery status endpoint.
//
// GET /api/auth/email-status → { configured: boolean }
//
// Used by the forgot-password UI to decide whether to honestly say
// "Email delivery is not configured" or to actually attempt a reset.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** True when SMTP_HOST + SMTP_USER + SMTP_PASS are all present. */
function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function GET() {
  return NextResponse.json({ configured: isEmailConfigured() });
}
