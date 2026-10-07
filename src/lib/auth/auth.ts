// LUCIAN Phase 16 — Auth.js v5 configuration (FINAL CORRECTED).
//
// Architecture (CORRECTED):
//   - Auth.js v5 (next-auth@5.0.0-beta.32) — App Router native, supports
//     Next.js 16 + React 19.
//   - Prisma adapter — used for OAuth Account linking only. We override
//     the adapter's `createUser` so a brand-new Google user gets a valid,
//     unique, normalized LUCIAN username AT THE CREATION BOUNDARY —
//     Prisma never tries to insert a User with a NULL username.
//   - JWT session strategy (NOT database). This is REQUIRED by Auth.js v5
//     when the Credentials provider is registered — combining Credentials
//     with the database session strategy is forbidden and silently breaks
//     sign-in. The previous project revision had this bug; it is corrected
//     here. JWT is stored in an HttpOnly + Secure (prod) + SameSite=Lax
//     cookie. The server resolves the user from the JWT on every request;
//     no authoritative session is held in localStorage.
//   - Credentials provider — accepts a `username` field that may be
//     EITHER a username OR an email. The user is looked up by whichever
//     matches. Password is verified against bcryptjs hash (cost 12).
//   - Google OAuth provider — honestly disabled when GOOGLE_CLIENT_ID /
//     GOOGLE_CLIENT_SECRET are not set. The auth page renders a disabled
//     Google button with setup guidance, NOT a fake Google flow.
//   - JWT carries `sessionVersion`. Every authenticated server resolution
//     compares it against User.sessionVersion. Password change / reset
//     bumps the version, invalidating every previously-issued JWT.
//   - Owner bootstrap is via a dedicated script (scripts/bootstrap-owner.ts)
//     invoked by `npm run bootstrap:owner`. The owner account is created
//     once; subsequent runs are no-ops. The owner password is NEVER in
//     source — it comes from LUCIAN_OWNER_PASSWORD (server-only env var).
//
// SECURITY:
//   - `secret` is required (AUTH_SECRET env var). Auth.js refuses to
//     start without it. Never put secrets in NEXT_PUBLIC_*.
//   - Cookies are HttpOnly + Secure (production) + SameSite=Lax.
//   - The JWT is opaque (signed, encrypted with AUTH_SECRET) — it is
//     only ever decrypted on the server via auth().
//   - `passwordHash` is NEVER included in the user object returned by
//     the credentials provider. The adapter only sees `id`, `email`,
//     `name`, `image`, `emailVerified`.
//   - Logout = clear the JWT cookie via signOut(). The token cannot be
//     reused after the cookie is gone.
//
// This module is SERVER-ONLY.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { AdapterAccount } from "@auth/core/adapters";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { normalizeEmail, isValidEmail, normalizeUsername, isValidUsername } from "@/lib/auth/validation";
import { toAuthError } from "@/lib/auth/errors";
import { isConfiguredOwnerEmail, isOwnerIdentityConfigured } from "@/lib/auth/owner-identity";

/** True when Google OAuth credentials are present in the environment.
 *  Used by the auth UI to render an enabled vs. disabled Google button. */
export function isGoogleConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    isOwnerIdentityConfigured()
  );
}

/** True when the auth secret is present. Without it, Auth.js refuses
 *  to sign or decrypt tokens — the whole auth system fails safe. */
export function isAuthSecretConfigured(): boolean {
  return !!process.env.AUTH_SECRET;
}

/** True when the database is configured. Without it, signup/login
 *  return 503 (database_unavailable) rather than fake success. */
export function isAuthDatabaseConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

/* ── Google username creation boundary ──
 *
 * The Prisma schema requires `User.username` (UNIQUE, NOT NULL). Google
 * does not provide a LUCIAN-compatible username. The default Auth.js
 * `createUser` event fires AFTER the adapter already inserted a User row,
 * which would crash on a NOT NULL violation. We fix this at the actual
 * creation boundary by overriding the adapter's `createUser` method:
 * we synthesize a unique normalized username BEFORE the row is written.
 *
 * Strategy:
 *   - candidate = email local-part, lowercased, [^a-z0-9_] stripped.
 *   - If the local-part starts with a digit (or is empty), prefix with "u".
 *   - Append _2, _3, ... on collision. Race-safe via the unique index
 *     (a concurrent signup that wins the race triggers a P2002 that
 *     the caller maps to username_taken / retry).
 */
