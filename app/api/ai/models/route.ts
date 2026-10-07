import { requireOwnerId } from "@/lib/auth/owner";
import { discoverModels } from "@/lib/agent/providers";
import { AuthError } from "@/lib/auth/errors";
import type { ProviderId } from "@/store/shared-ai-config";
export const dynamic="force-dynamic";
export async function GET(req:Request) {
  try { const owner=await requireOwnerId(); const provider=new URL(req.url).searchParams.get("provider");
    if(!provider || !["gemini","openai","anthropic","openrouter","deepseek","custom"].includes(provider)) return Response.json({error:"Choose a provider."},{status:400});
    return Response.json(await discoverModels(provider as ProviderId,owner));
  } catch(error) {return Response.json({error:error instanceof AuthError?error.message:"Unable to discover models. Check provider credentials in Settings."},{status:error instanceof AuthError?error.statusCode:503});}
}
