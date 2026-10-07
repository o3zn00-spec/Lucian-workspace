import { NextResponse } from "next/server";
import { discoverModels, isProviderConfigured } from "@/lib/agent/providers";
import type { ProviderId } from "@/store/economic-agent-connection";
import { requireOwnerId } from "@/lib/auth/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TestRequestBody {
  provider: ProviderId;
  model: string;
}

export async function POST(req: Request) {
  let ownerUserId: string;
  try { ownerUserId = await requireOwnerId(); }
  catch {
    return NextResponse.json({ success: false, message: "Owner authorization required.", reason: "owner_required" }, { status: 403 });
  }
  if(req.headers.get("origin") !== new URL(process.env.AUTH_APP_URL??req.url).origin) return NextResponse.json({success:false,message:"Same-origin requests required."},{status:403});
  let body: TestRequestBody;
  try {
    body = (await req.json()) as TestRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid request body.", reason: "invalid_body" },
      { status: 400 },
    );
  }

  const { provider, model } = body;
  if(!["gemini","openai","anthropic","openrouter","deepseek","custom"].includes(provider) || typeof model!=="string" || model.length>150) return NextResponse.json({success:false,message:"Invalid provider/model."},{status:400});

  // Check if the API key is present in the environment.
  const keyPresent = await isProviderConfigured(provider, ownerUserId);
  if (!keyPresent) {
    return NextResponse.json({
      success: false,
      message: "API key not configured",
      reason: "Save your provider key in Settings → Connections.",
      provider,
      model,
      keyPresent: false,
      testedAt: new Date().toISOString(),
    });
  }

  try {
    const catalog = await discoverModels(provider, ownerUserId);
    const modelListed = catalog.models.includes(model);
    return NextResponse.json({
      success: true, message: "Provider connection verified",
      reason: modelListed ? "Selected model is listed. No paid reply was generated; inference is not yet verified." : "Selected model was not returned in the catalog. Check its exact ID and account access before chatting.",
      modelListed, inferenceVerified: false, provider, model, keyPresent: true,
      testedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      message: "Connection failed",
      reason: err instanceof Error ? err.message : String(err),
      provider,
      model,
      keyPresent: true,
      testedAt: new Date().toISOString(),
    });
  }
}
