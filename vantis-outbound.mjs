import {wireReceivingInput} from './receiving-input.mjs?v=5.12.3';
const clean=x=>String(x||'').trim().toUpperCase();
const isLabel=x=>/^(?:ZAP-)?(402|405|459)-[0-9]{3,4}$/.test(x);
const isSku=x=>/^[0-9]{6,20}$/.test(x);
const id=()=>crypto.randomUUID();
export function mountOutbound(root,api,{employee,startScanner,stopScanner,onConfirmed=()=>{}}){
 let camera=false,opening=false,busy=false,alive=true,location='',session=id(),queue=[],count=0,error='';
 const key='vantis.team.outbound.v1/'+employee;
 try{const s=JSON.parse(localStorage.getItem(key)||'null');if(s?.version===1){location=s.location||'';session=s.session;queue=s.queue||[];count=s.count||0;for(const r of queue)if(r.status==='sending')r.status='uncertain';}}catch{error='No se pudo recuperar el respaldo local.'}
 const save=()=>{try{localStorage.setItem(key,JSON.stringify({version:1,location,session,queue,count}));return true}catch{error='Almacenamiento no disponible: no escanees más hasta corregirlo.';return false}};
 root.innerHTML='<section class="team-outbound"><div class="out-head"><b>VANTIS · Salida de bodega</b><button type="button" id="outFinish">Terminar</button></div><p>Marbete de origen</p><strong id="outLocation">Sin marbete</strong><p>Escanea marbete → SKU/UPC → SKU/UPC. Otro marbete cambia la ubicación automáticamente.</p><div class="out-count"><div><b id="outCount">0</b><small>Salidas confirmadas</small></div><div><b id="outPending">0</b><small>Por confirmar</small></div></div><form id="outForm" autocomplete="off"><label class="sr-only" for="outScan">Escanear marbete o SKU de salida</label><input id="outScan" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Escanea un marbete o SKU/UPC"></form><div class="out-buttons"><button id="outCamera" type="button">Cámara</button><button id="outRetry" type="button">Reintentar pendientes</button></div><p id="outFeedback" role="status" aria-live="polite">Listo para escanear</p><p id="outError" role="alert" hidden></p><h3>Últimas salidas</h3><div id="outRows"></div></section>';
 const $=x=>root.querySelector('#'+x);
 const pending=()=>queue.filter(r=>['queued','sending','uncertain'].includes(r.status));
 const render=()=>{
  if(!alive)return;
  $('outLocation').textContent=location||'Escanea primero un marbete';
  $('outCount').textContent=count.toLocaleString('es-MX');
  $('outPending').textContent=pending().length.toLocaleString('es-MX');
  $('outCamera').textContent=camera?'Cerrar cámara':opening?'Abriendo…':'Cámara';
  $('outCamera').disabled=opening;
  $('outRetry').disabled=busy||!pending().length;
  $('outError').hidden=!error;$('outError').textContent=error;
  $('outRows').replaceChildren();
  for(const r of queue.slice(-12).reverse()){
   const line=document.createElement('div');line.className='out-row';
   const name=document.createElement('span');name.textContent=r.sku+' · '+r.location;
   const state=document.createElement('b');state.textContent=r.status==='confirmed'?'✓ −1':r.status==='rejected'?'Rechazado':'Pendiente';state.dataset.status=r.status;
   line.append(name,state);$('outRows').append(line);
  }
 };
 const say=(msg)=>{$('outFeedback').textContent=msg;render()};
 const scan=raw=>{
  const code=clean(raw);
  if(isLabel(code)){location='ZAP-'+code.replace(/^ZAP-/,'');if(!save())throw Error(error);say('✓ Marbete activo: '+location);return location}
  if(!isSku(code))throw Error('Código inválido. Escanea un marbete o SKU/UPC numérico.');
  if(!location)throw Error('Escanea primero el marbete de origen.');
  if(error.startsWith('Almacenamiento')||error.startsWith('No se pudo recuperar'))throw Error(error);
  const row={id:id(),sku:code,location,status:'queued'};
  queue.push(row);if(!save()){queue.pop();throw Error(error)}
  say('Lectura '+code+' · esperando confirmación del servidor');void flush();return 'Salida en proceso';
 };
 const input=wireReceivingInput({input:$('outScan'),active:()=>alive,onCode:scan,onError:e=>say('✕ '+e.message)});
 async function flush(){
  if(!alive||busy||navigator.onLine===false)return;
  busy=true;render();
  try{for(const row of queue){
   if(!alive||navigator.onLine===false)break;
   if(!['queued','uncertain'].includes(row.status))continue;
   row.status='sending';if(!save()){row.status='uncertain';break}
   try{
    const r=await api.request('/api/outbound',{method:'POST',body:{p_id:row.id,p_sesion:session,p_departamento:'ZAPATERIA INFANTIL',p_producto:row.sku,p_marbete:row.location}});
    if(r.id!==row.id||r.kind!=='dispatch')throw Error('Respuesta no verificable');
    row.status='confirmed';count++;error='';say('✓ SALIDA CONFIRMADA · −1 pieza · '+row.sku+' · '+row.location);onConfirmed(row);
   }catch(e){
    if([400,403,404,409,422].includes(Number(e.status))){row.status='rejected';say('✕ NO SE DESCONTÓ · '+row.sku+' · '+e.message)}
    else{row.status='uncertain';error='Conexión sin confirmar. Reintenta con el mismo folio para evitar descuentos duplicados.';say('Pendiente de verificar · '+row.sku);break}
   }finally{save();render()}
  }}finally{busy=false;render()}
 }
 $('outForm').onsubmit=e=>{e.preventDefault();input.flush('manual')};
 $('outRetry').onclick=()=>{error='';void flush()};
 $('outCamera').onclick=async()=>{
  if(camera){stopScanner();return}
  if(opening)return;opening=true;render();
  try{await startScanner(code=>scan(code),'marbete o SKU de salida',{continuous:true,qrEnabled:true,acknowledgedOnly:true,allowRepeat:false,onClose:()=>{camera=false;opening=false;render();input.focus()}});camera=true}
  catch{say('No se pudo abrir la cámara. Revisa los permisos.')}finally{opening=false;render()}
 };
 $('outFinish').onclick=()=>{
  if(pending().length){say('Hay salidas pendientes. Reintenta antes de terminar.');return}
  stopScanner();location='';session=id();queue=[];count=0;save();say('Salida finalizada. Escanea un marbete para empezar.');input.focus();
 };
 const online=()=>void flush();
 const visible=()=>{if(document.visibilityState==='visible'){void flush();input.focus()}};
 const beforeUnload=e=>{if(pending().length){e.preventDefault();e.returnValue=''}};
 window.addEventListener('online',online);window.addEventListener('beforeunload',beforeUnload);document.addEventListener('visibilitychange',visible);
 render();if(pending().length)void flush();
 return ()=>{alive=false;stopScanner();input.destroy();window.removeEventListener('online',online);window.removeEventListener('beforeunload',beforeUnload);document.removeEventListener('visibilitychange',visible)};
}
