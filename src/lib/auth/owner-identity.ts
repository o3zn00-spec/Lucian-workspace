import "server-only";

import { isValidEmail, normalizeEmail } from "@/lib/auth/validation";

/**
 * The single immutable LUCIAN owner is deployment configuration, not a
 * request field or a mutable profile value. The application fails closed
 * when this value is missing.
 */
export function configuredOwnerEmail(): string | null {
  const raw = process.env.LUCIAN_OWNER_EMAIL;
  if (!raw) return null;
  const normalized = normalizeEmail(raw);
  return isValidEmail(normalized) ? normalized : null;
}

export function isConfiguredOwnerEmail(email: string | null | undefined): boolean {
  const ownerEmail = configuredOwnerEmail();
  return !!ownerEmail && normalizeEmail(email ?? "") === ownerEmail;
}

export function isOwnerIdentityConfigured(): boolean {
  return configuredOwnerEmail() !== null;
}
