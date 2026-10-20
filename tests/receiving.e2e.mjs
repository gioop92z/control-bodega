// Full application, actual HID/input/UI code, isolated in-browser database.
// All external traffic is intercepted; this test cannot change real stock.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';

const directory=resolve(new URL('..',import.meta.url).pathname);
const bootstrap=`
  import {receivingDb} from './tests/helpers/receiving-db.mjs';
  const saved=JSON.parse(localStorage.getItem('__receiptFixture')||'null');
  const {db,api}=receivingDb(saved||{});
  if(saved?.receipts)db.receipts=new Map(saved.receipts);
  if(localStorage.getItem('__missingBackend'))db.capabilityError={code:'PGRST202',message:'Not installed'};
  window.__receiptFixture=db;
  const persist=()=>localStorage.setItem('__receiptFixture',JSON.stringify({products:db.products,marbetes:db.marbetes,assignments:db.assignments,movements:db.movements,receipts:[...db.receipts.entries()]}));
  const receiptApi=api('test-user');
  window.__testSb={
    auth:{getUser:async()=>({data:{user:{id:'test-user',email:'10@bodega.local'}}}),signOut:async()=>({error:null})},
    from(table){
      if(table==='departamentos')return {select(){return this;},eq(){return this;},gt(){return this;},order(){return this;},then(resolve){return Promise.resolve({data:[{id:'dept1',nombre:'Zapatería · prueba aislada',activo:true,created_at:'2026-10-19'}],error:null}).then(resolve);}};
      throw Error('Unexpected table: '+table);
    },
    rpc(name,payload){
      if(name==='resumen_departamento')return Promise.resolve({data:{productos:2,unidades:20},error:null});
      let fn;
      if(name==='vantis_recepcion_estado_v1')fn=()=>receiptApi.capabilities();
      else if(name==='vantis_activar_marbete_v1')fn=()=>receiptApi.activate(payload.p_codigo);
      else if(name==='vantis_recibir_pieza_v1')fn=()=>receiptApi.receive(payload);
      else throw Error('Unexpected RPC: '+name);
      return {abortSignal(){return this;},then(resolve,reject){return Promise.resolve().then(fn).then(data=>({data,error:null}),error=>({data:null,error})).then(result=>{persist();return resolve(result);},reject);}};
    }
  };
  // Use the production product lookup with the fixture's existing query API.
  import {supportDb} from './tests/helpers/support-db.mjs';
  const previous=window.__testSb.from;
  window.__testSb.from=table=>{
    if(table==='departamentos')return previous(table);
    const {sb}=supportDb({products:db.products,marbetes:db.marbetes,assignments:db.assignments,movements:db.movements});
    return sb.from(table);
  };
  await import('./app.js?v=3.10.0');
  await Promise.all(['location-scan.js?v=3.9.5','nova-enhancements.js?v=3.8.0','vantis-session-gate.js?v=3.8.0','nova-tutorial-slides.js?v=3.6.0','vantis-enterprise.js?v=1.0.1','liverpool-branding.js?v=1.1.1','vantis-motion.js?v=1.2.0'].map(path=>import('./'+path)));
`;
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost'),file=resolve(directory,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(directory+sep))throw Error('Invalid path');
    let content=await readFile(file);
    if(file.endsWith('index.html'))content=Buffer.from(content.toString().replace(/<script type="module" src="[^"]+"><\/script>/g,'').replace('</body>',`<script type="module">${bootstrap}</script></body>`));
    res.writeHead(200,{'Content-Type':({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]||'text/plain'});res.end(content);
  }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await mkdir('/tmp/vantis-receiving-qa',{recursive:true});
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1050},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    sessionStorage.setItem('nova.employeeNumber','472918');sessionStorage.setItem('vantis.session.ready','1');sessionStorage.setItem('vantis.session.department','dept1');sessionStorage.setItem('vantis.session.role','seller');localStorage.setItem('inv.dept','dept1');
  });
  await page.route('https://esm.sh/**',route=>{
    const url=route.request().url();
    if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:'export const createClient=()=>window.__testSb;'});
    if(url.includes('xlsx'))return route.fulfill({contentType:'text/javascript',body:'export const utils={};export const read=()=>({});export const writeFile=()=>{};'});
    return route.abort();
  });
  await page.route('**/scanner.js*',route=>route.fulfill({contentType:'text/javascript',body:`
    export async function startScanner(cb,label,options={}){window.__scanner={cb,label,options};window.__cameraOpens=(window.__cameraOpens||0)+1;const div=document.createElement('div');div.id='scanner';div.textContent='Cámara de prueba';options.inlineTarget.appendChild(div);}
    export function stopScanner(){const s=window.__scanner;window.__scanner=null;document.getElementById('scanner')?.remove();s?.options.onClose?.();}
  `}));
  let blockedWrites=0;
  await page.route('https://*.supabase.co/**',route=>{if(route.request().method()!=='GET')blockedWrites++;return route.abort();});
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'networkidle'});
  await page.locator('[data-act="ENTRADA"]').click();await page.locator('#crScan:not(:disabled)').waitFor();
  assert.match(await page.locator('#crInstruction').innerText(),/ESCANEA UN MARBETE/);
  // True keyboard events: no click or field focus between frames.
  await page.keyboard.type('402-001');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.getElementById('crLocationLabel').textContent==='MARBETE ACTIVO'&&document.getElementById('crLocation').textContent==='402-001');
  for(let i=0;i<5;i++){await page.keyboard.type('0012345678');await page.keyboard.press(i%2?'Tab':'Enter');}
  await page.waitForFunction(()=>document.getElementById('crTotalCount').textContent==='5');
  assert.equal(await page.evaluate(()=>window.__receiptFixture.movements.length),5);
  assert.equal(await page.locator('#crSwitch').isVisible(),false);
  // Both a barcode with no suffix and global focus recovery are supported.
  await page.locator('.cr-brand').click();await page.keyboard.type('0012345678');
  await page.waitForFunction(()=>document.getElementById('crTotalCount').textContent==='6');
  await page.keyboard.type('402-002');await page.keyboard.press('Enter');await page.locator('#crSwitch').waitFor({state:'visible'});
  assert.equal(await page.locator('#crLocation').innerText(),'402-001');
  await page.locator('#crCancelSwitch').click();await page.keyboard.type('0012345678');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.getElementById('crTotalCount').textContent==='7');
  await page.keyboard.type('402-002');await page.keyboard.press('Enter');await page.locator('#crConfirmSwitch').click();
  await page.waitForFunction(()=>document.getElementById('crLocation').textContent==='402-002'&&document.getElementById('crLocationLabel').textContent==='MARBETE ACTIVO');
  assert.equal(await page.locator('#crVisitCount').innerText(),'0');
  // Continuous camera callback is shared by marbetes, QR and products.
  await page.locator('#crCameraButton').click();await page.waitForFunction(()=>!!window.__scanner);
  assert.equal(await page.evaluate(()=>window.__scanner.options.qrEnabled),true);
  for(let i=0;i<3;i++)await page.evaluate(()=>window.__scanner.cb('0200000000001'));
  await page.waitForFunction(()=>document.getElementById('crTotalCount').textContent==='10');
  assert.equal(await page.evaluate(()=>window.__cameraOpens),1);
  await page.evaluate(()=>window.__scanner.cb('{"marbete":"ZAP-402-003"}'));
  await page.locator('#crConfirmSwitch').click();await page.waitForFunction(()=>document.getElementById('crLocation').textContent==='402-003'&&document.getElementById('crLocationLabel').textContent==='MARBETE ACTIVO');
  assert.equal(await page.evaluate(()=>window.__cameraOpens),1);
  await page.locator('#crCameraButton').click();
  // Large HID bursts exercise actual input listeners and durable browser storage.
  for(const count of [100,500,1000]){
    const before=Number((await page.locator('#crTotalCount').innerText()).replace(/,/g,''));
    await page.evaluate(count=>{
      const input=document.getElementById('crScan');
      for(let i=0;i<count;i++){
        input.value='0012345678';input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:input.value}));
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      }
    },count);
    await page.waitForFunction(total=>Number(document.getElementById('crTotalCount').textContent.replace(/,/g,''))===total,before+count,{timeout:30000});
    assert.equal(await page.evaluate(()=>window.__receiptFixture.movements.length),before+count);
  }
  await page.screenshot({path:'/tmp/vantis-receiving-qa/desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile should not overflow');
  for(const selector of ['.cr-stage','#crScan','.cr-counters','#crLocation','.cr-heading']){
    assert.equal(await page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),true,selector+' must fit on mobile');
  }
  assert.equal(await page.locator('.bottom-nav').isVisible(),false);
  assert.equal(await page.locator('.topbar').isVisible(),false);
  await page.screenshot({path:'/tmp/vantis-receiving-qa/mobile.png',fullPage:true});
  const before=await page.evaluate(()=>window.__receiptFixture.products[0].stock);
  await page.locator('#crUndo').click();await page.waitForFunction(()=>document.getElementById('crTotalCount').textContent==='1,609');
  assert.equal(await page.evaluate(()=>window.__receiptFixture.products[0].stock),before-1);
  await page.locator('#crFinish').click();await page.locator('#crSummary').waitFor({state:'visible'});
  const downloadEvent=page.waitForEvent('download');await page.locator('#crDownload').click();const download=await downloadEvent;
  assert.match(download.suggestedFilename(),/^VANTIS-recepcion-.*\.csv$/);
  const movements=await page.evaluate(()=>window.__receiptFixture.movements.length);
  await page.locator('#crResume').click();assert.equal(await page.evaluate(()=>window.__receiptFixture.movements.length),movements);
  await page.reload({waitUntil:'networkidle'});await page.locator('[data-act="ENTRADA"]').click();await page.locator('#crScan:not(:disabled)').waitFor();
  assert.equal(await page.locator('#crTotalCount').innerText(),'1,609');assert.equal(await page.locator('#crLocation').innerText(),'402-003');
  // No server response: pending is never presented as a stored success.
  await page.evaluate(()=>window.__receiptFixture.lostResponse=true);await page.keyboard.type('0012345678');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.getElementById('crSync').textContent.includes('1 pendientes'));
  assert.equal(await page.locator('#crTotalCount').innerText(),'1,609');
  await page.locator('#crRetry').click();await page.waitForFunction(()=>document.getElementById('crTotalCount').textContent==='1,610');
  assert.equal(await page.evaluate(()=>window.__receiptFixture.products[0].stock),1620);
  await page.keyboard.type('UNKNOWN');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.getElementById('crSync').textContent.includes('1 fallidos'));
  assert.equal(await page.locator('#crTotalCount').innerText(),'1,610');
  // Source can deploy before the additive server migration without breaking
  // the previous receiving operation or pretending continuous saving works.
  await page.evaluate(()=>{localStorage.clear();localStorage.setItem('__missingBackend','1');});
  await page.reload({waitUntil:'networkidle'});await page.locator('[data-act="ENTRADA"]').click();await page.locator('#receiveCode').waitFor();
  assert.match(await page.locator('.notice').first().innerText(),/pendiente de activar/);
  assert.equal(blockedWrites,0);assert.deepEqual(errors,[]);
  console.log('Receiving desktop/mobile passed: HID/Tab/no suffix, 100/500/1000 reads, technical duplicate terminators, camera/QR continuity, switch/cancel, durable restore, lost response, audited undo, CSV, unknown article, safe legacy fallback. No real inventory writes.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
