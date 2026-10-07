import { POST as sharedChat } from "../../ai/chat/route";
import { requireOwnerId } from "@/lib/auth/owner";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try { await requireOwnerId(); } catch { return Response.json({success:false,message:"Owner authorization required."},{status:403}); }
  return sharedChat(req);
}
