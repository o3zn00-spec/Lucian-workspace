import {requireOwnerId} from "@/lib/auth/owner";
import {AuthError} from "@/lib/auth/errors";
import {reconciliationCandidates,reconcileTerminalOrder} from "@/lib/bybit/reconciliation";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=120;
const failure=(e:unknown)=>Response.json({error:e instanceof AuthError?"Owner authentication required.":e instanceof Error?e.message:"Reconciliation unavailable."},{status:e instanceof AuthError?e.statusCode:400,headers:{"Cache-Control":"private, no-store"}});
export async function GET(){try{return Response.json(await reconciliationCandidates(await requireOwnerId()),{headers:{"Cache-Control":"private, no-store"}});}catch(e){return failure(e);}}
export async function POST(req:Request){try{
  const userId=await requireOwnerId();
  if(req.headers.get("origin")!==new URL(process.env.AUTH_APP_URL??req.url).origin) return Response.json({error:"Same-origin request required."},{status:403});
  const raw=await req.text();if(raw.length>300)throw Error("Request too large.");const body=JSON.parse(raw);
  if(!body || Object.keys(body).length!==1 || typeof body.intentId!=="string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.intentId))throw Error("Choose an owner reservation.");
  return Response.json(await reconcileTerminalOrder(userId,body.intentId),{headers:{"Cache-Control":"private, no-store"}});
}catch(e){return failure(e);}}
