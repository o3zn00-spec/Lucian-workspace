export type ReplayBar={atMs:number;open:number;high:number;low:number;close:number};
export function parseReplayBars(rows:unknown,now:number):ReplayBar[]{
  if(!Array.isArray(rows)||rows.length>1000)throw Error("Invalid replay history.");
  const bars=rows.map(r=>{
    if(!Array.isArray(r)||r.length!==7||r.some(v=>typeof v!=="string"))throw Error("Invalid replay bar.");
    const [atMs,open,high,low,close,volume,turnover]=r.map(Number);
    if(!Number.isSafeInteger(atMs)||atMs<=0||atMs%3600000||[open,high,low,close].some(v=>!Number.isFinite(v)||v<=0||v>1e12)||low>Math.min(open,close)||high<Math.max(open,close)||high<low||![volume,turnover].every(v=>Number.isFinite(v)&&v>=0))throw Error("Invalid replay price.");
    return {atMs,open,high,low,close};
  }).filter(b=>b.atMs+3600000<=now).sort((a,b)=>a.atMs-b.atMs);
  if(bars.length<770||bars.some((b,i)=>i>0&&b.atMs-bars[i-1].atMs!==3600000)||now-bars.at(-1)!.atMs>7200000)throw Error("Replay needs at least 30 days plus warmup of contiguous closed hourly bars.");
  return bars;
}
// Fixed reference strategy, not a retrospective LLM or a tuned profit claim.
// Signals use only prior closes. Entry at next open. If both exits touch, stop wins.
export function replayStrategy(bars:ReplayBar[],feeBps:number,slippageBps:number,start=50){
  if(bars.length<51||start<50||start>=bars.length||![feeBps,slippageBps].every(n=>Number.isInteger(n)&&n>=0&&n<=1000))throw Error("Invalid replay configuration.");
  let cash=1000,peak=1000,maxDrawdown=0,trades=0,wins=0,costs=0;
  let position:null|{qty:number;entry:number;debit:number;index:number}=null;
  const equity:{atMs:number;value:number}[]=[],fills:{atMs:number;side:string;price:number;reason:string}[]=[];
  const sell=(price:number,b:ReplayBar,reason:string)=>{if(!position)return;const effective=price*(1-slippageBps/10000),gross=position.qty*effective,fee=gross*feeBps/10000;const net=gross-fee;costs+=fee+position.qty*(price-effective);cash+=net;trades++;if(net>position.debit)wins++;fills.push({atMs:b.atMs,side:"sell",price:effective,reason});position=null;};
  for(let i=start;i<bars.length;i++){
    const b=bars[i],average=(n:number)=>bars.slice(i-n,i).reduce((sum,c)=>sum+c.close,0)/n;
    const trend=average(20)>average(50)&&bars[i-1].close>average(20);
    let exited=false;
    if(position){const stop=position.entry*.99,target=position.entry*1.02;
      if(!trend||i-position.index>=24){sell(b.open,b,"Trend/24h exit");exited=true;}
      else if(b.low<=stop){sell(Math.min(b.open,stop),b,"Stop (adverse path)");exited=true;}
      else if(b.high>=target){sell(target,b,"Target");exited=true;}}
    if(!position&&!exited&&trend&&cash>50&&1000-cash<20){
      const effective=b.open*(1+slippageBps/10000),qty=50/(effective*(1+feeBps/10000));
      const gross=qty*effective,fee=gross*feeBps/10000;cash-=gross+fee;costs+=fee+qty*(effective-b.open);position={qty,entry:effective,debit:gross+fee,index:i};fills.push({atMs:b.atMs,side:"buy",price:effective,reason:"Prior SMA20/50 trend"});
      // Protection is effective immediately, including on the entry bar.
      if(b.low<=effective*.99)sell(Math.min(b.open,effective*.99),b,"Entry-bar stop (adverse path)");
      else if(b.high>=effective*1.02)sell(effective*1.02,b,"Entry-bar target");
    }
    if(i===bars.length-1&&position)sell(b.close,b,"End-of-sample liquidation");
    const value=cash+(position?position.qty*b.close*(1-slippageBps/10000)*(1-feeBps/10000):0);peak=Math.max(peak,value);maxDrawdown=Math.max(maxDrawdown,peak-value);equity.push({atMs:b.atMs,value});
  }
  return {startAtMs:bars[start].atMs,endAtMs:bars.at(-1)!.atMs,bars:bars.length-start,feeBps,slippageBps,netUsdt:cash-1000,trades,wins,costsUsdt:costs,maxDrawdownUsdt:maxDrawdown,equity,fills};
}
