import { sleep } from "workflow";
import { start } from "workflow/api";
async function cycle(userId:string,id:string,generation:string) {
  "use step";
  const {runPaperTick}=await import("@/lib/assistant/paper-runtime");
  const result=await runPaperTick(userId,id,generation);
  console.info("paper cycle completed", {done:result.done});
  return result;
}
async function record(userId:string,id:string,generation:string,runId:string) {
  "use step";
  const {recordPaperRun}=await import("@/lib/assistant/paper-runtime");
  await recordPaperRun(userId,id,generation,runId);
}
export async function paperSessionWorkflow(userId:string,id:string,generation:string):Promise<void> {
  "use workflow";
  // Bound replay/event size; continuation runs share the same authoritative ledger.
  for(let i=0;i<100;i++) {
    if ((await cycle(userId,id,generation)).done) return;
    await sleep("60s");
  }
  const child=await start(paperSessionWorkflow,[userId,id,generation],{region:"cpt1"});
  await record(userId,id,generation,child.runId);
}
async function checkStage(userId:string,id:string,final:boolean) {
  "use step";
  const {runtimeCheckStage}=await import("@/lib/assistant/paper-runtime-check");
  await runtimeCheckStage(userId,id,final);
}
export async function paperRuntimeCheckWorkflow(userId:string,id:string) {
  "use workflow";
  await checkStage(userId,id,false);
  await sleep("5s");
  await checkStage(userId,id,true);
}
