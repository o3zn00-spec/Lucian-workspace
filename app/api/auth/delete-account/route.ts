import { NextResponse } from "next/server";

import { requireOwnerId } from "@/lib/auth/owner";
import { AuthError } from "@/lib/auth/errors";

export const dynamic = "force-dynamic";

/** The immutable owner can recover access, but cannot orphan the workspace. */
export async function POST() {
  try {
    await requireOwnerId();
  } catch (error) {
    const authError = error as AuthError;
    return NextResponse.json(
      { ok: false, error: authError.message, code: authError.name },
      { status: authError.statusCode ?? 403 },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      error: "The immutable LUCIAN owner account cannot be deleted from the application.",
      code: "owner_immutable",
    },
    { status: 403 },
  );
}
