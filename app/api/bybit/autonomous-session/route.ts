import { requireOwnerId } from "@/lib/auth/owner";
import { AuthError } from "@/lib/auth/errors";
import { AutonomousError } from "@/lib/bybit/autonomous-policy";
import { autonomousSnapshot, previewAutonomousSession, startAutonomousSession, controlAutonomousSession, renewAutonomousExit, recordAutonomousRun } from "@/lib/bybit/autonomous-session";
import { autonomousTradingWorkflow, autonomousTradingSupervisor } from "@/workflows/autonomous-trading";
import { start } from "workflow/api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "private, no-store" };
const failure = (e: unknown) => Response.json({ ok: false, error: e instanceof AutonomousError ? e.message : e instanceof AuthError ? "Owner authentication required." : "Session request unavailable. Refresh its saved state before retrying." }, { status: e instanceof AutonomousError ? e.status : e instanceof AuthError ? e.statusCode : 503, headers });
export async function GET() { try { return Response.json({ ok: true, ...await autonomousSnapshot(await requireOwnerId()) }, { headers }); } catch (e) { return failure(e); } }
export async function POST(req: Request) {
  try {
    const userId = await requireOwnerId();
    if (req.headers.get("origin") !== new URL(process.env.AUTH_APP_URL ?? req.url).origin) return Response.json({ ok: false, error: "Same-origin request required." }, { status: 403, headers });
    const raw = await req.text(); if (raw.length > 10000) throw new AutonomousError("Session request too large.");
    let b; try { b = JSON.parse(raw); } catch { throw new AutonomousError("Invalid session JSON."); } if (!b || typeof b !== "object" || Array.isArray(b)) throw new AutonomousError("Invalid session request.");
    if (b.action === "preview") return Response.json({ ok: true, ...await previewAutonomousSession(userId, b) }, { headers });
    const s = b.action === "start" ? await startAutonomousSession(userId, b) : b.action === "renew_exit" ? await renewAutonomousExit(userId, b) : await controlAutonomousSession(userId, b);
    if (s.status !== "stopped") {
      if (b.action === "start" || b.action === "renew_exit" || !s.supervisorRunId) {
        try { const supervisor = await start(autonomousTradingSupervisor, [userId, s.id], { region: "cpt1" }); await recordAutonomousRun(userId, s.id, s.generation, supervisor.runId, true); } catch { /* Primary dispatch remains independent; UI shows supervisor unavailable. */ }
      }
      try { const run = await start(autonomousTradingWorkflow, [userId, s.id, s.generation], { region: "cpt1" }); await recordAutonomousRun(userId, s.id, s.generation, run.runId); } catch { await recordAutonomousRun(userId, s.id, s.generation, null); }
    }
    return Response.json({ ok: true, ...await autonomousSnapshot(userId) }, { headers });
  } catch (e) { return failure(e); }
}
