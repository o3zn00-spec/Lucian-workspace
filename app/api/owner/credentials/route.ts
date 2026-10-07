import { NextResponse } from "next/server";

import { requireOwnerId, ownerErrorResponse } from "@/lib/auth/owner";
import {
  deleteOwnerCredential,
  isAllowedOwnerCredential,
  listOwnerCredentialStatus,
  writeOwnerCredential,
} from "@/lib/security/owner-credentials";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const ownerUserId = await requireOwnerId();
    return NextResponse.json({ ok: true, credentials: await listOwnerCredentialStatus(ownerUserId) });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const ownerUserId = await requireOwnerId();
    const body = await request.json() as { service?: unknown; key?: unknown; value?: unknown };
    const service = String(body.service ?? "").toLowerCase();
    const keyName = String(body.key ?? "").toLowerCase();
    const value = String(body.value ?? "");
    if (!isAllowedOwnerCredential(service, keyName) || !value.trim()) {
      return NextResponse.json({ ok: false, error: "Invalid credential request.", code: "bad_request" }, { status: 400 });
    }
    await writeOwnerCredential(ownerUserId, service, keyName, value);
    return NextResponse.json({ ok: true, configured: true });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const ownerUserId = await requireOwnerId();
    const url = new URL(request.url);
    const service = (url.searchParams.get("service") ?? "").toLowerCase();
    const keyName = (url.searchParams.get("key") ?? "").toLowerCase();
    if (!isAllowedOwnerCredential(service, keyName)) {
      return NextResponse.json({ ok: false, error: "Invalid credential request.", code: "bad_request" }, { status: 400 });
    }
    await deleteOwnerCredential(ownerUserId, service, keyName);
    return NextResponse.json({ ok: true, configured: false });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
