// LUCIAN Phase 16 — Password reset request endpoint.
//
// POST /api/auth/reset-password/request
//   { email }
//
// Server flow:
//   1. Validate email format.
//   2. Look up the user by email.
//      - If found: generate a one-time reset token, hash it (SHA-256),
//        store the hash with expiry (1 hour), and attempt to email the
//        raw token via nodemailer if SMTP credentials are configured.
//      - If not found: do NOT reveal — return the same success response.
//        This is account-enumeration hardening (NIST SP 800-63B).
//   3. If no email provider is configured, the response honestly says
//      "Email delivery is not configured" — we do NOT pretend an email
//      was sent.
//
// The raw token is NEVER stored. The DB stores only the SHA-256 hash.
// The token is one-time use (usedAt is set on confirm).
//
// If SMTP credentials are present, the email contains a link to
// /reset-password?token=... — clicking it opens the reset form.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isValidEmail, normalizeEmail } from "@/lib/auth/validation";
import {
  AuthError,
  badRequest,
  invalidEmail,
  emailNotConfigured,
  toAuthError,
} from "@/lib/auth/errors";
import { createTransport } from "nodemailer";
import { configuredOwnerEmail } from "@/lib/auth/owner-identity";

export const dynamic = "force-dynamic";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

interface RequestBody {
  email?: unknown;
}

export async function POST(req: Request) {
  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return errorResponse(badRequest("Invalid request body."));
  }

  const email = normalizeEmail(String(body.email ?? ""));
  if (!isValidEmail(email)) return errorResponse(invalidEmail());

  const ownerEmail = configuredOwnerEmail();
  if (!ownerEmail) {
    return NextResponse.json(
      { ok: false, error: "The LUCIAN owner identity is not configured.", code: "owner_not_configured" },
      { status: 503 },
    );
  }

  if (!process.env.DATABASE_URL) {
    return errorResponse({
      code: "database_unavailable",
      message: "The database is temporarily unavailable. Please try again.",
      statusCode: 503,
      name: "AuthError",
    } as AuthError);
  }

  // Email delivery — honestly reported when not configured.
  const smtpConfigured = !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
  const resetBaseUrl = resolveResetBaseUrl(req);
  if (smtpConfigured && !resetBaseUrl) {
    return NextResponse.json(
      { ok: false, error: "Owner recovery email is configured incorrectly. Set AUTH_APP_URL to the public HTTPS origin.", code: "email_configuration_invalid" },
      { status: 503 },
    );
  }

  try {
    const user = email === ownerEmail ? await db.user.findUnique({
      where: { email: ownerEmail },
      select: { id: true, name: true, status: true },
    }) : null;

    if (user && user.status !== "disabled") {
      // Generate raw token (32 bytes, base64url).
      const rawToken = generateRawToken();
      const hashedToken = await sha256Hex(rawToken);

      // Persist the hashed token with expiry. Old (unused, expired)
      // tokens for this user are pruned to keep the table small.
      await db.passwordResetToken.deleteMany({
        where: { userId: user.id, usedAt: null },
      }).catch(() => { /* non-fatal */ });

      await db.passwordResetToken.create({
        data: {
          userId: user.id,
          token: hashedToken,
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });

      // Try to deliver the email. If SMTP is not configured, the
      // response below honestly says so — we never claim an email
      // was sent when it wasn't.
      if (smtpConfigured) {
        const resetUrl = `${resetBaseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
        await sendResetEmail(email, resetUrl, user.name ?? "").catch((err) => {
          console.error("[auth] password reset email send failed:", toAuthError(err).code);
          // We do NOT surface this error to the client to avoid
          // revealing whether the email exists. The UI message is
          // the same as the success path.
        });
      }
    }

    // Always return the same response shape — even when the user
    // was not found — to prevent enumeration. The UI shows a generic
    // "if an account exists, a reset link was sent" message.
    if (smtpConfigured) {
      return NextResponse.json({
        ok: true,
        message: "If the owner account matches and email delivery succeeds, a reset link will arrive shortly.",
        emailDelivery: "configured",
      });
    }
    // Email delivery is NOT configured — the user explicitly needs to
    // know this. The reset token IS in the DB (and could be retrieved
    // by the deployment operator), but no email was sent.
    return NextResponse.json({
      ok: true,
      message: "Owner recovery email is not configured on this server.",
      emailDelivery: "not_configured",
    });
  } catch (err) {
    return errorResponse(toAuthError(err));
  }
}

function resolveResetBaseUrl(req: Request): string | null {
  const configured = process.env.AUTH_APP_URL?.trim();
  const candidate = configured || (process.env.NODE_ENV === "production" ? "" : new URL(req.url).origin);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") return null;
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function generateRawToken(): string {
  // 32 bytes of crypto-strength randomness, base64url (URL-safe).
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

async function sendResetEmail(to: string, resetUrl: string, displayName: string): Promise<void> {
  const transport = createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // Reset emails are fully constructed by LUCIAN. Never let Nodemailer
    // resolve file paths or remote URLs from message content.
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? "LUCIAN <no-reply@lucian.local>",
    to,
    subject: "Reset your LUCIAN password",
    text: `Hello ${displayName},\n\nUse the link below to reset your LUCIAN password. This link expires in 1 hour and can only be used once.\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.\n\n— LUCIAN`,
  });
}

function errorResponse(err: AuthError): NextResponse {
  return NextResponse.json(
    { ok: false, error: err.message, code: err.code },
    { status: err.statusCode },
  );
}

// Avoid unused-import errors for emailNotConfigured (kept for the
// public type contract — other modules import it from this module if
// they need the exact code).
void emailNotConfigured;
