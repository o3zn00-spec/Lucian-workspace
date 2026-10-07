import "server-only";

import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth/errors";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import { configuredOwnerEmail } from "@/lib/auth/owner-identity";

export class OwnerAccessError extends AuthError {
  constructor(code: "owner_not_configured" | "owner_required", message: string, statusCode: number) {
    super("unauthorized", message, statusCode);
    this.name = code;
  }
}

/**
 * Resolve the only identity allowed to use LUCIAN. Both the signed token and
 * the current database row must match the configured owner email and id.
 */
export async function getCurrentOwner(): Promise<SessionUser | null> {
  const ownerEmail = configuredOwnerEmail();
  if (!ownerEmail) return null;

  const sessionUser = await getCurrentUser();
  if (!sessionUser || sessionUser.email.toLowerCase() !== ownerEmail) return null;

  const owner = await db.user.findUnique({
    where: { email: ownerEmail },
    select: { id: true, email: true, status: true },
  });
  if (!owner || owner.status !== "active" || owner.id !== sessionUser.id) return null;
  return sessionUser;
}

export async function requireOwner(): Promise<SessionUser> {
  if (!configuredOwnerEmail()) {
    throw new OwnerAccessError(
      "owner_not_configured",
      "The LUCIAN owner identity is not configured.",
      503,
    );
  }
  const owner = await getCurrentOwner();
  if (!owner) {
    throw new OwnerAccessError(
      "owner_required",
      "This private LUCIAN workspace is available only to its configured owner.",
      403,
    );
  }
  return owner;
}

export async function requireOwnerId(): Promise<string> {
  return (await requireOwner()).id;
}

export function ownerErrorResponse(error: unknown): Response {
  const authError = error instanceof AuthError ? error : null;
  return Response.json(
    {
      ok: false,
      error: authError?.message ?? "The protected owner operation could not be completed.",
      code: authError?.name ?? "owner_operation_failed",
    },
    { status: authError?.statusCode ?? 500 },
  );
}
