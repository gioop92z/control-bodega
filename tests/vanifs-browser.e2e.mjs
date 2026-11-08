import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import zxing from '@zxing/library';
import ExcelJS from 'exceljs';
import { createDatabase, people, sku } from './helpers/vanifs-db.mjs';

const qa = await createDatabase('');
const root = process.cwd();
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server = createServer(async (request,response) => {
  const path = new URL(request.url,'http://localhost').pathname;
  const relative = path.slice(1) + (path.endsWith('/')?'index.html':'');
  const file = resolve(root,relative);
  try {
    if (!file.startsWith(root+'/')) throw new Error('invalid route');
    response.writeHead(200,{'content-type':mime[extname(file)] ?? 'application/octet-stream'});
    response.end(await readFile(file));
  } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const project='dkqovohxkxlcccvagpij';
const domain=project+'.supabase.co';
const clients=[];
let browser;
const browserErrors=[];
const sockets=new Set();
const contextStatus=new Map();
let dropped=0;
const captureTrace=[];
let dropNextPiece=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function notify(id,event) {
  for(const listener of sockets) {
    for(const binding of listener.channels.values()) {
      if(!binding.enabled || (binding.filter && binding.filter!=='journey_id=eq.'+id) ||
        (binding.event!=='*' && binding.event!==event)) continue;
      listener.ws.send(JSON.stringify({topic:binding.topic,event:'postgres_changes',ref:null,
        payload:{ids:[1],data:{schema:'public',table:'vanifs_revisions',type:event,commit_timestamp:new Date().toISOString(),
          columns:[{name:'journey_id',type:'uuid'},{name:'stamp',type:'int8'}],record:{journey_id:id,stamp:1},old_record:{journey_id:id,stamp:0}}}}));
    }
  }
}

const encoder=new zxing.QRCodeWriter();
const qr=code=>{
  if (!code) return null;
  const matrix=encoder.encode(code,zxing.BarcodeFormat.QR_CODE,240,240,null);
  return {size:matrix.getWidth(),bits:Array.from({length:matrix.getHeight()},(_,y)=>
    Array.from({length:matrix.getWidth()},(_,x)=>matrix.get(x,y)?1:0))};
};

async function addAccount(i, mobile=true) {
  const context=await browser.newContext({viewport:{width:mobile?390:1220,height:mobile?844:850},isMobile:mobile,hasTouch:mobile,acceptDownloads:true});
  clients.push(context);
  const user={id:people[i],email:'pruebas'+i+'@gmail.com',aud:'authenticated',role:'authenticated',
    user_metadata:{},app_metadata:{},email_confirmed_at:'2026-01-01T00:00:00Z',created_at:'2026-01-01T00:00:00Z'};
  const segment=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const expires=Math.floor(Date.now()/1000)+3600;
  const token=segment({alg:'HS256',typ:'JWT'})+'.'+segment({sub:user.id,exp:expires,role:'authenticated'})+'.fixture';
  const session={access_token:token,refresh_token:'qa-test-'+i,expires_at:expires,expires_in:3600,token_type:'bearer',user};
  await context.addInitScript(({key,session})=>{
    if (!localStorage.getItem(key)) localStorage.setItem(key,JSON.stringify(session));
    if (!navigator.mediaDevices) return;
    navigator.mediaDevices.getUserMedia=async()=>{
      const canvas=document.createElement('canvas');
      canvas.width=640; canvas.height=480;
      const surface=canvas.getContext('2d');
      let input=null;
      window.renderFixtureQr=frame=>{
        input=frame;
        surface.fillStyle='white'; surface.fillRect(0,0,640,480);
        if(input) {
          surface.fillStyle='black';
          for(let y=0;y<input.size;y++) {
            let x=0;
            while(x<input.size) {
              if(!input.bits[y][x]) { x++; continue; }
              const first=x++;
              while(x<input.size && input.bits[y][x]) x++;
              surface.fillRect(200+first,120+y,x-first,1);
            }
          }
        }
      };
      window.renderFixtureQr(null);
      const stream=canvas.captureStream(20);
      const track=stream.getVideoTracks()[0];
      const timer=setInterval(()=>{
        if(track.readyState==='ended') { clearInterval(timer); return; }
        surface.fillStyle='white'; surface.fillRect(0,0,1,1);
      },45);
      return stream;
    };
  },{key:'sb-'+project+'-auth-token',session});
  await context.routeWebSocket('wss://'+domain+'/**',ws=>{
    const channels=new Map();
    const listener={ws,channels};
    sockets.add(listener);
    ws.onClose(()=>sockets.delete(listener));
    ws.onMessage(raw=>{
      const msg=JSON.parse(raw);
      if(msg.event==='phx_join') {
        const rule=msg.payload.config.postgres_changes[0];
        if(rule) channels.set(msg.topic,{topic:msg.topic,enabled:true,event:rule.event,filter:rule.filter});
        ws.send(JSON.stringify({topic:msg.topic,event:'phx_reply',ref:msg.ref,
          payload:{status:'ok',response:{postgres_changes:rule?[{...rule,id:1}]:[]}}}));
      } else if(msg.event==='heartbeat'||msg.event==='phx_leave') {
        if(msg.event==='phx_leave') channels.delete(msg.topic);
        ws.send(JSON.stringify({topic:msg.topic,event:'phx_reply',ref:msg.ref,payload:{status:'ok',response:{}}}));
      }
    });
  });
  await context.route('https://'+domain+'/**',async route=>{
    const request=route.request();
    const path=new URL(request.url()).pathname;
    const cors={'access-control-allow-origin':origin,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'};
    const reply=(json,status=200)=>route.fulfill({status,headers:cors,json});
    if(request.method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
    if(request.headers().authorization !== 'Bearer '+token) return reply({message:'Fixture refused unauthorized request.'},401);
    if(path==='/auth/v1/user') return reply(user);
    if(path==='/rest/v1/departamentos') return reply([]);
    if(path!=='/rest/v1/rpc/vanifs_api') return reply({message:'Unknown QA endpoint '+path},404);
    const {p_route,p_action,p_data}=request.postDataJSON();
    try {
      const result=await qa.rpc(i,p_route,p_action,p_data);
      if(i===1 && p_action==='append') captureTrace.push(p_data.ops.map(op=>[op.kind,op.code,op.box,op.captureDevice]));
      if(p_action==='create') notify(result.receipt.id,'INSERT');
      if(['append','pause','close','reopen','remove','assign'].includes(p_action)) notify(p_data.id,'UPDATE');
      if(i===1 && p_action==='append' && dropNextPiece && p_data.ops.some(op=>op.kind==='piece')) {
        dropNextPiece=false; dropped++;
        return route.abort('failed');
      }
      return reply(result);
    } catch(error) {
      if(i===1 && p_action==='append') captureTrace.push([error.message, p_data.ops.map(op=>[op.kind,op.code,op.box,op.captureDevice])]);
      const status=error.code?.startsWith('PT')?Number(error.code.slice(2)):error.code==='42501'?403:400;
      return reply({code:error.code,message:error.message,details:null,hint:null},status);
    }
  });
  const page=await context.newPage();
  page.on('pageerror',error=>browserErrors.push(error.message));
  contextStatus.set(page,context);
  return page;
}
const boxFor=i=>'QA-CAJA-'+i;
const pageReady=page=>page.getByRole('heading',{name:'Manifiesto activo de hoy'}).waitFor();
const globalCount=async id=>(await qa.rpc(0,'receipt','detail',{id,after:0})).live.totals.scanned;
async function waitCount(id,n) {
  const until=Date.now()+6000;
  while(Date.now()<until) { if(await globalCount(id)===n) return; await sleep(50); }
  assert.equal(await globalCount(id),n);
}
const scanInput=page=>page.getByRole('textbox',{name:'Código de contenedor, SKU o UPC'});
async function hid(page,code) {
  const field=scanInput(page);
  await field.focus();
  await page.keyboard.type(code,{delay:2});
  await field.waitFor();
  await page.waitForFunction(()=>document.querySelector('input[aria-label="Código de contenedor, SKU o UPC"]')?.value==='');
}

try {
  browser=await chromium.launch({args:['--no-sandbox']});
  const manager=await addAccount(5,false);
  await manager.goto(origin+'/vanifs/?modulo=inicio');
  await manager.getByRole('button',{name:'VANIFS · Recepción'}).click();
  await pageReady(manager);
  const team=await Promise.all([1,2,3,4].map(i=>addAccount(i)));
  await Promise.all(team.map(async page=>{await page.goto(origin+'/vanifs/?modulo=recepcion'); await pageReady(page);}));
  await manager.getByRole('button',{name:'Nuevo manifiesto'}).first().click();
  const csv=['PISO,FECHA,SECC,MANIFIESTO,CONTENEDOR,DESCRIPCION,SKU,CANT,PRECIO,PROVEEDOR,UPC,MARCA',
    ...[1,2,3,4].flatMap(i=>[`1,,402,QA,${boxFor(i)},Producto A,${sku},6,,,,`,
      `1,,402,QA,${boxFor(i)},Producto B,000750002,3,,,,`])].join('\n');
  await manager.getByLabel('Archivo del manifiesto').setInputFiles({name:'manifiesto-qa.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await manager.getByLabel('Nombre de la jornada').fill('Jornada colaborativa QA');
  await manager.getByRole('button',{name:'Crear jornada'}).click();
  await manager.getByRole('heading',{name:'Estación de escaneo'}).waitFor();
  const {receipts:[created]}=await qa.rpc(0,'receipt','today');
  assert.equal(created.expected,36);
  const id=created.id;
  await Promise.all(team.map(page=>page.getByRole('button',{name:'Unirme a la recepción'}).click({timeout:7000})));
  await Promise.all(team.map((page,i)=>hid(page,boxFor(i+1))));
  await Promise.all(team.map(page=>hid(page,sku)));
  await waitCount(id,4);
  await manager.bringToFront();
  await manager.getByRole('button',{name:'En vivo',exact:true}).first().click();
  await manager.getByRole('heading',{name:'Productividad del equipo'}).waitFor();
  await manager.locator('.team-roster').first().getByText('Operador 1',{exact:true}).waitFor({timeout:6500});
  console.log('Cuatro sesiones de navegador: manifiesto único, contenedores separados, HID sin Enter y avance compartido.');

  const cameraPage=team[0];
  const context=contextStatus.get(cameraPage);
  await cameraPage.bringToFront();
  await cameraPage.evaluate(()=>navigator.serviceWorker.ready);
  await cameraPage.getByRole('button',{name:'Abrir cámara'}).click();
  await cameraPage.getByText('Listo para escanear · centra el código.').waitFor();
  await cameraPage.evaluate(frame=>window.renderFixtureQr(frame),qr(sku));
  const green=cameraPage.locator('.camera-acknowledgments li').filter({hasText:sku});
  await green.waitFor({timeout:8000});
  const firstGreen=performance.now();
  await cameraPage.evaluate(frame=>window.renderFixtureQr(frame),qr('000750002'));
  await cameraPage.locator('.camera-acknowledgments li').filter({hasText:'000750002'}).waitFor({timeout:5500});
  await green.waitFor({state:'hidden',timeout:3000});
  const display=performance.now()-firstGreen;
  assert.ok(display>=550 && display<=1550,'Green confirmation must be visible for about one second: '+display);
  await waitCount(id,6);
  await sleep(1450);
  assert.equal(await globalCount(id),6,'Stationary QR was not counted again');
  console.log('Cámara simulada con QR real: indicador verde '+Math.round(display)+' ms, dos códigos durante confirmación, sin duplicar etiqueta inmóvil.');

  await context.setOffline(true);
  await cameraPage.evaluate(frame=>window.renderFixtureQr(frame),qr(sku));
  await cameraPage.locator('.camera-status').getByText('PENDIENTE DE SINCRONIZAR',{exact:false}).waitFor({timeout:6000});
  assert.equal(await cameraPage.locator('.camera-acknowledgments li').count(),0);
  assert.equal(await globalCount(id),6);
  await cameraPage.reload({waitUntil:'domcontentloaded'});
  await cameraPage.getByText('Conserva esta sesión y los datos del navegador',{exact:false}).waitFor();
  await context.setOffline(false);
  await waitCount(id,7);
  await cameraPage.getByRole('button',{name:'Escanear',exact:true}).last().click();
  dropNextPiece=true;
  await hid(cameraPage,sku);
  try { await waitCount(id,8); } catch(error) {
    console.log(await cameraPage.locator('main').innerText());
    console.log(captureTrace, browserErrors.slice(0,6));
    throw error;
  }
  await cameraPage.locator('.recent-panel').getByText('Lecturas registradas').waitFor({timeout:12000});
  assert.equal(dropped,1);
  assert.equal(await globalCount(id),8);
  console.log('Modo sin red: IndexedDB conserva la lectura tras recarga. Reconexión y respuesta perdida recuperadas sin duplicados.');

  const snapshot=await qa.rpc(0,'receipt','detail',{id,after:0});
  assert.deepEqual(snapshot.live.people.map(person=>person.pieces).sort(),[1,1,1,5]);
  assert.equal(snapshot.live.totals.matched,8,JSON.stringify(snapshot.batches.flatMap(batch=>batch.ops).filter(op=>op.kind==="piece").map(op=>[op.actor.name,op.source,op.code,op.box,op.scanResult])));
  await manager.bringToFront();
  await manager.getByRole('button',{name:'Pausar',exact:true}).click();
  await manager.getByRole('button',{name:'Reanudar',exact:true}).waitFor();
  for (const [index,page] of team.entries()) {
    const device=await page.evaluate(()=>localStorage.getItem('vanifs:device'));
    await qa.rpc(index+1,'team','pulse',{id,device:{id:device,label:'iPhone QA'},pending:0,box:boxFor(index+1)});
  }
  await manager.getByRole('button',{name:'Cerrar jornada',exact:true}).click();
  await manager.getByRole('checkbox',{name:'Revisé el resumen y autorizo el cierre con incidencias.'}).check();
  await manager.getByLabel('Observaciones de cierre').fill('Diferencias de prueba registradas y revisadas.');
  await manager.getByRole('button',{name:'Confirmar cierre'}).click();
  const closure=manager.getByRole('dialog',{name:/Jornada finalizada/});
  await closure.waitFor();
  await closure.getByRole('button',{name:/Generar/}).click();
  const download=manager.waitForEvent('download');
  await closure.getByRole('link',{name:'Descargar Excel'}).click();
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await (await download).path());
  for(const tab of ['JORNADA','MANIFIESTO VALIDADO','ESCANEOS','INCIDENCIAS','PRODUCTIVIDAD','AUDITORÍA']) assert.ok(workbook.getWorksheet(tab),tab);
  assert.equal(workbook.getWorksheet('JORNADA').getCell('B11').value,8);
  assert.equal(workbook.getWorksheet('MANIFIESTO VALIDADO').rowCount,9);
  console.log('Cierre supervisado y Excel descargado y verificado.');
  assert.deepEqual(browserErrors,[]);
} finally {
  await Promise.all(clients.map(context=>context.close()));
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  await qa.end();
}
