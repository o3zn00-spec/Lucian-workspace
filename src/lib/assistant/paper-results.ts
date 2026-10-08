import type { PaperSession } from "./paper-engine";
import { cents } from "./paper-policy";
export function paperResults(s:PaperSession) {
  const entries=new Map<string,number>();let realizedCents=0,closedTrades=0,wins=0;
  for(const f of s.fills){if(f.side==="buy")entries.set(f.symbol,f.amountCents);else{const pnl=f.amountCents-(entries.get(f.symbol)??0);realizedCents+=pnl;closedTrades++;if(pnl>0)wins++;entries.delete(f.symbol);}}
  const openCostCents=s.positions.reduce((sum,p)=>sum+p.debitCents,0);
  const unrealizedCents=s.equityCents-s.cashCents-openCostCents;
  let peak=cents(s.plan.capital),maxDrawdownCents=0;
  for(const h of s.history){peak=Math.max(peak,h.equityCents);maxDrawdownCents=Math.max(maxDrawdownCents,peak-h.equityCents);}
  return {realizedCents,unrealizedCents,totalCents:s.equityCents-cents(s.plan.capital),closedTrades,wins,maxDrawdownCents,openCostCents};
}
