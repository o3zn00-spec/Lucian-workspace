import { requireOwnerId } from "@/lib/auth/owner";
import { AuthError } from "@/lib/auth/errors";
import { PaperPlanError } from "@/lib/assistant/paper-policy";
import { createPaperSession, controlPaperSession, paperSessionSnapshot, recordPaperRun } from "@/lib/assistant/paper-runtime";
import { reserveRuntimeCheck, runtimeCheckStage, runtimeCheckSnapshot } from "@/lib/assistant/paper-runtime-check";
import { paperSessionWorkflow, paperRuntimeCheckWorkflow } from "@/workflows/paper-session";
import { start } from "workflow/api";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=120;
function failure(error:unknown) {
  return Response.json({ok:false,error:error instanceof PaperPlanError?error.message:"Paper session service unavailable. Refresh to check its state."},{status:error instanceof AuthError?error.statusCode:error instanceof PaperPlanError?error.status:503});
}
export async function GET() {
  try {const userId=await requireOwnerId();return Response.json({ok:true,...await paperSessionSnapshot(userId),runtimeCheck:await runtimeCheckSnapshot(userId)});} catch(error){return failure(error);}
}
export async function POST(req:Request) {
  try {
    const userId=await requireOwnerId();
    if(req.headers.get("origin")!==new URL(process.env.AUTH_APP_URL??req.url).origin)return Response.json({ok:false,error:"Same-origin request required."},{status:403});
    const raw=await req.text();if(raw.length>1000)throw new PaperPlanError("Session request too large.");
    let body;try{body=JSON.parse(raw);}catch{throw new PaperPlanError("Invalid session request.");}
    if(!body || typeof body!=="object" || Array.isArray(body))throw new PaperPlanError("Invalid session request.");
    if(body.action==="verify") {
      if(Object.keys(body).length!==1)throw new PaperPlanError("Invalid runtime check.");
      const check=await reserveRuntimeCheck(userId);
      try {await start(paperRuntimeCheckWorkflow,[userId,check.id],{region:"cpt1"});}catch{await runtimeCheckStage(userId,check.id,false,true);}
      return Response.json({ok:true,...await paperSessionSnapshot(userId),runtimeCheck:await runtimeCheckSnapshot(userId)});
    }
    const s=body.action==="start"?await createPaperSession(userId,body):await controlPaperSession(userId,body);
    if(body.action==="start" || body.action==="recover") {
      try {const run=await start(paperSessionWorkflow,[userId,s.id,s.generation],{region:"cpt1"});await recordPaperRun(userId,s.id,s.generation,run.runId);}
      catch {await recordPaperRun(userId,s.id,s.generation,null,"Worker dispatch unavailable. Recover to retry; no session has been reset.");}
    }
    return Response.json({ok:true,...await paperSessionSnapshot(userId),runtimeCheck:await runtimeCheckSnapshot(userId)});
  }catch(error){return failure(error);}
}
