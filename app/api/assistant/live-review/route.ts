import { requireOwnerId } from "@/lib/auth/owner";
import { AuthError } from "@/lib/auth/errors";
import { LiveReviewError } from "@/lib/assistant/live-review-policy";
import { startLiveReview, controlLiveReview, liveReviewSnapshot, recordLiveReviewRun } from "@/lib/assistant/live-review-runtime";
import { liveReviewWorkflow } from "@/workflows/live-review";
import { start } from "workflow/api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
function failure(error: unknown) {
  return Response.json({ ok: false, error: error instanceof LiveReviewError ? error.message : "Live research unavailable. Refresh its status; no order was placed." }, { status: error instanceof AuthError ? error.statusCode : error instanceof LiveReviewError ? error.status : 503 });
}
export async function GET() {
  try { return Response.json({ ok: true, ...await liveReviewSnapshot(await requireOwnerId()) }); } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const userId = await requireOwnerId();
    if (req.headers.get("origin") !== new URL(process.env.AUTH_APP_URL ?? req.url).origin) return Response.json({ ok: false, error: "Same-origin request required." }, { status: 403 });
    const raw = await req.text(); if (raw.length > 3000) throw new LiveReviewError("Live research request too large.");
    let body; try { body = JSON.parse(raw); } catch { throw new LiveReviewError("Invalid live research request."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new LiveReviewError("Invalid live research request.");
    const s = body.action === "start" ? await startLiveReview(userId, body) : await controlLiveReview(userId, body);
    if (s.status !== "stopped") {
      try { const run = await start(liveReviewWorkflow, [userId, s.id, s.generation], { region: "cpt1" }); await recordLiveReviewRun(userId, s.id, s.generation, run.runId); }
      catch { await recordLiveReviewRun(userId, s.id, s.generation, null); }
    }
    return Response.json({ ok: true, ...await liveReviewSnapshot(userId) });
  } catch (error) { return failure(error); }
}
