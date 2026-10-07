// LUCIAN Phase 16 — Auth input validation.
// Server-side validation for username + email + password + display name.

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MIN_LENGTH = 1;
export const DISPLAY_NAME_MAX_LENGTH = 64;
export const EMAIL_MAX_LENGTH = 254;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Username: lowercase letters, digits, underscore, hyphen. Must start
// with a letter. Case-insensitive on input (we normalize to lowercase).
const USERNAME_RE = /^[a-z][a-z0-9_-]{2,31}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  if (!email) return false;
  if (email.length > EMAIL_MAX_LENGTH) return false;
  return EMAIL_RE.test(email);
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  if (!username) return false;
  const norm = normalizeUsername(username);
  if (norm.length < USERNAME_MIN_LENGTH) return false;
  if (norm.length > USERNAME_MAX_LENGTH) return false;
  return USERNAME_RE.test(norm);
}

export function isValidPassword(password: string): boolean {
  if (!password) return false;
  if (password.length < PASSWORD_MIN_LENGTH) return false;
  if (password.length > PASSWORD_MAX_LENGTH) return false;
  if (!/[a-zA-Z]/.test(password)) return false;
  if (!/\d/.test(password)) return false;
  return true;
}

export function isValidDisplayName(name: string): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < DISPLAY_NAME_MIN_LENGTH) return false;
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) return false;
  if (/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/.test(trimmed)) return false;
  return true;
}

export interface PasswordValidationError {
  code:
    | "too_short"
    | "too_long"
    | "missing_letter"
    | "missing_digit";
  message: string;
}

export function validatePasswordDetailed(
  password: string,
): PasswordValidationError | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      code: "too_short",
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      code: "too_long",
      message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return {
      code: "missing_letter",
      message: "Password must include at least one letter.",
    };
  }
  if (!/\d/.test(password)) {
    return {
      code: "missing_digit",
      message: "Password must include at least one digit.",
    };
  }
  return null;
}
