import { requireOwnerId } from "@/lib/auth/owner";
import { AuthError } from "@/lib/auth/errors";
import { changeTradingPlan, tradingPlanSnapshot } from "@/lib/assistant/trading-plan";
import { TradingPlanError } from "@/lib/assistant/trading-plan-policy";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  return Response.json({ ok: false, error: error instanceof TradingPlanError ? error.message : error instanceof AuthError ? "Owner authentication required." : "Planning storage unavailable. No session was changed." }, { status: error instanceof TradingPlanError ? error.status : error instanceof AuthError ? error.statusCode : 503, headers });
}
export async function GET() {
  try { return Response.json({ ok: true, ...await tradingPlanSnapshot(await requireOwnerId()) }, { headers }); } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const userId = await requireOwnerId();
    if (req.headers.get("origin") !== new URL(process.env.AUTH_APP_URL ?? req.url).origin) return Response.json({ ok: false, error: "Same-origin request required." }, { status: 403, headers });
    const raw = await req.text(); if (raw.length > 9000) return Response.json({ ok: false, error: "Planning request too large." }, { status: 413, headers });
    let body; try { body = JSON.parse(raw); } catch { throw new TradingPlanError("Invalid planning JSON."); }
    return Response.json({ ok: true, ...await changeTradingPlan(userId, body) }, { headers });
  } catch (error) { return failure(error); }
}
