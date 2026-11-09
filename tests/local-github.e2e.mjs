// Production-style browser QA. No external API or real inventory touched.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';

const base=resolve(new URL('..',import.meta.url).pathname);
const server=createServer(async(req,res)=>{
  try{
    const path=resolve(base,'.'+new URL(req.url,'http://localhost').pathname);
    if(!path.startsWith(base+sep))throw Error('Invalid path');
    const bytes=await readFile(path);
    res.writeHead(200,{'Content-Type':({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(path)]||'text/plain'});
    res.end(bytes);
  }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext();
  const page=await context.newPage();
  const pageErrors=[],supabaseCalls=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  await page.route('https://*.supabase.co/**',route=>{supabaseCalls.push(route.request().url());return route.abort();});
  await page.route('**/scanner.js*',route=>route.fulfill({contentType:'text/javascript',body:
    'export async function startScanner(cb,label,opts={}){window.__cameraScan=cb;document.body.insertAdjacentHTML("beforeend","<div id=\\\"scanner\\\"></div>");} export function stopScanner(){document.getElementById("scanner")?.remove();window.__cameraScan=null;}'}));
  await page.goto(origin+'/local.html',{waitUntil:'domcontentloaded'});
  await page.locator('#localEmployee').fill('16647310');
  await page.locator('#localLogin button').click();
  await page.locator('#crScan:not(:disabled)').waitFor({timeout:15000});
  assert.match(await page.locator('.vantis-local-tag').innerText(),/sin Supabase/i);
  const scan=async code=>{
    await page.locator('#crScan').fill(code);
    await page.locator('#crScan').press('Enter');
  };
  await scan("ZAP'405'085");
  await page.waitForFunction(()=>document.querySelector('#crLocation')?.textContent==='ZAP-405-085');
  await scan('1200768635');await scan('1200768635');
  await scan('ZAP*402*003');await scan('0200000000001');
  await page.waitForFunction(()=>document.querySelector('#crTotalCount')?.textContent==='3',{timeout:30000});
  const receiptSnapshot=await page.evaluate(async()=>{
    const {LocalInventoryApi}=await import('./vantis-github-local-db.mjs');
    return new LocalInventoryApi().exportBackup();
  });
  assert.equal(receiptSnapshot.items.receipts.length,3);
  const counts=receiptSnapshot.items.receipts.reduce((map,x)=>{
    const label=x.receipt.marbete_codigo;map[label]=(map[label]||0)+1;return map;
  },{});
  assert.deepEqual(counts,{'ZAP-405-085':2,'ZAP-402-003':1});
  assert.equal(receiptSnapshot.items.products.reduce((a,b)=>a+b.stock,0),3);
  assert.equal(new Set(receiptSnapshot.items.receipts.map(x=>x.id)).size,3);
  assert.equal(supabaseCalls.length,0,'local mode must not contact Supabase');
  await page.reload();
  await page.locator('#crScan:not(:disabled)').waitFor({timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#crTotalCount')?.textContent==='3',{timeout:15000});
  const idempotence=await page.evaluate(async()=>{
    const {LocalInventoryApi}=await import('./vantis-github-local-db.mjs');
    const a=new LocalInventoryApi(),before=await a.exportBackup();
    await a.receive(before.items.receipts[0].payload);
    const after=await a.exportBackup();
    return {count:after.items.receipts.length,units:after.items.products.reduce((s,p)=>s+p.stock,0)};
  });
  assert.deepEqual(idempotence,{count:3,units:3});
  await page.locator('#localJson').click();
  await page.locator('#localBackupStatus').filter({hasText:'Respaldo descargado'}).waitFor();
  assert.equal(pageErrors.length,0,'browser errors: '+pageErrors.join('; '));
  await context.close();

  // Stress test the ACTUAL IndexedDB engine and commit code (not only an in-memory fake).
  const stress=await browser.newContext();
  const stressPage=await stress.newPage();
  await stressPage.goto(origin+'/local.html',{waitUntil:'domcontentloaded'});
  const result=await stressPage.evaluate(async()=>{
    const {LocalInventoryApi}=await import('./vantis-github-local-db.mjs');
    const api=new LocalInventoryApi();
    await api.capabilities();
    const session=crypto.randomUUID(),sku='1200768635';
    const product=await api.ensureProduct(sku);
    for(let x=1;x<=100;x++){
      const label='ZAP-402-'+String(x).padStart(3,'0');
      await api.activate(label);
      for(let n=0;n<100;n++)await api.receive({
        p_id:crypto.randomUUID(),p_sesion:session,p_departamento:api.deptId,p_producto:product.id,
        p_marbete:label,p_operador:'TEST 10000',p_leida_en:new Date().toISOString(),p_reversa:null
      });
    }
    const backup=await api.exportBackup();
    const locations=backup.items.assignments;
    return {receipts:backup.items.receipts.length,units:backup.items.products[0].stock,
      labels:backup.items.labels.length,assignments:locations.length,
      min:Math.min(...locations.map(x=>x.cantidad)),max:Math.max(...locations.map(x=>x.cantidad)),
      distinct:new Set(backup.items.receipts.map(x=>x.id)).size};
  });
  assert.deepEqual(result,{receipts:10000,units:10000,labels:100,assignments:100,min:100,max:100,distinct:10000});
  await stress.close();
  console.log('VANTIS GITHUB LOCAL PASS: 3 physical UI reads, durable reload, no Supabase, exact-once, 10000 IndexedDB receipts / 100 locations');
}finally{
  await browser.close();await new Promise(done=>server.close(done));
}