import {webkit,chromium} from 'playwright';
import assert from 'node:assert/strict';
const base='https://gioop92z.github.io/control-bodega/team.html?outbound=5.16.0';
for(const [name,engine] of [['iPhone Safari',webkit],['Desktop Chrome',chromium]]){
 const browser=await engine.launch({headless:true});
 const context=await browser.newContext(name==='iPhone Safari'?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1200,height:900}});
 const page=await context.newPage();
 const errors=[],outbound=[],stock=new Map([['12345678',2]]);
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/functions/v1/vantis-inventory/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  const headers={'access-control-allow-origin':'https://gioop92z.github.io','access-control-allow-headers':'authorization,apikey,content-type,x-vantis-token','access-control-allow-methods':'GET,POST,PATCH,OPTIONS','content-type':'application/json'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
  let body={},status=200;
  const payload=request.method()==='POST'?request.postDataJSON():{};
  if(path.endsWith('/api/login'))body={employee:'16647310',name:'Admin',role:'admin',token:'test-token'};
  else if(path.endsWith('/api/me'))body={employee:'16647310',name:'Admin',role:'admin'};
  else if(path.endsWith('/api/summary'))body={units:stock.get('12345678'),products:1,labels:1,receipts:282};
  else if(path.endsWith('/api/history'))body={items:[]};
  else if(path.endsWith('/api/people'))body={items:[]};
  else if(path.endsWith('/api/outbound')){
   assert.equal(payload.p_marbete,'ZAP-402-006');
   assert.equal(payload.p_producto,'12345678');
   const existing=outbound.find(x=>x.id===payload.p_id);
   if(existing)body=existing;
   else if(stock.get('12345678')<=0){status=422;body={error:'Ese artículo no tiene piezas disponibles en el marbete activo.'}}
   else{stock.set('12345678',stock.get('12345678')-1);body={id:payload.p_id,kind:'dispatch'};outbound.push(body)}
  }else if(path.endsWith('/api/capabilities'))body={version:1,atomic:true,idempotent:true};
  else if(path.endsWith('/api/search'))body={items:[]};
  else if(path.endsWith('/api/labels'))body={codigo:payload.code};
  else body={};
  await route.fulfill({status,headers,body:JSON.stringify(body)});
 });
 try{
  const response=await page.goto(base,{waitUntil:'domcontentloaded',timeout:45000});assert.equal(response.status(),200);
  await page.locator('#teamLoginSection').waitFor({state:'visible',timeout:20000});
  await page.locator('#teamEmployee').fill('16647310');await page.locator('#teamPin').fill('12345678');
  await page.locator('#teamLogin button').click();
  await page.locator('#teamModeOutbound').waitFor({state:'visible',timeout:20000});
  await page.locator('#teamModeOutbound').click();
  await page.locator('#outScan').fill('ZAP-402-006');await page.locator('#outForm').evaluate(e=>e.requestSubmit());
  await page.waitForFunction(()=>document.querySelector('#outLocation')?.textContent==='ZAP-402-006');
  for(let i=0;i<3;i++){
   await page.locator('#outScan').fill('12345678');await page.locator('#outForm').evaluate(e=>e.requestSubmit());
   await page.waitForTimeout(700);
  }
  await page.waitForFunction(()=>document.querySelector('#outCount')?.textContent==='2',{timeout:15000});
  assert.equal(outbound.length,2,'only two units may leave stock');
  assert.equal(stock.get('12345678'),0,'stock cannot be negative');
  assert.match(await page.locator('#outRows').innerText(),/Rechazado/);
  assert.deepEqual(errors,[],'No browser errors');
  console.log('PASS '+name+': marbete + scanner → 2 atomic outbound deductions; third rejected; stock=0.');
 }finally{await context.close();await browser.close()}
}
