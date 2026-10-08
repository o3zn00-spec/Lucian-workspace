import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const database=new URL(process.env.DATABASE_URL??'http://invalid');
assert(['localhost','127.0.0.1'].includes(database.hostname)&&database.pathname==='/lucian_restoration_dev_20261007','Named local restoration database required; production is forbidden');
const require=createRequire(import.meta.url);
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient();globalThis.integrationDb=db;
// Reuse the exchange fixtures, replacing only their in-memory database with real PostgreSQL.
const source=await readFile(new URL('./live-execution-tests.mjs',import.meta.url),'utf8');
const captured=source.slice(source.indexOf('const mocks=')+12,source.indexOf('\nconst b=await build'));
const mocks=Function('return '+captured.replace(/;\s*$/,''))();
mocks['@/lib/db']='export const db=globalThis.integrationDb;';
const bundle=await build({entryPoints:['src/lib/bybit/terminal.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'isolated-fixtures',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {executeTerminalOrder}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const owner=randomUUID();
const create=()=>db.liveTradeIntent.create({data:{userId:owner,clientOrderId:'integration-'+randomUUID(),productId:'BTCUSDT',side:'BUY',category:'spot',tradingMode:'bybit_testnet',orderType:'Market',baseSize:'0.001',expiresAt:new Date(Date.now()+60000),preview:{}}});
const input=id=>({intentId:id,confirmation:'CONFIRM BYBIT TESTNET ORDER'});
try {
  await db.user.create({data:{id:owner,username:'reservation-'+owner,email:owner+'@example.test'}});
  let intent=await create();globalThis.fixture={state:'previewed',calls:0};
  const same=await Promise.allSettled(Array.from({length:6},()=>executeTerminalOrder(owner,input(intent.id))));
  assert.equal(same.filter(r=>r.status==='fulfilled').length,1);assert.equal(globalThis.fixture.calls,1);
  assert.equal((await db.liveTradeIntent.findUnique({where:{id:intent.id}})).state,'submitted');
  await db.liveTradeIntent.update({where:{id:intent.id},data:{state:'cancelled'}});
  const a=await create(),b=await create();globalThis.fixture={state:'previewed',calls:0};
  const different=await Promise.allSettled([executeTerminalOrder(owner,input(a.id)),executeTerminalOrder(owner,input(b.id))]);
  assert.equal(different.filter(r=>r.status==='fulfilled').length,1);assert.equal(globalThis.fixture.calls,1);
  assert.equal(await db.liveTradeIntent.count({where:{userId:owner,state:'submitted'}}),1);
  await db.liveTradeIntent.updateMany({where:{userId:owner},data:{state:'cancelled'}});
  intent=await create();globalThis.fixture={state:'previewed',calls:0,fail:true};
  await assert.rejects(executeTerminalOrder(owner,input(intent.id)),/ambiguous timeout/);
  assert.equal((await db.liveTradeIntent.findUnique({where:{id:intent.id}})).state,'reconciliation_required');
  await assert.rejects(executeTerminalOrder(owner,input(intent.id)));assert.equal(globalThis.fixture.calls,1);
  console.log('PASS actual PostgreSQL reservation concurrency: six confirmations/one preview and two competing previews yield one exchange-fixture write; ambiguous submission is retained and never resent. Local disposable owner only; no exchange network calls.');
} finally {
  await db.user.deleteMany({where:{id:owner}});await db.$disconnect();delete globalThis.integrationDb;
}
