// LUCIAN Phase 16 — Typed auth errors.

export type AuthErrorCode =
  | "invalid_credentials"
  | "email_taken"
  | "username_taken"
  | "invalid_email"
  | "invalid_username"
  | "weak_password"
  | "password_mismatch"
  | "user_disabled"
  | "user_not_found"
  | "reset_token_invalid"
  | "reset_token_expired"
  | "reset_token_used"
  | "session_expired"
  | "session_invalid"
  | "database_unavailable"
  | "google_not_configured"
  | "email_not_configured"
  | "rate_limited"
  | "unauthorized"
  | "bad_request"
  | "internal_error";

export class AuthError extends Error {
  constructor(
    public code: AuthErrorCode,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export const invalidCredentials = () =>
  new AuthError("invalid_credentials", "Invalid email or password.", 401);

export const emailTaken = () =>
  new AuthError("email_taken", "An account with this email already exists.", 409);

export const usernameTaken = () =>
  new AuthError("username_taken", "An account with this username already exists.", 409);

export const invalidUsername = (msg = "Username must be 3–32 chars, start with a letter, and only contain letters, digits, underscores, or hyphens.") =>
  new AuthError("invalid_username", msg, 400);

export const invalidEmail = (msg = "Please enter a valid email address.") =>
  new AuthError("invalid_email", msg, 400);

export const weakPassword = (msg: string) =>
  new AuthError("weak_password", msg, 400);

export const passwordMismatch = () =>
  new AuthError("password_mismatch", "Passwords do not match.", 400);

export const userDisabled = () =>
  new AuthError("user_disabled", "This account has been disabled.", 403);

export const userNotFound = () =>
  new AuthError("user_not_found", "User not found.", 404);

export const resetTokenInvalid = () =>
  new AuthError("reset_token_invalid", "This reset link is not valid.", 400);

export const resetTokenExpired = () =>
  new AuthError(
    "reset_token_expired",
    "This reset link has expired. Please request a new one.",
    400,
  );

export const resetTokenUsed = () =>
  new AuthError(
    "reset_token_used",
    "This reset link has already been used. Please request a new one.",
    400,
  );

export const sessionExpired = () =>
  new AuthError("session_expired", "Your session has expired.", 401);

export const sessionInvalid = () =>
  new AuthError("session_invalid", "Your session is no longer valid.", 401);

export const databaseUnavailable = () =>
  new AuthError(
    "database_unavailable",
    "The database is temporarily unavailable. Please try again.",
    503,
  );

export const googleNotConfigured = () =>
  new AuthError(
    "google_not_configured",
    "Google authentication is not configured on this server.",
    503,
  );

export const emailNotConfigured = () =>
  new AuthError(
    "email_not_configured",
    "Email delivery is not configured on this server.",
    503,
  );

export const rateLimited = (msg = "Too many requests. Please try again later.") =>
  new AuthError("rate_limited", msg, 429);

export const unauthorized = () =>
  new AuthError("unauthorized", "You must be signed in to do this.", 401);

export const badRequest = (msg: string) =>
  new AuthError("bad_request", msg, 400);

export const internalError = (msg = "Something went wrong. Please try again.") =>
  new AuthError("internal_error", msg, 500);

/** Map any unknown error to an AuthError with a safe fallback.
 *  Never leak internal error details to the client. */
export function toAuthError(err: unknown): AuthError {
  if (err instanceof AuthError) return err;
  const msg = String((err as Error)?.message ?? err);
  if (
    msg.includes("connect") ||
    msg.includes("Database") ||
    msg.includes("prisma") ||
    msg.includes("P1001") ||
    msg.includes("P1002") ||
    msg.includes("Timed out")
  ) {
    return databaseUnavailable();
  }
  if (process.env.NODE_ENV !== "production") {
    return new AuthError("internal_error", `Internal error: ${msg}`, 500);
  }
  return internalError();
}