function deriveUsernameBase(email: string | null | undefined, name: string | null | undefined): string {
  const localPart = (email ?? "").split("@")[0]?.toLowerCase() ?? "";
  let base = localPart.replace(/[^a-z0-9_]/g, "");
  if (!base && name) {
    base = name.toLowerCase().replace(/[^a-z0-9_]/g, "");
  }
  if (!base) base = "user";
  // Username must start with a letter (see validation.ts USERNAME_RE).
  if (!/^[a-z]/.test(base)) base = `u${base}`;
  // Cap to 32 chars (USERNAME_MAX_LENGTH) so we always have room for a suffix.
  return base.slice(0, 24);
}

async function pickUniqueUsername(seed: string): Promise<string> {
  const base = seed || "user";
  // First attempt: the bare base.
  const candidates: string[] = [base];
  // Generate a few deterministic suffix candidates (2..12) and a small
  // set of random 5-digit ones, so we have a cheap probe sequence before
  // falling back to randomness. We check each via a unique-index lookup
  // (race-safe: a concurrent signup that wins the race triggers a
  // P2002 that the caller surfaces as username_taken).
  for (let i = 2; i <= 12; i++) candidates.push(`${base}_${i}`);
  for (let i = 0; i < 8; i++) {
    candidates.push(`${base}_${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`);
  }
  for (const candidate of candidates) {
    // Username format validation (length + charset) — never let a malformed
    // candidate reach the DB constraint (avoids confusing error messages).
    if (!isValidUsername(candidate)) continue;
    const existing = await db.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  // Extremely unlikely fallback — append a high-entropy random suffix.
  const fallback = `${base}_${Math.random().toString(36).slice(2, 10)}`;
  return fallback.slice(0, 32);
}

/** Build a PrismaAdapter with the `createUser` method overridden so we
 *  synthesize a valid unique username BEFORE the row is inserted.
 *  The default adapter implementation passes `createUser({ user })`
 *  straight to `db.user.create`, which fails on the NOT NULL username
 *  constraint when the OAuth provider doesn't supply one. */
function buildLucianPrismaAdapter() {
  const base = PrismaAdapter(db);
  return {
    ...base,
    createUser: async (user: { email: string; name?: string | null; image?: string | null; emailVerified?: Date | null }) => {
      // OAuth is permitted only for the one configured owner. This check is
      // at the adapter creation boundary, so a non-owner cannot create a row
      // even if they reach a provider callback directly.
      if (!isConfiguredOwnerEmail(user.email)) {
        throw new Error("Owner-only application: account creation refused.");
      }
      // Derive a unique username at the creation boundary.
      const username = await pickUniqueUsername(deriveUsernameBase(user.email, user.name));
      // Create the User row + Profile row atomically. If a User with this
      // email already exists (race with credentials signup), let Prisma
      // throw a P2002 — the Auth.js adapter surfaces that to the caller.
      const created = await db.user.create({
        data: {
          email: normalizeEmail(user.email),
          username,
          name: user.name ?? null,
          image: user.image ?? null,
          emailVerified: user.emailVerified ?? null,
          status: "active",
          sessionVersion: 0,
          profile: {
            create: {
              displayName: user.name ?? user.email.split("@")[0] ?? "Lucian User",
            },
          },
        },
      });
      return created as unknown as Awaited<ReturnType<NonNullable<ReturnType<typeof PrismaAdapter>["createUser"]>>>;
    },
    // LUCIAN uses Google only to prove the immutable owner's identity. It
    // never calls Google APIs on the owner's behalf, so retaining OAuth access,
    // refresh, or ID tokens would add secret exposure with no product benefit.
    linkAccount: async (account: AdapterAccount) => {
      const created = await db.account.create({
        data: {
          userId: account.userId,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          access_token: null,
          refresh_token: null,
          id_token: null,
          session_state: null,
          expires_at: account.expires_at ?? null,
          token_type: account.token_type ?? null,
          scope: account.scope ?? null,
        },
      });
      return created as unknown as AdapterAccount;
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: buildLucianPrismaAdapter(),

  // JWT session strategy — REQUIRED for the Credentials provider.
  // The JWT is stored in an HttpOnly + Secure + SameSite=Lax cookie.
  // The server resolves the user from the JWT on every request.
  session: { strategy: "jwt" },

  // Auth.js v5 secret. Required. Set AUTH_SECRET to a 32+ char random
  // string. Generate with: openssl rand -base64 32
  secret: process.env.AUTH_SECRET,

  // Trust the Host header from incoming requests. Required for non-Vercel
  // deployments (Vercel auto-detects). Set to true when AUTH_SECRET is
  // configured — the secret is what actually secures the session, so
  // trusting the host header (which is just used to build absolute URLs
  // for OAuth callbacks / email links) is safe.
  trustHost: !!process.env.AUTH_SECRET,

  // Cookie configuration — strict defaults for production.
  cookies: {
    sessionToken: {
      name: `lucian.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    csrfToken: {
      name: `lucian.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    callbackUrl: {
      name: `lucian.callback-url`,
      options: {
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    pkceCodeVerifier: {
      name: `lucian.pkce.code-verifier`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 15, // 15 minutes
      },
    },
    state: {
      name: `lucian.state`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 15,
      },
    },
    nonce: {
      name: `lucian.nonce`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 15,
      },
    },
  },

  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        // The form field is named `username` but it accepts either an
        // email or a username. The server resolves it both ways.
        username: { label: "Username or Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // Defensive: the credentials provider passes whatever the
        // signin form sent. Validate before touching the DB.
        const raw = String(credentials?.username ?? "").trim();
        const password = String(credentials?.password ?? "");
        if (!raw || !password) return null;

        // Resolve the user by EITHER usernameOR email.
        const isEmail = isValidEmail(raw);
        const normalizedEmail = isEmail ? normalizeEmail(raw) : null;
        const normalizedUsername = !isEmail ? normalizeUsername(raw) : null;
        if (!normalizedEmail && !normalizedUsername) return null;

        try {
          // Try email first, fall back to username. We do two queries
          // rather than an OR clause so the existing unique indexes
          // are used (more efficient + race-safe against concurrent
          // signup).
          let user = null as
            | {
                id: string;
                email: string;
                username: string;
                name: string | null;
                image: string | null;
                emailVerified: Date | null;
                passwordHash: string | null;
                status: string;
                sessionVersion: number;
              }
            | null;
          if (normalizedEmail) {
            user = await db.user.findUnique({
              where: { email: normalizedEmail },
              select: {
                id: true, email: true, username: true, name: true, image: true,
                emailVerified: true, passwordHash: true, status: true, sessionVersion: true,
              },
            });
          } else if (normalizedUsername) {
            user = await db.user.findUnique({
              where: { username: normalizedUsername },
              select: {
                id: true, email: true, username: true, name: true, image: true,
                emailVerified: true, passwordHash: true, status: true, sessionVersion: true,
              },
            });
          }

          // Generic error — do not reveal whether the identity exists.
          if (!user) return null;
          if (user.status === "disabled") return null;
          if (!isConfiguredOwnerEmail(user.email)) return null;
          if (!user.passwordHash) return null; // OAuth-only account

          const ok = await verifyPassword(password, user.passwordHash);
          if (!ok) return null;

          // Return only safe fields. passwordHash is dropped here.
          // sessionVersion is attached so the jwt() callback can stamp it
          // onto the token (the session() callback then verifies it
          // against the DB row on every authenticated request).
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            emailVerified: user.emailVerified,
            sessionVersion: user.sessionVersion,
          };
        } catch (err) {
          // Database unreachable — fail safe (treat as invalid creds
          // rather than leaking DB state). Log to server only.
          console.error("[auth] credentials authorize DB error:", toAuthError(err).code);
          return null;
        }
      },
    }),

    // Google OAuth — only registered when both env vars are present.
    // When absent, the provider is omitted from the array entirely,
    // so Auth.js will refuse any Google callback attempt.
    ...(isGoogleConfigured()
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            // Allow linking a Google account to an existing credentials
            // account with the same email. Auth.js's Prisma adapter
            // handles the linking via the Account table.
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],

  callbacks: {
    // SignIn callback — refuse disabled users.
    async signIn({ user }) {
      if (!user?.email) return false;
      if (!isConfiguredOwnerEmail(user.email)) return false;
      try {
        const dbUser = await db.user.findUnique({
          where: { email: normalizeEmail(user.email) },
          select: { status: true, sessionVersion: true },
        });
        if (!dbUser || dbUser.status === "disabled") return false;
        return true;
      } catch {
        // Owner authorization fails closed when the database cannot verify
        // the immutable identity.
        return false;
      }
    },

    // JWT callback — attach the user's id + status + sessionVersion to
    // the JWT on first sign-in. On subsequent requests, the JWT already
    // has these fields. session() then verifies the token's sessionVersion
    // against the DB row on every authenticated request — if a password
    // change / reset bumped the DB version, the token is rejected.
    async jwt({ token, user }) {
      if (user) {
        // `user` is only set on the first sign-in call. We persist
        // id + status + sessionVersion into the JWT so session() can
        // verify them.
        token.id = user.id;
        token.status = (user as { status?: string }).status ?? "active";
        token.sessionVersion = (user as { sessionVersion?: number }).sessionVersion ?? 0;
      }
      return token;
    },

    // Session callback — expose only safe fields. Never expose
    // passwordHash. The session's user.id is the canonical userId
    // for all ownership queries. We also verify the JWT's
    // sessionVersion against the DB row on every authenticated
    // request — a mismatch invalidates the session (password reset /
    // change bumped the DB version).
    async session({ session, token }) {
      if (session.user) {
        // The JWT carries the id + status + sessionVersion we attached
        // in the jwt() callback. Use it as the source of truth.
        const tokenVersion = (token.sessionVersion as number | undefined) ?? 0;
        (session.user as { id?: string }).id = token.id as string | undefined;
        (session.user as { status?: string }).status =
          (token.status as string | undefined) ?? "active";

        // JWT revocation check — verify the token's sessionVersion
        // against the DB row. If the user reset their password (or a
        // security bump fired) after this JWT was issued, the DB version
        // will be higher and we return an empty session so the client
        // sees "unauthenticated" and is forced to re-login.
        if (token.id) {
          try {
            const dbUser = await db.user.findUnique({
              where: { id: token.id as string },
              select: { sessionVersion: true, status: true, email: true },
            });
            if (!dbUser || dbUser.status !== "active" || !isConfiguredOwnerEmail(dbUser.email) || dbUser.sessionVersion !== tokenVersion) {
              // Token is stale — invalidate the session by clearing
              // the user object. The client treats this as
              // "unauthenticated" and the user is redirected to login.
              // We do NOT throw here because NextAuth's session()
              // callback expects a session object; returning one
              // with no user.id effectively unauthenticates the request.
              (session.user as { id?: string }).id = undefined;
              (session.user as { status?: string }).status = undefined;
              return session;
            }
            // Refresh the status from the DB (so a freshly disabled
            // user is signed out on the next request).
            (session.user as { status?: string }).status = dbUser.status;
          } catch {
            // Owner-only sessions fail closed if the database cannot verify
            // the current identity and revocation version.
            (session.user as { id?: string }).id = undefined;
            (session.user as { status?: string }).status = undefined;
          }
        }
      }
      return session;
    },

    // Redirect callback — ensure post-login redirect stays inside
    // the app. Auth.js v5 validates callbackUrl automatically; this
    // is an extra safety net.
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
  },

  pages: {
    // Custom page routes — Auth.js redirects here for sign-in.
    signIn: "/login",
    error: "/login",
  },

  events: {
    // The Profile row is created at the creation boundary in
    // buildLucianPrismaAdapter().createUser, so the createUser event
    // here is a no-op. We keep the event registered for logging only.
    async createUser() {
      // intentionally empty — username + Profile are created at the
      // adapter boundary (see buildLucianPrismaAdapter above).
    },
  },
});
