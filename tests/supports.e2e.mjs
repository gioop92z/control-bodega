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
  await import('./app.js?v=3.8.0');
  await Promise.all(${JSON.stringify(['location-scan.js?v=3.8.0','nova-enhancements.js?v=3.8.0','vantis-session-gate.js?v=3.8.0','nova-tutorial-slides.js?v=3.6.0','vantis-enterprise.js?v=1.0.1','liverpool-branding.js?v=1.1.1','vantis-motion.js?v=1.2.0'])}.map(path=>import('./'+path)));
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
  await page.route('**/scanner.js*',route=>route.fulfill({contentType:'text/javascript',body:'export async function startScanner(cb,label,options={}){window.__testScanner={cb,label,options};if(options.inlineTarget){const el=document.createElement("div");el.id="scanner";el.className="scanner scanner-inline";el.textContent="Cámara de prueba";options.inlineTarget.appendChild(el);}} export function stopScanner(){const s=window.__testScanner;window.__testScanner=null;document.getElementById("scanner")?.remove();s?.options?.onClose?.();}'}));
  await page.route('https://*.supabase.co/**',route=>route.fulfill({contentType:'application/json',headers:{'content-range':'0-0/0'},body:'[]'}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'networkidle'});
  assert.equal(await page.locator('[data-go="supports"]').count(),0,'No extra tab or home action');
  await page.locator('[data-act="SALIDA"]').click();
  await page.locator('#manualCode').waitFor({state:'visible'});
  assert.equal(await page.locator('#manualCode').evaluate(el=>el===document.activeElement),true);
  await page.evaluate(()=>window.__testDb.queryDelay=500);
  // Keyboard events match a USB/Bluetooth reader. No mouse, add button or
  // confirmation between ten consecutive barcode reads.
  for(const p of fixtureProducts){await page.keyboard.type(p.sku);await page.keyboard.press('Enter');}
  assert.equal(await page.locator('[data-exit-row]').count(),10);
  assert.equal(await page.locator('#exitCount').innerText(),'10 piezas');
  assert.equal(await page.locator('#exitFinishPanel').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.__testDb.rpcCalls.length),0);
  assert.ok(await page.locator('.exit-location-chip').filter({hasText:'Consultando'}).count()>0);
  assert.equal(await page.locator('#manualCode').inputValue(),'');
  // Tab suffix and a reader without a suffix, including an unfocused field.
  await page.evaluate(()=>document.activeElement.blur());
  await page.keyboard.type(fixtureProducts[0].upc);await page.keyboard.press('Tab');
  await page.keyboard.type(fixtureProducts[0].sku);
  await page.waitForFunction(()=>document.getElementById('exitCount').textContent==='12 piezas');
  await page.evaluate(()=>window.__testDb.queryDelay=0);
  await page.waitForFunction(()=>![...document.querySelectorAll('.exit-location-chip')].some(el=>el.textContent.includes('Consultando')));
  assert.equal(await page.locator('[data-exit-row]').count(),10);
  assert.equal(await page.locator('[data-exit-quantity]').first().innerText(),'×3');
  await page.locator('#scanMove').click();
  assert.ok(await page.evaluate(()=>window.__testScanner.options.continuous&&window.__testScanner.options.inlineTarget.id==='exitCamera'));
  for(const code of [fixtureProducts[1].sku,fixtureProducts[1].sku,fixtureProducts[2].sku])await page.evaluate(code=>window.__testScanner.cb(code),code);
  assert.equal(await page.locator('#exitCount').innerText(),'15 piezas');
  assert.equal(await page.locator('#exitFinishPanel').isVisible(),false);
  await page.locator('#scanMove').click();
  await page.waitForFunction(()=>![...document.querySelectorAll('.exit-location-chip')].some(el=>el.textContent.includes('Consultando')));
  // Marbete edits are optional, compact and remain in the same exit screen.
  await page.locator('[data-exit-edit]').nth(1).click();
  await page.locator('#exitMarbete').fill('ZAP-459-002');await page.locator('#exitMarbeteForm button').click();
  await page.waitForFunction(()=>!document.getElementById('exitMarbeteForm'));
  assert.match(await page.locator('[data-exit-edit]').nth(1).innerText(),/ZAP-459-002/);
  assert.equal(await page.locator('#exitCount').innerText(),'15 piezas');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'/tmp/vantis-fast-exit-desktop.png',fullPage:true});
  await page.locator('#finishExit').click();
  await page.locator('#exitReason').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.__testDb.rpcCalls.length),0);
  assert.equal(await page.locator('#exitFinishPanel input[type=checkbox]').count(),0);
  await page.locator('#exitReason').selectOption('VENTA NOCTURNA');await page.locator('#exitNote').fill('Turno de prueba');
  await page.locator('#saveExitBatch').dblclick();
  await page.waitForFunction(()=>document.getElementById('exitStatus').textContent.includes('Salida registrada: 15'));
  assert.equal(await page.evaluate(()=>window.__testDb.rpcCalls.length),10);
  assert.equal(await page.evaluate(()=>window.__testDb.movements.length),10);
  assert.equal(await page.evaluate(()=>window.__testDb.products.reduce((sum,p)=>sum+p.stock,0)),185);
  assert.ok(await page.evaluate(()=>window.__testDb.rpcCalls.every(p=>p.p_nota.startsWith('VENTA NOCTURNA')&&p.p_nota.includes('Empleado 472918')&&p.p_nota.includes('Turno de prueba'))));
  // Continue a new sale immediately, with the scanner already focused.
  await page.keyboard.type(fixtureProducts[3].sku);await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-exit-row]').count(),1);
  await page.keyboard.type('NO-EXISTE');await page.keyboard.press('Enter');
  await page.keyboard.type(fixtureProducts[4].sku);await page.keyboard.press('Enter');
  assert.equal(await page.locator('#exitCount').innerText(),'3 piezas');
  assert.equal(await page.locator('#exitFinishPanel').isVisible(),false);
  await page.waitForFunction(()=>![...document.querySelectorAll('.exit-location-chip')].some(el=>el.textContent.includes('Consultando')));
  await page.locator('#finishExit').click();await page.locator('#exitError').waitFor({state:'visible'});
  assert.equal(await page.locator('#exitFinishPanel').isVisible(),false);
  await page.locator('[data-exit-row]').filter({hasText:'NO-EXISTE'}).locator('[data-exit-remove]').click();
  await page.setViewportSize({width:390,height:844});
  await page.locator('#scanMove').click();await page.evaluate(code=>window.__testScanner.cb(code),fixtureProducts[5].sku);
  await page.evaluate(code=>window.__testScanner.cb(code),fixtureProducts[5].sku);
  await page.locator('#scanMove').click();
  await page.waitForFunction(()=>![...document.querySelectorAll('.exit-location-chip')].some(el=>el.textContent.includes('Consultando')));
  assert.equal(await page.locator('#exitCount').innerText(),'4 piezas');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'/tmp/vantis-fast-exit-mobile.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.locator('[data-view="home"]').click();await page.locator('[data-act="SALIDA"]').click();
  assert.equal(await page.locator('#exitCount').innerText(),'4 piezas');
  await page.reload({waitUntil:'networkidle'});await page.locator('[data-act="SALIDA"]').click();
  assert.equal(await page.locator('#exitCount').innerText(),'4 piezas');
  // Paste is also immediate, in the same capture field.
  await page.locator('#manualCode').evaluate((el,text)=>el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:(()=>{const data=new DataTransfer();data.setData('text/plain',text);return data})()})),fixtureProducts[6].sku+'\n'+fixtureProducts[7].sku);
  assert.equal(await page.locator('#exitCount').innerText(),'6 piezas');
  await page.waitForFunction(()=>![...document.querySelectorAll('.exit-location-chip')].some(el=>el.textContent.includes('Consultando')));
  // A final server rejection returns to capture, retaining the whole queue.
  await page.locator('#finishExit').click();await page.locator('#exitReason').waitFor({state:'visible'});
  await page.evaluate(()=>window.__testDb.rpcError={code:'P0001',message:'Stock insuficiente'});
  await page.locator('#saveExitBatch').click();await page.locator('#exitError').filter({hasText:'rechazada'}).waitFor({state:'visible'});
  assert.equal(await page.locator('#exitFinishPanel').isVisible(),false);
  assert.equal(await page.locator('#exitCount').innerText(),'6 piezas');
  await page.evaluate(()=>window.__testDb.rpcError=null);
  await page.keyboard.type(fixtureProducts[3].sku);await page.keyboard.press('Enter');
  assert.equal(await page.locator('#exitCount').innerText(),'7 piezas');
  assert.deepEqual(errors,[]);
  console.log('Fast exit passed on desktop/mobile: ten automatic HID reads, Enter/Tab/no suffix, global focus recovery, reads during lookup, inline camera, optional marbetes, final reason once, night sale, immediate next sale, paste and recovery.');
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
