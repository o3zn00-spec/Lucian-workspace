import { requireOwnerId } from "@/lib/auth/owner";
import { AuthError } from "@/lib/auth/errors";
import { assistantCommand, AssistantError, assistantSnapshot } from "@/lib/assistant/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function failure(error: unknown) {
  if (error instanceof AuthError) return Response.json({ ok: false, error: error.message }, { status: error.statusCode });
  if (error instanceof AssistantError) return Response.json({ ok: false, error: error.message }, { status: error.status });
  return Response.json({ ok: false, error: "Assistant storage unavailable. Your saved conversations have not been removed." }, { status: 503 });
}
export async function GET(req: Request) {
  try { return Response.json({ ok: true, ...await assistantSnapshot(await requireOwnerId(), new URL(req.url).searchParams.get("conversationId")) }); }
  catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const userId = await requireOwnerId();
    // Next's internal request URL can use localhost behind a proxy. Compare
    // against the configured public app origin, never an untrusted Host header.
    const appOrigin = new URL(process.env.AUTH_APP_URL ?? req.url).origin;
    if (req.headers.get("origin") !== appOrigin) throw new AssistantError("Same-origin requests are required.", 403);
    const raw = await req.text();
    if (raw.length > 20000) throw new AssistantError("Request is too large.", 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new AssistantError("Invalid request body."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new AssistantError("Invalid request body.");
    return Response.json({ ok: true, ...await assistantCommand(userId, body) });
  } catch (error) { return failure(error); }
}
