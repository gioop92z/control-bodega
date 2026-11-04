// Isolated visual boot test. No authentication calls, stock writes or remote requests.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const files=new Set(['vantis-command.css','vantis-experience.js']);
const pageHtml=String.raw`<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="stylesheet" href="/vantis-command.css"></head><body>
<div id="app"><div class="app-shell"><main class="content"><h1>Operación VANTIS</h1></main></div></div>
<script>sessionStorage.setItem('vantis.session.ready','1')</script>
<script defer src="/vantis-experience.js"></script></body></html>`;
const server=createServer(async(req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname.slice(1);
  if(!file){res.writeHead(200,{'Content-Type':'text/html'});res.end(pageHtml);return;}
  if(!files.has(file)){res.writeHead(404);res.end();return;}
  try{res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':'text/css'});res.end(await readFile(new URL('../'+file,import.meta.url)));}
  catch{res.writeHead(500);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port+'/';
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:2,reducedMotion:'no-preference'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  await page.locator('.vc-intro').waitFor({state:'visible'});
  assert.equal(await page.locator('.vc-intro').getAttribute('aria-hidden'),'true');
  assert.equal(await page.locator('.vc-intro').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
  assert.equal(await page.locator('.vc-intro-word').innerText(),'VANTIS');
  await page.locator('.vc-intro').waitFor({state:'detached',timeout:4000});
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('vantis.intro.seen.5.9')),'1');
  await page.reload();
  assert.equal(await page.locator('.vc-intro').count(),0,'boot should not replay on every app rerender');
  assert.deepEqual(errors,[]);
  await context.close();
  const accessible=await browser.newContext({reducedMotion:'reduce'});
  const pageReduced=await accessible.newPage();
  await pageReduced.goto(base);
  await pageReduced.waitForFunction(()=>sessionStorage.getItem('vantis.intro.seen.5.9')==='1');
  assert.equal(await pageReduced.locator('.vc-intro').count(),0,'prefers-reduced-motion skips intro');
  await accessible.close();
  console.log('PASS: original intro, once-per-session, nonblocking, reduced-motion mobile.');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
