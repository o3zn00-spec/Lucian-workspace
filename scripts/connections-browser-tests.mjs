import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE || '/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const bundle=await build({entryPoints:['scripts/fixtures/connections.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'fixture-link',setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'import React from "react"; export default function Link(p){return React.createElement("a",p,p.children)}',resolveDir:process.cwd()}));}}]});
const cssFiles=(await readdir('.next/static/chunks')).filter(f=>f.endsWith('.css'));
const css=(await Promise.all(cssFiles.map(f=>readFile('.next/static/chunks/'+f,'utf8')))).join('\n');
const server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text)}else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css)}else{res.setHeader('Content-Type','text/html');res.end('<html data-theme="midnight-gray"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><body class="themed bg-canvas text-fg"><div id="root"></div><script src="/app.js"></script></body></html>')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {})});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
page.on("pageerror", error => console.error("Fixture browser error:", error.message));
page.setDefaultTimeout(10000);
let saved=false,checks=0;
await page.route('**/api/**',async route=>{const req=route.request();let data={};
if(req.url().endsWith('/providers')){checks++;data={providers:[{id:'bybit',name:'bybit',configured:saved,state:saved?'connected':'not_configured',stateDetail:'Fixture',type:'crypto'}]};}
else if(req.url().includes('/credentials')){if(req.method()==='PUT')saved=true;if(req.method()==='DELETE')saved=false;data={ok:true,credentials:[{service:'bybit',key:'api_key',label:'Bybit API key',configured:saved,updatedAt:null}]};}
else if(req.url().endsWith('/balances'))data={databaseAvailable:true};
await route.fulfill({json:data});});
try{await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByLabel('Bybit API key',{exact:true}).fill('fixture-secret');await page.getByRole('button',{name:'Save Bybit API key',exact:true}).click();await page.getByText('Connected',{exact:true}).waitFor();assert.ok(checks>=2);assert.equal(await page.getByLabel('Bybit API key',{exact:true}).inputValue(),'');
await page.getByRole('button',{name:'Remove Bybit API key',exact:true}).click();await page.getByText('Connected',{exact:true}).waitFor({state:'hidden'});await page.getByRole('button',{name:'Save Bybit API key',exact:true}).waitFor();assert.ok(checks>=3);
console.log('PASS credential save/removal refreshes provider status automatically and clears input; mocked private API, no real secrets or provider calls.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
