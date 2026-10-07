// LUCIAN Phase 16 — Auth health endpoint.
//
// GET /api/auth/health → { database, secret, google, email, name }
//
// Returns the HONEST auth infrastructure status. The Settings →
// Connections / About sections read this so the UI never lies about
// what is configured.

import { NextResponse } from "next/server";
import { isGoogleConfigured, isAuthSecretConfigured, isAuthDatabaseConfigured } from "@/lib/auth/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const emailConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  return NextResponse.json({
    database: isAuthDatabaseConfigured(),
    secret: isAuthSecretConfigured(),
    google: isGoogleConfigured(),
    email: emailConfigured,
  });
}
