import { NextResponse } from "next/server";
import { requireOwnerId } from "@/lib/auth/owner";
import { cancelTerminalOrder, previewTerminalOrder } from "@/lib/bybit/terminal";
import { executeObservedOrder } from "@/lib/bybit/observed-execution";
import { listBybitOrders } from "@/lib/bybit/trading";
import { AuthError } from "@/lib/auth/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const failure = (error: unknown) => NextResponse.json({ error: error instanceof AuthError ? "Owner authentication required." : error instanceof Error ? error.message : "Bybit order action unavailable." }, { status: error instanceof AuthError ? error.statusCode : 400, headers });
function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(process.env.AUTH_APP_URL ?? request.url).origin;
}
async function bodyOf(request: Request) {
  const text = await request.text();
  if (text.length > 16384) throw Error("Order request is too large.");
  const body = JSON.parse(text);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("Choose a valid order request.");
  return body as Record<string, unknown>;
}

export async function GET() {
  try { return NextResponse.json(await listBybitOrders(await requireOwnerId()), { headers }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const ownerUserId = await requireOwnerId();
    if (!sameOrigin(request)) return NextResponse.json({ error: "Same-origin request required." }, { status: 403, headers });
    const body = await bodyOf(request);
    if (body.confirmed === true) return NextResponse.json(await executeObservedOrder(ownerUserId, body), { headers });
    return NextResponse.json(await previewTerminalOrder(ownerUserId, body), { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const ownerUserId = await requireOwnerId();
    if (!sameOrigin(request)) return NextResponse.json({ error: "Same-origin request required." }, { status: 403, headers });
    const body = await bodyOf(request);
    if (Object.keys(body).some(key => !["mode", "category", "symbol", "orderId", "confirmation", "password"].includes(key))) throw Error("Cancellation request has unexpected fields.");
    return NextResponse.json(await cancelTerminalOrder(ownerUserId, body), { headers });
  } catch (error) { return failure(error); }
}
