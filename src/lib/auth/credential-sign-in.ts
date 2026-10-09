import { sanitizeCallbackUrl } from "./safe-redirect";

/** Credentials only: retain Auth.js CSRF/cookies while handling middleware
 * errors before parsing its redirect response. Never infer login success. */
export async function credentialSignIn(username: string, password: string, callback: string | null, request: typeof fetch = fetch): Promise<void> {
  const csrfResponse = await request("/api/auth/csrf", { cache: "no-store" });
  const csrf = await csrfResponse.json().catch(() => null);
  if (!csrfResponse.ok || typeof csrf?.csrfToken !== "string" || !csrf.csrfToken) throw new Error("Sign-in protection could not load. Please try again shortly.");
  const response = await request("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" },
    body: new URLSearchParams({ username, password, csrfToken: csrf.csrfToken, callbackUrl: sanitizeCallbackUrl(callback) }),
  });
  const data = await response.json().catch(() => null);
  if (response.status === 429) {
    const seconds = Number(response.headers.get("Retry-After"));
    throw new Error(`Too many sign-in attempts. Please wait${Number.isFinite(seconds) && seconds > 0 ? ` ${Math.ceil(seconds / 60)} minute(s)` : " a few minutes"} before trying again.`);
  }
  if (response.status === 503) throw new Error("Sign-in protection is temporarily unavailable. Please try again shortly.");
  if (!response.ok || typeof data?.url !== "string") throw new Error("Sign-in could not complete. Please try again shortly.");
  let destination: URL;
  try { destination = new URL(data.url, "https://auth.local"); } catch { throw new Error("Sign-in returned an invalid response. Please try again shortly."); }
  const error = destination.searchParams.get("error");
  if (error === "CredentialsSignin") throw new Error("Invalid username/email or password.");
  if (error) throw new Error("Sign-in could not complete. Please try again shortly.");
  // A valid redirect alone cannot establish identity. Verify the server session
  // before allowing the success animation/navigation.
  const sessionResponse = await request("/api/auth/session", { cache: "no-store" });
  const session = await sessionResponse.json().catch(() => null);
  if (!sessionResponse.ok || typeof session?.user?.id !== "string" || !session.user.id) throw new Error("Your session could not be verified. Please try signing in again.");
}
