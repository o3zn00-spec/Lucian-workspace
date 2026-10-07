import { requireOwnerId } from "@/lib/auth/owner";
import { db } from "@/lib/db";
import { AssistantError } from "@/lib/assistant/service";
import { AuthError } from "@/lib/auth/errors";
import { Prisma } from "@prisma/client";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
function fail(e: unknown) { if(e instanceof Prisma.PrismaClientKnownRequestError) console.warn("Assistant sync database failure", {code:e.code}); return Response.json({ok:false,error:e instanceof AssistantError || e instanceof AuthError ? e.message : "Saved conversation sync unavailable."}, {status:e instanceof AssistantError ? e.status : e instanceof AuthError ? e.statusCode : 503}); }
function str(v: unknown, max: number) { if(typeof v !== "string" || !v.trim() || v.length > max) throw new AssistantError("Invalid conversation data."); return v; }
export async function GET() {
  try {
    const userId=await requireOwnerId();
    const [profile,rows]=await Promise.all([db.assistantProfile.findUnique({where:{userId}}),db.assistantConversation.findMany({where:{userId,deletedAt:null},orderBy:{updatedAt:"desc"},take:100,include:{messages:{orderBy:{createdAt:"asc"},take:500}}})]);
    return Response.json({ok:true,activeId:profile?.activeConversationId,conversations:rows.map(c=>{
      const meta=c.metadata as Record<string,unknown> | null;
      return {id:c.id,title:c.title,createdAt:c.createdAt.getTime(),updatedAt:c.updatedAt.getTime(),serverVersion:c.updatedAt.toISOString(),pinned:meta?.pinned===true,archived:meta?.archived===true,summary:meta?.summary??"",capabilities:meta?.capabilities??[],messages:c.messages.filter(m=>(m.metadata as Record<string,unknown> | null)?.hidden!==true).map(m=>({id:m.requestId,role:m.role,content:m.content,timestamp:m.createdAt.getTime(),fromModel:false,...(m.metadata as Record<string,unknown>??{})}))};})});
  } catch(e){return fail(e);}
}
export async function POST(req: Request) {
  try {
    const userId=await requireOwnerId();
    if(req.headers.get("origin")!==new URL(process.env.AUTH_APP_URL??req.url).origin) throw new AssistantError("Same-origin requests required.",403);
    const raw=await req.text();if(raw.length>1000000)throw new AssistantError("Conversation too large.",413);
    const body=JSON.parse(raw);const id=str(body.id,100);
    const existing=await db.assistantConversation.findUnique({where:{id}});
    if(existing && existing.userId!==userId)throw new AssistantError("Conversation unavailable.",404);
    if(body.action==="activate"){
      if(!existing || existing.deletedAt)throw new AssistantError("Conversation unavailable.",404);
      await db.assistantProfile.upsert({where:{userId},create:{userId,activeConversationId:id},update:{activeConversationId:id}});return Response.json({ok:true});
    }
    if(body.action==="delete"){
      if(!existing)throw new AssistantError("Conversation unavailable.",404);
      await db.assistantConversation.updateMany({where:{id,userId},data:{deletedAt:new Date()}});return Response.json({ok:true});
    }
    const c=body.conversation; if(!c || c.id!==id || !Array.isArray(c.messages) || c.messages.length>500)throw new AssistantError("Invalid conversation.");
    if(body.retainedMessageIds!=null && (!Array.isArray(body.retainedMessageIds) || body.retainedMessageIds.length>500 || body.retainedMessageIds.some((id:unknown)=>typeof id!=="string" || !id || id.length>100)))throw new AssistantError("Invalid retained message list.");
    const title=str(c.title,120);const messages: {createdAt:Date;requestId:string;role:string;content:string;module:string;metadata:Prisma.InputJsonValue}[]=c.messages.filter((m:{status?:string;content?:string})=>m.status!=="streaming" && (m.content || m.status!=="complete")).map((m:Record<string,unknown>)=>{
      if(!["user","assistant","tool"].includes(String(m.role)))throw new AssistantError("Invalid message role.");
      return {createdAt:typeof m.timestamp==="number" && Number.isFinite(m.timestamp) && m.timestamp>0 && m.timestamp<Date.now()+86400000?new Date(m.timestamp):new Date(),requestId:str(m.id,100),role:String(m.role),content:str(m.content,64000),module:"economic-agent",metadata:{provenance:"owner-saved-transcript",fromModel:m.fromModel===true,status:"complete",capability:typeof m.capability==="string"?m.capability:"general",toolName:typeof m.toolName==="string"?m.toolName:null,attachments:attachmentMetadata(m.attachments)} as Prisma.InputJsonValue};
    });
    const version=await db.$transaction(async tx=>{
      const row=await tx.assistantConversation.findUnique({where:{id}});
      if(row && (row.userId!==userId || row.deletedAt))throw new AssistantError("Conversation unavailable.",404);
      if(row && body.baseVersion!==row.updatedAt.toISOString())throw new AssistantError("Conversation changed elsewhere. Reload before syncing.",409);
      const changedAt=new Date();const metadata={pinned:c.pinned===true,archived:c.archived===true,summary:typeof c.summary==="string"?c.summary.slice(0,12000):"",capabilities:Array.isArray(c.capabilities)?c.capabilities.slice(0,20):[]};
      if(row){const updated=await tx.assistantConversation.updateMany({where:{id,userId,updatedAt:row.updatedAt},data:{title,metadata,updatedAt:changedAt}});if(!updated.count)throw new AssistantError("Concurrent conversation change.",409);}
      else await tx.assistantConversation.create({data:{id,userId,title,metadata,updatedAt:changedAt}});
      const old=await tx.assistantMessage.findMany({where:{conversationId:id}});
      const newMessages=messages.filter(message=>!old.some(previous=>previous.requestId===message.requestId));
      if(newMessages.length)await tx.assistantMessage.createMany({data:newMessages.map(message=>({conversationId:id,...message}))});
      for(const message of messages) {const previous=old.find(m=>m.requestId===message.requestId);if(!previous || (previous.content===message.content && JSON.stringify(previous.metadata)===JSON.stringify(message.metadata)))continue;await tx.assistantMessage.update({where:{id:previous.id},data:{content:message.content,role:message.role,metadata:message.metadata}});}

      const retained=new Set<string>(body.retainedMessageIds??messages.map((m:{requestId:string})=>m.requestId));
      if(messages.some(m=>!retained.has(m.requestId)))throw new AssistantError("Changed messages must be retained.");
      const hiddenIds=old.filter(m=>!retained.has(m.requestId) && (m.metadata as Record<string,unknown>|null)?.hidden!==true).map(m=>m.id);
      if(hiddenIds.length)await tx.assistantMessage.updateMany({where:{id:{in:hiddenIds}},data:{metadata:{hidden:true}}});
      return changedAt.toISOString();
    }, {maxWait:10000,timeout:30000});
    return Response.json({ok:true,serverVersion:version});
  }catch(e){return fail(e);}
}

function attachmentMetadata(input: unknown): Prisma.InputJsonValue {
  if(input == null) return [];
  if(!Array.isArray(input) || input.length>8) throw new AssistantError("Too many attachments.");
  return input.map(item => {
    if(!item || typeof item.id!=="string" || typeof item.name!=="string" || item.id.length>100 || item.name.length>300) throw new AssistantError("Invalid attachment.");
    if(item.url!=null && (typeof item.url!=="string" || item.url.length>100000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(item.url))) throw new AssistantError("Invalid image preview.");
    return {id:item.id,name:item.name,...(item.url?{url:item.url}:{})};
  });
}
