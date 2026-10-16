import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE || '/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const bundle=await build({entryPoints:['scripts/fixtures/lilthe-interaction.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'fixture-link',setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'import React from "react"; export default function Link(p){return React.createElement("a",p,p.children)}',resolveDir:process.cwd()}));}}]});
const cssFiles=(await readdir('.next/static/chunks')).filter(f=>f.endsWith('.css'));
const css=(await Promise.all(cssFiles.map(f=>readFile('.next/static/chunks/'+f,'utf8')))).join('\n');
const server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text)}else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css)}else{res.setHeader('Content-Type','text/html');res.end('<html data-theme="midnight-gray"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><body class="themed bg-canvas text-fg"><div id="root"></div><script src="/app.js"></script></body></html>')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {})});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
page.on("pageerror", error => console.error("Fixture browser error:", error.message));
page.setDefaultTimeout(10000);
const calls=[];
const plan={mode:'bybit_live',symbols:['BTCUSDT'],capital:'10',maxOrder:'6',maxLoss:'1',maxRiskPerTrade:'1',maxTrades:2,reviewMinutes:5,durationHours:24,maxModelCalls:20,slippageBps:50,strategy:'Fixture strategy. Research, protect and reassess within the approved limits.'};
let failStart=false;
await page.route('**/api/**',async route=>{const req=route.request();const body=req.postDataJSON();calls.push({url:req.url(),body});let data;
if(req.url().endsWith('/trading-plan'))data={ok:true,complete:true,draft:{rules:plan}};
else if(body?.action==='preview')data={ok:true,draft:{id:'fixture-review',plan,provider:body.provider,model:body.model,effort:body.effort,expiresAtMs:Date.now()+300000,confirmation:'APPROVE FIXTURE'}};
else if(body?.action==='start'){if(failStart){await route.abort();return;}data={ok:true,session:{id:'fixture-session',status:'active'}};}
else data={ok:true,session:null};await route.fulfill({json:data});});
const load=()=>page.goto(`http://127.0.0.1:${server.address().port}`);
try{
await load();await page.getByRole('button',{name:'Today',exact:true}).click();assert.match(await page.locator('#selection').innerText(),/Today/);assert.equal(await page.getByRole('button',{name:'One week',exact:true}).isDisabled(),true);
await page.getByRole('button',{name:'Load current review'}).click();await page.getByLabel('Current LUCIAN password').waitFor();assert.equal(await page.getByRole('button',{name:'Approve session',exact:true}).isDisabled(),true);
await page.getByRole('button',{name:'Reject',exact:true}).click();assert.equal(calls.filter(c=>c.body?.action==='start').length,0);
await page.getByRole('button',{name:'Load current review'}).click();await page.getByLabel('Current LUCIAN password').fill(' fixture password ');await page.getByLabel('Session confirmation phrase').fill('APPROVE FIXTURE');
await page.evaluate(()=>window.changeFixtureModel());assert.equal(await page.getByRole('button',{name:'Approve session',exact:true}).isDisabled(),true);
await page.getByRole('button',{name:'Load current review'}).click();await page.getByLabel('Current LUCIAN password').fill(' fixture password ');await page.getByLabel('Session confirmation phrase').fill('APPROVE FIXTURE');
await mkdir('outputs/ui-review',{recursive:true});await page.screenshot({path:'outputs/ui-review/lilthe-desktop.png',fullPage:true});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'outputs/ui-review/lilthe-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.getByRole('button',{name:'Approve session',exact:true}).click();await page.getByText(/Authorization saved/).waitFor();const start=calls.filter(c=>c.body?.action==='start');assert.equal(start.length,1);assert.equal(start[0].body.password,' fixture password ');assert.equal(start[0].body.draftId,'fixture-review');assert.equal(await page.getByLabel('Current LUCIAN password').count(),0);
await page.getByRole('button',{name:'Load current review'}).click();await page.getByLabel('Current LUCIAN password').fill('secret');await page.getByLabel('Session confirmation phrase').fill('APPROVE FIXTURE');failStart=true;await page.getByRole('button',{name:'Approve session',exact:true}).click();await page.getByText(/No automatic retry was sent/).waitFor();assert.equal(calls.filter(c=>c.body?.action==='start').length,2);assert.equal(await page.getByLabel('Current LUCIAN password').count(),0);
console.log('PASS browser: real choice submission, single selection, exact server review, reject without start, changed model blocks approval, exact password, one start, ambiguous failure clears credentials/no retry, mobile no overflow. Mocked server only.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
