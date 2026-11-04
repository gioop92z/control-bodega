// Visual scanner smoke test: no warehouse data, no real camera permissions.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const html=`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/scanner-pro.css">
<link rel="stylesheet" href="/vantis-minimal-operations.css"></head><body>
<script type="module">
import {startScanner,stopScanner} from '/scanner.js';
window.received=[];
window.openScannerForTest=()=>startScanner(code=>{window.received.push(code)},'marbete o mercancía',{continuous:true,qrEnabled:true});
window.closeScannerForTest=stopScanner;
</script></body></html>`;

const files=new Set(['scanner.js','scanner-pro.css','vantis-minimal-operations.css']);
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname.slice(1);
  if(!path){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  if(!files.has(path)){res.writeHead(404);res.end();return;}
  try{
    const body=await readFile(new URL('../'+path,import.meta.url));
    res.writeHead(200,{'Content-Type':path.endsWith('.css')?'text/css':'text/javascript'});
    res.end(body);
  }catch{res.writeHead(500);res.end();}
});

await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://esm.sh/**',route=>{
    const url=route.request().url();
    const library=`export const BarcodeFormat=new Proxy({}, {get:(_,key)=>String(key)});
export const DecodeHintType={POSSIBLE_FORMATS:1,TRY_HARDER:2,ALSO_INVERTED:3};`;
    const reader=`export class BrowserMultiFormatReader {
  async decodeFromConstraints(_constraints,_video,onDecode){
    window.__emitForTest=code=>onDecode({getText:()=>code});
    return {stop(){window.__stoppedForTest=true;}};
  }
}`;
    route.fulfill({status:200,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},
      body:url.includes('@zxing/browser@')?reader:url.includes('@zxing/library@')?library:'export {}'});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
  await page.waitForFunction(()=>typeof window.openScannerForTest==='function');
  await page.evaluate(()=>window.openScannerForTest());
  await page.locator('#scanner.scanner-pro').waitFor();
  const visual=await page.evaluate(()=>{
    const frame=document.querySelector('#scanner .scanner-target').getBoundingClientRect();
    const root=document.getElementById('scanner').getBoundingClientRect();
    const laser=document.querySelector('#scanner .scanner-laser');
    return {frameWidth:frame.width,frameHeight:frame.height,rootHeight:root.height,screenHeight:innerHeight,
      width:document.documentElement.scrollWidth,screenWidth:innerWidth,
      laserDisplay:getComputedStyle(laser).display,
      laserAnimation:getComputedStyle(laser).animationName};
  });
  assert.ok(visual.frameWidth>240&&visual.frameHeight>140,'target must be readable on a phone');
  assert.ok(Math.abs(visual.rootHeight-visual.screenHeight)<=2,'camera must fit the mobile viewport');
  assert.ok(visual.width<=visual.screenWidth,'scanner must not overflow horizontally');
  assert.equal(visual.laserDisplay,'none','no decorative laser');
  assert.equal(visual.laserAnimation,'none','no continuous laser animation');
  assert.equal(await page.locator('#scanSwitchEngine').isVisible(),true);
  assert.equal(await page.locator('#scannerStatus').innerText(),'Lector listo · QR y barras');

  await page.evaluate(()=>{window.__emitForTest('SKU-TEST-01');window.__emitForTest('SKU-TEST-01');});
  await page.locator('#scannerReceipt:not([hidden])').waitFor();
  assert.equal(await page.locator('#scannerReceiptCode').innerText(),'SKU-TEST-01');
  assert.deepEqual(await page.evaluate(()=>window.received),['SKU-TEST-01']);
  await mkdir('/tmp/vantis-receiving-qa',{recursive:true});
  await page.screenshot({path:'/tmp/vantis-receiving-qa/scanner-mobile.png'});
  await page.setViewportSize({width:1280,height:800});
  assert.equal(await page.locator('#scanner.scanner-pro').isVisible(),true);
  await page.screenshot({path:'/tmp/vantis-receiving-qa/scanner-desktop.png'});
  await page.evaluate(()=>window.closeScannerForTest());
  assert.equal(await page.locator('#scanner').count(),0);
  assert.deepEqual(errors,[],'browser must not throw an uncaught exception');
  console.log('PASS: camera UI fits mobile/desktop, laser disabled, scan feedback works, close restores page.');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
