import { requireOwnerId } from "@/lib/auth/owner";
import { AuthError } from "@/lib/auth/errors";
import { setSavedRead, setTradingRead, setTradingActivityRead, toolAccessSnapshot } from "@/lib/assistant/tool-access";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  return Response.json({ ok: false, error: "Tool permissions or activity unavailable. No access has been confirmed." },
    { status: error instanceof AuthError ? error.statusCode : 503 });
}
export async function GET() {
  try { return Response.json({ ok: true, ...await toolAccessSnapshot(await requireOwnerId()) }); }
  catch (error) { return failure(error); }
}
export async function PUT(req: Request) {
  try {
    const userId = await requireOwnerId();
    if (req.headers.get("origin") !== new URL(process.env.AUTH_APP_URL ?? req.url).origin) return Response.json({ ok: false }, { status: 403 });
    const raw = await req.text();
    if (raw.length > 1000) return Response.json({ ok: false }, { status: 413 });
    let body;
    try { body = JSON.parse(raw); } catch { return Response.json({ ok: false }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !(["savedRead", "tradingRead", "tradingActivityRead"].includes(Object.keys(body)[0]) && typeof body[Object.keys(body)[0]] === "boolean")) return Response.json({ ok: false }, { status: 400 });
    if (typeof body.savedRead === "boolean") await setSavedRead(userId, body.savedRead);
    else if (typeof body.tradingRead === "boolean") await setTradingRead(userId, body.tradingRead);
    else await setTradingActivityRead(userId, body.tradingActivityRead);
    return Response.json({ ok: true, ...await toolAccessSnapshot(userId) });
  } catch (error) { return failure(error); }
}
