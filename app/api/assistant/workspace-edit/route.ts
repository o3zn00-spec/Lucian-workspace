import { requireOwnerId, ownerErrorResponse } from "@/lib/auth/owner";
import { applyWorkspaceEdit, getWorkspaceEdit, EditReviewError } from "@/lib/assistant/workspace-edits";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  let userId: string;
  try { userId = await requireOwnerId(); } catch (error) { return ownerErrorResponse(error); }
  try { return Response.json({ ok: true, proposal: await getWorkspaceEdit(userId, new URL(req.url).searchParams.get("id") ?? "") }); }
  catch { return Response.json({ ok: false, error: "Edit proposal unavailable." }, { status: 404 }); }
}
export async function POST(req: Request) {
  let userId: string;
  try { userId = await requireOwnerId(); } catch (error) { return ownerErrorResponse(error); }
  if (req.headers.get("origin") !== new URL(process.env.AUTH_APP_URL ?? req.url).origin) return Response.json({ ok: false }, { status: 403 });
  try {
    const raw = await req.text();
    if (raw.length > 300) return Response.json({ ok: false }, { status: 413 });
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 2 || typeof body.id !== "string" || body.confirmed !== true) return Response.json({ ok: false }, { status: 400 });
    return Response.json({ ok: true, proposal: await applyWorkspaceEdit(userId, body.id) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof EditReviewError ? error.message : "Unable to apply proposal." }, { status: 409 });
  }
}
