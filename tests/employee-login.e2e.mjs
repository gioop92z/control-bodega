// VANTIS login smoke test using the real browser UI and an isolated fake backend.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';

const directory=resolve(new URL('..',import.meta.url).pathname);
const bootstrap=[
  "window.__testSb={",
  " auth:{",
  "  async getUser(){const active=sessionStorage.getItem('__testSeller')==='1';return {data:{user:active?{id:'test-seller',email:'10@bodega.local'}:null},error:null};},",
  "  async signOut(){sessionStorage.removeItem('__testSeller');return {error:null};},",
  "  async signInWithPassword(data){",
  "   if(data.email!=='10@bodega.local'||!data.password)return {error:{message:'Credentials unavailable'}};",
  "   sessionStorage.setItem('__testSeller','1');",
  "   return {data:{user:{id:'test-seller',email:'10@bodega.local'}},error:null};",
  "  }",
  " },",
  " from(table){return {",
  "  select(){return this;},eq(){return this;},gt(){return this;},order(){return this;},",
  "  then(resolve,reject){",
  "   const data=table==='departamentos'?[{id:'dept1',nombre:'Zapateria test',activo:true,created_at:'2026-10-19T00:00:00Z'}]:[];",
  "   return Promise.resolve({data,error:null,count:0}).then(resolve,reject);",
  "  }",
  " };},",
  " rpc(){return Promise.resolve({data:{entradas:0,salidas:0,movimientos:0,unidades:0},error:null});}",
  "};",
  "await import('./app.js?v=5.10.1');",
  "await Promise.all([",
  " 'nova-enhancements.js?v=5.10.1',",
  " 'vantis-enterprise.js?v=5.9.0',",
  " 'liverpool-branding.js?v=1.1.1',",
  " 'vantis-session-gate.js?v=5.10.0'",
  "].map(path=>import('./'+path)));"
].join('\n');

const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const file=resolve(directory,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(directory+sep))throw Error('Unsafe path');
    let data=await readFile(file);
    if(file.endsWith('index.html')){
      const html=data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
      data=Buffer.from(html.replace('</body>','<script type="module">'+bootstrap+'</script></body>'));
    }
    const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});
    res.end(data);
  }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  await page.route('https://esm.sh/**',route=>{
    if(route.request().url().includes('@supabase/supabase-js'))
      return route.fulfill({contentType:'text/javascript',body:'export const createClient=()=>window.__testSb;'});
    if(route.request().url().includes('xlsx'))
      return route.fulfill({contentType:'text/javascript',body:'export const utils={};export const read=()=>({});export const writeFile=()=>{};'});
    return route.abort();
  });
  await page.route('https://*.supabase.co/**',route=>route.abort());
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'networkidle'});
  await page.locator('#clave').waitFor();
  assert.equal(await page.locator('#loginForm input').count(),1);
  assert.equal(await page.locator('#pin').count(),0);
  assert.equal(await page.getByText('PIN de administrador').count(),0);
  await mkdir('/tmp/vantis-receiving-qa',{recursive:true});
  await page.screenshot({path:'/tmp/vantis-receiving-qa/login-employee-only.png'});
  await page.locator('#clave').fill('16647310');
  await page.locator('#loginForm button[type="submit"]').click();
  await page.locator('.app-shell').waitFor({timeout:12000});
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('nova.employeeNumber')),'16647310');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('__testSeller')),'1');
  assert.equal(await page.locator('.access-label[data-access-role="admin"]').count(),0);
  const department=page.locator('[data-vantis-dept]');
  if(await department.count())await department.first().click();
  await page.locator('[data-act="ENTRADA"]').waitFor({state:'visible',timeout:10000});
  await page.screenshot({path:'/tmp/vantis-receiving-qa/home-after-employee-login.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: number-only iPhone login, seller-only role and operational home.');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
