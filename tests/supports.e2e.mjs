// Full app integration with an isolated database; no request can write to the
// user's real Supabase project. Run with `node tests/supports.e2e.mjs`.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const directory=resolve(new URL('..',import.meta.url).pathname);
const fixtureProducts=Array.from({length:10},(_,i)=>({id:'p'+(i+1),sku:String(12345678+i).padStart(10,'0'),upc:String(200000000001+i).padStart(13,'0'),descripcion:'TENIS DE PRUEBA '+(i+1),marca:'DEMO',talla:'23',color:'NEGRO',stock:20,departamento_id:'dept1',activo:true}));
const bootstrap=`
  import {supportDb} from './tests/helpers/support-db.mjs';
  const persisted=JSON.parse(localStorage.getItem('__testDb')||'null');
  const {db,sb}=supportDb(persisted||{products:${JSON.stringify(fixtureProducts)},assignments:[{sku:'0012345678',marbete_codigo:'ZAP-459-001',cantidad:10}]});
  window.__testDb=db;
  const save=()=>localStorage.setItem('__testDb',JSON.stringify(db));
  window.__testSb={
    auth:{getUser:async()=>({data:{user:{id:'test-user',email:'10@bodega.local'}},error:null}),signOut:async()=>({error:null})},
    from(table){
      if(table==='departamentos')return {select(){return this},eq(){return this},gt(){return this},order(){return this},then(resolve){return Promise.resolve({data:[{id:'dept1',nombre:'Zapatería',activo:true,created_at:'2026-10-01T00:00:00Z'}],error:null}).then(resolve)}};
      const query=sb.from(table), original=query.then;
      query.then=function(resolve,reject){return original.call(this,result=>{save();return resolve(result)},reject)};
      return query;
    },
    rpc(name,payload){
      if(name==='resumen_departamento')return Promise.resolve({data:{productos:10,unidades:200},error:null});
      const query=sb.rpc(name,payload),original=query.then;
      query.then=function(resolve,reject){return original.call(this,result=>{save();return resolve(result)},reject)};
      return query;
    }
  };
  await import('./app.js?v=3.7.0');
  await Promise.all(${JSON.stringify(['location-scan.js?v=3.7.0','nova-enhancements.js?v=3.7.0','vantis-session-gate.js?v=3.7.0','nova-tutorial-slides.js?v=3.6.0','vantis-enterprise.js?v=1.0.1','liverpool-branding.js?v=1.1.1','vantis-motion.js?v=1.2.0'])}.map(path=>import('./'+path)));
`;
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'),file=resolve(directory,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(directory+sep))throw Error('Invalid path');
    let content=await readFile(file);
    if(file.endsWith('index.html'))content=Buffer.from(content.toString().replace(/<script type="module" src="[^"]+"><\/script>/g,'').replace('</body>',`<script type="module">${bootstrap}</script></body>`));
    res.writeHead(200,{'Content-Type':({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]||'text/plain','Cache-Control':'no-store'});res.end(content);
  }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.VANTIS_CHROMIUM_PATH?{executablePath:process.env.VANTIS_CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1365,height:1000},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    sessionStorage.setItem('nova.employeeNumber','472918');sessionStorage.setItem('vantis.session.ready','1');sessionStorage.setItem('vantis.session.department','dept1');sessionStorage.setItem('vantis.session.role','seller');localStorage.setItem('inv.dept','dept1');
  });
  await page.route('https://esm.sh/**',route=>{
    const url=route.request().url();
    if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:'export const createClient=()=>window.__testSb;'});
    if(url.includes('xlsx'))return route.fulfill({contentType:'text/javascript',body:'export const utils={}; export const read=()=>({});export const writeFile=()=>{};'});
    return route.abort();
  });
  await page.route('**/scanner.js*',route=>route.fulfill({contentType:'text/javascript',body:'export async function startScanner(cb,label,options){window.__testScanner={cb,label,options};} export function stopScanner(){window.__testScanner=null;}'}));
  await page.route('https://*.supabase.co/**',route=>route.fulfill({contentType:'application/json',headers:{'content-range':'0-0/0'},body:'[]'}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'networkidle'});
  await page.locator('[data-go="supports"]').click();
  await page.locator('#supportScanCode').waitFor({state:'visible'});
  await page.locator('#supportPasteText').fill('Pedido\tSKU\tCantidad\n'+fixtureProducts.map((p,i)=>`${i+1}\t${p.sku}\t1`).join('\n'));
  await page.locator('#supportReadPaste').click();
  assert.equal(await page.locator('#supportCodeColumn').inputValue(),'1');
  assert.equal(await page.locator('#supportQuantityColumn').inputValue(),'2');
  await page.locator('#supportAddPaste').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-support-row]').length===10);
  await page.waitForFunction(()=>!document.getElementById('supportPasteDetails').open);
  await page.evaluate(()=>window.__testDb.queryDelay=100);
  await page.locator('#supportScanCode').fill(fixtureProducts[0].sku);await page.locator('#supportScanCode').press('Enter');
  await page.locator('#supportScanCode').fill('00123');
  await page.waitForFunction(()=>document.querySelector('[data-support-qty]').value==='2');
  assert.equal(await page.locator('#supportScanCode').inputValue(),'00123','Pending responses must preserve the next USB barcode being typed');
  await page.locator('#supportScanCode').fill('');await page.evaluate(()=>window.__testDb.queryDelay=0);
  await page.locator('#supportCamera').click();assert.equal(await page.evaluate(()=>window.__testScanner.options.continuous),true);
  await page.evaluate(code=>window.__testScanner.cb(code),fixtureProducts[1].upc);
  assert.equal(await page.locator('[data-support-qty]').nth(1).inputValue(),'2');
  await page.locator('[data-support-assign]').nth(1).click();
  await page.locator('#supportMarbeteCode').fill('ZAP-459-002');await page.locator('#supportLocationForm button').click();
  await page.waitForFunction(()=>!document.getElementById('supportLocationForm'));
  assert.equal(await page.locator('[data-support-location]').nth(0).inputValue(),'ZAP-459-001');
  assert.equal(await page.locator('[data-support-location]').nth(1).inputValue(),'ZAP-459-002');
  await page.locator('[data-support-qty]').first().fill('3');
  await page.locator('#supportNote').fill('Apoyos de prueba');
  assert.match(await page.locator('#supportReview').innerText(),/13 piezas/);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'/tmp/vantis-supports-desktop.png',fullPage:true});
  await page.locator('#supportReview').click();await page.locator('#supportConfirm').waitFor({state:'visible'});
  await page.locator('#supportAcknowledge').check();await page.locator('#supportConfirm').dblclick();
  await page.locator('#supportNewBatch').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.__testDb.rpcCalls.length),10);
  assert.equal(await page.evaluate(()=>window.__testDb.movements.length),10);
  assert.equal(await page.evaluate(()=>window.__testDb.products.reduce((sum,p)=>sum+p.stock,0)),187);
  assert.ok(await page.evaluate(()=>window.__testDb.rpcCalls.every(p=>p.p_nota.includes('Empleado 472918')&&p.p_nota.includes('Apoyos de prueba'))));
  await page.locator('#supportNewBatch').click();
  assert.equal(await page.locator('[data-support-row]').count(),0);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#supportPasteText').fill(fixtureProducts.slice(0,3).map(p=>p.sku).join('\n'));
  await page.locator('#supportReadPaste').click();await page.locator('#supportAddPaste').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-support-row]').length===3);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'/tmp/vantis-supports-mobile.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'The mobile layout must not overflow horizontally');
  await page.locator('[data-view="home"]').click();await page.locator('[data-go="supports"]').click();
  assert.equal(await page.locator('[data-support-row]').count(),3);
  await page.reload({waitUntil:'networkidle'});await page.locator('[data-go="supports"]').click();
  assert.equal(await page.locator('[data-support-row]').count(),3);
  await page.locator('#supportScanCode').fill('NO-EXISTE');await page.locator('#supportScanCode').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('[data-support-row]').length===4);
  await page.locator('#supportReview').click();await page.locator('[role="alert"]').filter({hasText:'pendientes'}).waitFor();
  assert.equal(await page.locator('#supportConfirm').count(),0);
  await page.locator('[data-support-remove]').last().click();
  await page.locator('[data-support-assign]').nth(2).click();await page.locator('#supportMarbeteCode').fill('NUEVO');await page.locator('#supportLocationForm button').click();
  await page.locator('.support-location-editor .error').waitFor();
  assert.equal(await page.locator('#supportRegisterMarbete').count(),0,'Seller cannot register a new marbete');
  assert.deepEqual(errors,[]);
  console.log('Desktop and mobile UI passed: paste 10 rows, USB/camera queue, per-row marbetes, one batch confirmation, note/actor, draft recovery, unresolved codes and seller permissions.');
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
