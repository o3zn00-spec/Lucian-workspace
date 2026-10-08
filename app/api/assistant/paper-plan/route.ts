import { requireOwnerId } from "@/lib/auth/owner";
import { AuthError } from "@/lib/auth/errors";
import { paperPlanSnapshot, savePaperPlan } from "@/lib/assistant/paper-plan";
import { PaperPlanError } from "@/lib/assistant/paper-policy";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function failure(error: unknown) {
  const status = error instanceof AuthError ? error.statusCode : error instanceof PaperPlanError ? error.status : 503;
  return Response.json({ ok: false, error: error instanceof PaperPlanError ? error.message : "Paper plan storage unavailable. No session started." }, { status });
}
export async function GET() {
  try { return Response.json({ ok: true, ...await paperPlanSnapshot(await requireOwnerId()) }); } catch (error) { return failure(error); }
}
export async function PUT(req: Request) {
  try {
    const userId = await requireOwnerId();
    if (req.headers.get("origin") !== new URL(process.env.AUTH_APP_URL ?? req.url).origin) return Response.json({ ok: false, error: "Same-origin request required." }, { status: 403 });
    const raw = await req.text();
    if (raw.length > 5000) return Response.json({ ok: false, error: "Plan too large." }, { status: 413 });
    let body;
    try { body = JSON.parse(raw); } catch { throw new PaperPlanError("Invalid plan JSON."); }
    return Response.json({ ok: true, ...await savePaperPlan(userId, body) });
  } catch (error) { return failure(error); }
}
