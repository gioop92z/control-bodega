import {webkit, chromium} from 'playwright';
import assert from 'node:assert/strict';

const origin='https://gioop92z.github.io';
const app=origin+'/control-bodega/team.html?mobileQA=5.15.1';
const fake='88889999',pin='12345678';
let logins=0;

async function browserCase(browser,device){
  const context=await browser.newContext(device==='iphone'?
    {viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}:
    {viewport:{width:1280,height:850}});
  const page=await context.newPage(),pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  await page.route('**/functions/v1/vantis-inventory/api/**',async route=>{
    const req=route.request();
    const path=new URL(req.url()).pathname;
    const method=req.method();
    const cors={'access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST,PATCH,OPTIONS',
      'access-control-allow-headers':'apikey,authorization,content-type,x-vantis-token',
      'content-type':'application/json; charset=utf-8'};
    if(method==='OPTIONS')return route.fulfill({status:204,headers:cors,body:''});
    const body=method==='POST'?req.postDataJSON():{};
    let answer={error:'Unexpected mock request'},status=404;
    if(path.endsWith('/api/login')){
      logins++;
      assert.equal(body.employee,fake,'same account on both devices');
      assert.equal(body.pin,pin,'same PIN on both devices');
      answer={token:'test-only-webkit-session',employee:fake,name:'Prueba iPhone',role:'admin'};status=200;
    }else if(path.endsWith('/api/me')){
      answer={employee:fake,name:'Prueba iPhone',role:'admin',active:true};status=200;
    }else if(path.endsWith('/api/summary')){
      answer={products:135,labels:5,receipts:282,units:282};status=200;
    }else if(path.endsWith('/api/history')){
      answer={items:[]};status=200;
    }else if(path.endsWith('/api/people')){
      answer={items:[{employee:fake,name:'Prueba iPhone',role:'admin',active:true}]};status=200;
    }else if(path.endsWith('/api/search')){
      answer={items:[]};status=200;
    }
    await route.fulfill({status,headers:cors,body:JSON.stringify(answer)});
  });
  try{
    const response=await page.goto(app,{waitUntil:'domcontentloaded',timeout:45000});
    assert.equal(response?.status(),200);
    await page.locator('#teamLoginSection').waitFor({state:'visible',timeout:18000});
    assert.ok((await page.locator('#teamLoginSection').innerText()).includes('Versión móvil 5.15.1'),
      'must use fresh 5.15.1 deployment instead of cached login code');
    await page.locator('#teamEmployee').fill(fake);
    await page.locator('#teamPin').fill(pin);
    await page.locator('#teamLogin button[type="submit"]').click();
    await page.locator('#teamApp').waitFor({state:'visible',timeout:20000});
    await page.locator('#teamScanSection').waitFor({state:'visible',timeout:20000});
    await page.waitForFunction(()=>document.querySelector('#teamStats')?.textContent.includes('282'),
      {timeout:15000});
    assert.equal(await page.locator('#teamLoginSection').isVisible(),false);
    assert.equal(pageErrors.length,0,'No uncaught client exceptions: '+pageErrors.join('; '));
    console.log('PASS '+device+': same admin PIN → authenticated inventory, 282 shared movements, scanning visible.');
  }finally{await context.close();}
}

const safari=await webkit.launch({headless:true});
const chrome=await chromium.launch({headless:true});
try{
  await browserCase(safari,'iphone');
  await browserCase(chrome,'desktop');
  assert.equal(logins,2,'both devices must independently authenticate');
}finally{
  await safari.close();
  await chrome.close();
}
