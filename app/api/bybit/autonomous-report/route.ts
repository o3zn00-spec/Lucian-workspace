import { requireOwnerId } from "@/lib/auth/owner";
import { AuthError } from "@/lib/auth/errors";
import { AutonomousError } from "@/lib/bybit/autonomous-policy";
import { readAutonomousReport } from "@/lib/bybit/autonomous-report";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(req: Request) {
  try {
    const owner = await requireOwnerId(), params = new URL(req.url).searchParams;
    if ([...params.keys()].some(k => !["sessionId", "sessionPage", "tradePage", "decisionPage"].includes(k)) || [...new Set(params.keys())].some(k => params.getAll(k).length !== 1)) throw new AutonomousError("Invalid report query.");
    const page = (key: string) => { const raw = params.get(key) ?? "0"; if (!/^\d{1,4}$/.test(raw)) throw new AutonomousError("Invalid report page."); return Number(raw); };
    const report = await readAutonomousReport(owner, { sessionId: params.get("sessionId") ?? undefined, sessionPage: page("sessionPage"), tradePage: page("tradePage"), decisionPage: page("decisionPage") });
    return Response.json({ ok: true, report }, { headers });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof AutonomousError ? error.message : error instanceof AuthError ? "Owner authentication required." : "Trading report unavailable; saved evidence was not changed." }, { status: error instanceof AutonomousError ? error.status : error instanceof AuthError ? error.statusCode : 503, headers });
  }
}
