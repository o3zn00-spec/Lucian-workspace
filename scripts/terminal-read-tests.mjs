import assert from 'node:assert/strict';
import {build} from 'esbuild';
const mocks={
'server-only':'',
'@/lib/auth/password':'export const verifyPassword=async()=>true;',
'@/lib/bybit/trading':'export const getTradingProfile=async()=>({emergencyStop:false});',
'@/lib/db':'export const db={tradingAuditEvent:{findMany:async()=>[]},liveTradeIntent:{findMany:async()=>[]}};',
'@/lib/bybit/client':`export const getBybitConfig=async()=>({configured:true,environment:'mainnet'});export const bybitPublicRequest=async()=>({list:[]});export async function bybitRequest(user,path,options){if(options.method==='POST')throw Error('No exchange mutation');if(path==='/v5/asset/transfer/query-account-coins-balance'){if(globalThis.fixture.fundingFail)throw Error('Funding unavailable');return {balance:[{coin:'BTC',walletBalance:'0.0005089',transferBalance:'0.0005089'}]};}if(path==='/v5/account/wallet-balance'){if(globalThis.fixture.noWallet)return {list:[]};return {list:[{accountType:'UNIFIED',totalEquity:'123.45'}]};}if(path==='/v5/position/list')throw Error('Position service unavailable');if(path==='/v5/order/realtime'&&options.query.category==='spot')return globalThis.fixture.completePages ? (options.query.cursor ? {list:[{orderId:'second-page'}],nextPageCursor:''} : {list:[{orderId:'first-page'}],nextPageCursor:'more'}) : {list:[{orderId:'partial-page'}],nextPageCursor:'more'};if(path==='/v5/account/transaction-log')return {};return {list:[]};}`
};
const b=await build({entryPoints:['src/lib/bybit/terminal.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {terminalSnapshot}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
globalThis.fixture={};
const report=await terminalSnapshot('owner',{mode:'bybit_live'});
assert.equal(report.portfolio.totalEquity,'123.45');assert.equal(report.funding[0].walletBalance,'0.0005089');assert.equal(report.readErrors.funding,undefined);
assert.match(report.readErrors.positions,/unavailable/);
assert.match(report.readErrors.spotOrders,/page/);
assert.match(report.readErrors.transactions,/Malformed/);
assert.equal(report.readErrors.linearOrders,undefined);
assert.equal(report.openOrders.length,0);
globalThis.fixture.completePages=true;
const complete=await terminalSnapshot('owner',{mode:'bybit_live'});
assert.equal(complete.readErrors.spotOrders,undefined);
assert.deepEqual(complete.openOrders.map(row=>row.orderId),['first-page','second-page']);
globalThis.fixture.fundingFail=true;const unavailableFunding=await terminalSnapshot('owner',{mode:'bybit_live'});assert.match(unavailableFunding.readErrors.funding,/Funding unavailable/);assert.equal(unavailableFunding.portfolio.totalEquity,'123.45');globalThis.fixture.noWallet=true;
await assert.rejects(terminalSnapshot('owner',{mode:'bybit_live'}),/Balance is unavailable/);
console.log('PASS terminal read failures: successful balance retained, failed/paginated/malformed records explicitly incomplete, missing Unified wallet rejects. Mocked reads only.');
