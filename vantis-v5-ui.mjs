import {telemetrySnapshot} from './vantis-telemetry-v5.mjs';
import {InventoryJournalMirror} from './vantis-offline-idb-v5.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const number=v=>Number(v||0).toLocaleString('es-MX');
const fail=r=>{if(r?.error)throw r.error;return r?.data;};
const error=e=>String(e?.message||e||'No disponible');
const uuid=()=>crypto.randomUUID();
const stamp=iso=>iso?new Date(iso).toLocaleString('es-MX'):'—';
const types={DANIO:'Mercancía dañada',PERDIDA:'Mercancía no localizada',DIFERENCIA:'Diferencia detectada',
 DEVOLUCION:'Devolución',CODIGO_ILEGIBLE:'Código ilegible',UBICACION:'Ubicación inconsistente',EVIDENCIA:'Evidencia pendiente'};
export function mountVantisV5(root,{sb,deptId,admin=false,actor='',userId='',mode='diagnostics',
 getReceiveStatus=()=>({}),startScanner=null,stopScanner=()=>{}}){
 let disposed=false,clock=null,requestId=0,working=false;
 const $=id=>root.querySelector('#'+id);
 const now=()=>++requestId;
 const active=id=>!disposed&&root.isConnected&&id===requestId;
 function banner(value,tone='info'){const n=$('v5Notice');if(n){n.textContent=value;n.dataset.tone=tone;n.hidden=false;}}
 function wrap(title,description,content){
  root.innerHTML='<section class="op-panel v5-panel"><div class="v5-header"><small>VANTIS · OPERACIONES 5</small><h2>'+title+'</h2><p>'+description+'</p></div><div id="v5Notice" class="v5-notice" role="status" hidden></div>'+content+'</section>';
 }
 async function diagnostics(){
  wrap('Rendimiento y diagnóstico','Métricas de captura y respuesta; una lectura detectada no equivale a stock confirmado.',
   '<div id="v5Metrics" class="op-kpis"></div><div class="v5-bars"><div><span>Conexión</span><strong id="v5Connection">—</strong></div><div><span>Recepción</span><strong id="v5Backend">—</strong></div><div><span>Respaldo IndexedDB</span><strong id="v5Mirror">—</strong></div></div><p class="op-fine">La latencia representa respuestas de las operaciones de recepción medidas en este dispositivo. No es una prueba de velocidad de tu proveedor de internet.</p><button class="secondary" id="v5Refresh">Actualizar diagnóstico</button>');
  const scope=[userId,deptId,encodeURIComponent(actor)].join('/');
  const mirror=new InventoryJournalMirror('vantis.continuous.v1/'+scope);
  async function paint(){
   if(disposed)return;
   const x=telemetrySnapshot(),s=getReceiveStatus(),online=navigator.onLine!==false;
   $('v5Metrics').innerHTML=[
    ['Escaneos/minuto',number(x.perMinute)],['Servidor promedio',x.latencyMs===null?'Sin muestras':x.latencyMs+' ms'],
    ['Servidor P95',x.p95Ms===null?'Sin muestras':x.p95Ms+' ms'],['Respuestas fallidas',number(x.errors)],
    ['Pendientes en sesión',number(s.pending||0)],['Confirmados en sesión',number(s.confirmed||0)]
   ].map(([a,b])=>'<div class="op-kpi"><span>'+a+'</span><strong>'+b+'</strong></div>').join('');
   $('v5Connection').textContent=online?'Red disponible (no confirma servidor)':'Sin conexión de red';
   $('v5Connection').dataset.tone=online?'ok':'warn';
   $('v5Backend').textContent=s.backend||'Recepción no abierta';
   $('v5Backend').dataset.tone=s.backend==='ready'?'ok':'warn';
   const backup=await mirror.status();if(disposed)return;
   $('v5Mirror').textContent=backup.available?(s.mirrorError?'Aviso: '+s.mirrorError:'Disponible como respaldo'):'No disponible en este dispositivo';
   $('v5Mirror').dataset.tone=backup.available&&!s.mirrorError?'ok':'warn';
  }
  $('v5Refresh').onclick=()=>void paint();
  clock=setInterval(()=>void paint(),3000);await paint();
 }
 async function cycles(){
  const id=now();
  wrap('Conteo cíclico inteligente','Conteos por sección y gafete; solo el administrador aprueba. Nunca se modifica stock desde este panel.',
   (admin?'<form id="v5Create" class="op-stack v5-form"><label>Nombre del conteo<input name="nombre" required minlength="3" maxlength="120" placeholder="Revisión sección 402"></label><label>Marbete de la sección<input name="marbete" required maxlength="120" placeholder="ZAP-402-001"></label><label>Asignar al gafete<input name="gafete" required maxlength="30" placeholder="Número de empleado"></label><button class="primary">Asignar conteo</button></form>':'<p class="v5-hint">Solo aparecen tus conteos asignados por gafete. La cuenta individual de cada empleado sigue siendo recomendable para auditoría.</p>')+
   '<div id="v5Cycles">Consultando conteos…</div><div id="v5CycleDetails"></div>');
  if(admin)$('v5Create').onsubmit=async ev=>{
   ev.preventDefault();if(working)return;working=true;
   const fd=new FormData(ev.currentTarget),button=ev.currentTarget.querySelector('button');button.disabled=true;
   try{
    const payload={p_departamento:deptId,p_nombre:String(fd.get('nombre')).trim(),
     p_marbete:String(fd.get('marbete')).trim(),p_gafete:String(fd.get('gafete')).trim()};
    fail(await sb.rpc('vantis_ciclo_crear_v5',payload));
    ev.currentTarget.reset();banner('Conteo asignado en el servidor.','success');void cycles();
   }catch(e){banner('No se pudo asignar: '+error(e),'error');}
   finally{working=false;button.disabled=false;}
  };
  try{
   const q=await sb.from('vantis_ciclos_v5').select('id,nombre,marbete_codigo,asignado_gafete,estado,created_at,aprobado_en')
    .eq('departamento_id',deptId).order('created_at',{ascending:false}).limit(80);
   const rows=fail(q)||[];
   if(!active(id))return;
   const visible=admin?rows:rows.filter(r=>String(r.asignado_gafete)===String(actor).replace(/\D/g,'')||String(actor).includes(r.asignado_gafete));
   $('v5Cycles').innerHTML=visible.length?'<h3>Conteos asignados</h3>'+visible.map(c=>
    '<button type="button" class="v5-cycle" data-id="'+esc(c.id)+'"><b>'+esc(c.nombre)+'</b><small>'+esc(c.marbete_codigo)+' · Gafete '+esc(c.asignado_gafete)+'</small><span class="v5-state">'+esc(c.estado)+'</span></button>').join(''):'<p class="v5-empty">No hay conteos asignados.</p>';
   $('v5Cycles').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>void showCycle(rows.find(x=>x.id===b.dataset.id)));
  }catch(e){if(active(id))$('v5Cycles').innerHTML='<p class="op-error">Conteos no disponibles: '+esc(error(e))+'</p>';}
 }
 async function showCycle(c){
  const slot=$('v5CycleDetails');if(!slot||!c)return;
  const id=now();slot.innerHTML='<p>Consultando sección…</p>';
  try{
   const [counted,expected]=await Promise.all([
    sb.from('vantis_ciclo_lineas_v5').select('sku,esperado,contado,updated_at').eq('ciclo_id',c.id).limit(1000),
    sb.from('producto_marbetes').select('sku,cantidad').eq('marbete_codigo',c.marbete_codigo).limit(1000)
   ]);
   const rows=fail(counted)||[],reference=fail(expected)||[];
   if(!active(id)||!$('v5CycleDetails'))return;
   const map=new Map(rows.map(r=>[r.sku,r]));const missing=reference.filter(r=>!map.has(r.sku));
   const diffs=rows.filter(r=>r.esperado!==null&&Number(r.esperado)!==Number(r.contado));
   slot.innerHTML='<section class="v5-detail"><h3>'+esc(c.nombre)+'</h3><p>'+esc(c.marbete_codigo)+' · '+esc(c.estado)+'</p>'+
    '<div class="v5-badges"><span>'+number(rows.length)+' SKU revisados</span><span>'+number(diffs.length)+' diferencias</span><span>'+number(missing.length)+' sin revisar</span></div>'+
    (c.estado==='ABIERTO'?'<form id="v5AddCount" class="op-form"><input name="codigo" maxlength="120" required placeholder="Escanea o escribe SKU / UPC" aria-label="SKU o UPC"><input name="cantidad" type="number" min="0" max="1000000" required value="1" aria-label="Cantidad física"><button class="primary">Guardar conteo</button></form>'+(startScanner?'<button id="v5CountCamera" class="secondary" type="button">Escanear una pieza con cámara</button>':'')+'<button id="v5Present" type="button" class="secondary">Enviar a revisión</button>':'')+
    (admin&&c.estado==='EN_REVISION'?'<button id="v5Approve" type="button" class="primary">Aprobar revisión (sin ajustar stock)</button>':'')+
    '<div class="v5-table">'+rows.map(r=>'<div class="v5-line"><b>'+esc(r.sku)+'</b><span>Esperado '+(r.esperado===null?'sin base':number(r.esperado))+' · Contado '+number(r.contado)+'</span><strong class="'+(r.esperado===null?'':Number(r.esperado)===Number(r.contado)?'v5-ok':'v5-alert')+'">'+(r.esperado===null?'Revisar':Number(r.esperado)===Number(r.contado)?'Coincide':'Diferencia')+'</strong></div>').join('')+
    (missing.length?'<p class="v5-hint">Sin contar en esta sección: '+missing.slice(0,12).map(r=>esc(r.sku)).join(', ')+(missing.length>12?'…':'')+'</p>':'')+'</div></section>';
   async function findSku(raw){
    const code=String(raw||'').trim();if(!code||code.length>120)throw Error('Código inválido');
    let r=await sb.from('productos').select('sku').eq('departamento_id',deptId).eq('sku',code).limit(1);
    let product=fail(r)?.[0];
    if(!product){r=await sb.from('productos').select('sku').eq('departamento_id',deptId).eq('upc',code).limit(2);
      const matches=fail(r)||[];if(matches.length>1)throw Error('UPC ambiguo. Escanea el SKU específico.');product=matches[0];}
    if(!product)throw Error('Código no encontrado en este catálogo. No se creó stock.');
    return product.sku;
   }
   async function save(code,qty){
    if(working)return;working=true;
    try{
     const sku=await findSku(code);
     fail(await sb.rpc('vantis_ciclo_registrar_v5',{p_ciclo:c.id,p_sku:sku,p_cantidad:qty}));
     banner('Conteo guardado en Supabase (sin ajustar existencias).','success');await showCycle(c);
    }catch(e){banner('No se pudo guardar: '+error(e),'error');}
    finally{working=false;}
   }
   if($('v5AddCount'))$('v5AddCount').onsubmit=event=>{event.preventDefault();const data=new FormData(event.currentTarget);void save(data.get('codigo'),Number(data.get('cantidad')));};
   if($('v5CountCamera'))$('v5CountCamera').onclick=()=>void startScanner(async code=>{
    try{const sku=await findSku(code),previous=map.get(sku);await save(sku,Number(previous?.contado||0)+1);}
    catch(e){banner(error(e),'error');}
   },'SKU para conteo',{qrEnabled:true}).catch(e=>banner('No se pudo abrir cámara: '+error(e),'error'));
   if($('v5Present'))$('v5Present').onclick=async()=>{
    if(missing.length&&!confirm('Hay '+missing.length+' SKU de esta sección sin contar. ¿Entregar conteo parcial para revisión?'))return;
    try{fail(await sb.rpc('vantis_ciclo_presentar_v5',{p_ciclo:c.id}));await cycles();banner('Conteo enviado para autorización.','success');}
    catch(e){banner(error(e),'error');}
   };
   if($('v5Approve'))$('v5Approve').onclick=async()=>{
    if(!confirm('¿Aprobar la revisión de diferencias? Esto NO ajusta existencias ni ubicaciones.'))return;
    try{fail(await sb.rpc('vantis_ciclo_aprobar_v5',{p_ciclo:c.id}));await cycles();banner('Revisión aprobada; sin modificación automática de stock.','success');}
    catch(e){banner(error(e),'error');}
   };
  }catch(e){if(active(id))slot.innerHTML='<div class="op-error">'+esc(error(e))+'</div>';}
 }
 async function incidents(){
  const id=now();
  wrap('Centro de incidencias','Registra incidencias con responsable, ubicación y seguimiento. Crear o resolver un reporte nunca cambia el inventario.',
   '<form id="v5Incident" class="op-stack v5-form"><label>SKU o código<input name="sku" required maxlength="120" placeholder="SKU, UPC o etiqueta"></label>'+
   '<label>Tipo<select name="tipo">'+Object.entries(types).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select></label>'+
   '<label>Marbete (opcional)<input name="marbete_codigo" maxlength="120" placeholder="ZAP-402-001"></label>'+
   '<label>Responsable / gafete<input name="responsable" maxlength="90" value="'+esc(actor)+'"></label>'+
   '<label>Descripción<textarea name="descripcion" required maxlength="1000" rows="3" placeholder="Describe la incidencia y las medidas tomadas"></textarea></label>'+
   '<button class="primary">Crear incidencia</button></form><div id="v5IncidentRows">Consultando reportes…</div>');
  let entryId=null;
  const form=$('v5Incident');
  form.addEventListener('input',()=>{entryId=null;});
  form.onsubmit=async ev=>{
   ev.preventDefault();if(working)return;working=true;const btn=form.querySelector('button');btn.disabled=true;
   try{
    const fd=new FormData(form);entryId ||=uuid();
    const payload={id:entryId,departamento_id:deptId,sku:String(fd.get('sku')).trim(),tipo:String(fd.get('tipo')),
     marbete_codigo:String(fd.get('marbete_codigo')).trim()||null,responsable:String(fd.get('responsable')).trim()||null,
     descripcion:String(fd.get('descripcion')).trim()};
    const prior=await sb.from('vantis_incidencias_v4').select('id').eq('id',entryId).maybeSingle();
    if(prior.error)throw prior.error;
    if(!prior.data)fail(await sb.from('vantis_incidencias_v4').insert(payload).select('id').single());
    entryId=null;form.reset();banner('Incidencia registrada y confirmada.','success');void loadIncidents();
   }catch(e){banner('Guardado no confirmado: '+error(e)+'. Se conserva folio para reintento.','error');}
   finally{working=false;btn.disabled=false;}
  };
  async function loadIncidents(){
   const r=await sb.from('vantis_incidencias_v4').select('id,sku,tipo,descripcion,estado,created_at,responsable,marbete_codigo,resolucion')
    .eq('departamento_id',deptId).order('created_at',{ascending:false}).limit(70);
   const rows=fail(r)||[];if(!active(id))return;
   $('v5IncidentRows').innerHTML='<h3>Seguimiento ('+rows.length+')</h3>'+(rows.length?rows.map(x=>
    '<article class="v5-incident"><div><b>'+esc(types[x.tipo]||x.tipo)+' · '+esc(x.sku)+'</b><p>'+esc(x.descripcion)+'</p><small>Responsable: '+esc(x.responsable||'No asignado')+' · '+esc(x.marbete_codigo||'Sin marbete')+' · '+esc(stamp(x.created_at))+'</small></div><div class="v5-incident-side"><span class="v5-state">'+esc(x.estado)+'</span>'+
    (admin&&x.estado!=='RESUELTA'?'<button type="button" class="secondary" data-resolve="'+esc(x.id)+'">Atender</button>':'')+'</div></article>'
   ).join(''):'<p>No hay incidencias registradas.</p>');
   $('v5IncidentRows').querySelectorAll('[data-resolve]').forEach(b=>b.onclick=async()=>{
    const row=rows.find(x=>x.id===b.dataset.resolve);
    const resolution=prompt('Resultado de la revisión o seguimiento:',row?.resolucion||'');
    if(resolution===null||!resolution.trim())return;
    const next=confirm('¿Marcar como resuelta? Cancelar la deja EN REVISIÓN.')?'RESUELTA':'EN_REVISION';
    try{const resp=await sb.from('vantis_incidencias_v4').update({estado:next,resolucion:resolution.trim().slice(0,1000),updated_at:new Date().toISOString()}).eq('id',row.id).eq('departamento_id',deptId).select('id').single();
     fail(resp);banner('Seguimiento actualizado por administrador.','success');void loadIncidents();
    }catch(e){banner('No se pudo actualizar: '+error(e),'error');}
   });
  }
  try{await loadIncidents();}catch(e){if(active(id))$('v5IncidentRows').innerHTML='<div class="op-error">'+esc(error(e))+'</div>';}
 }
 if(mode==='diagnostics')void diagnostics();else if(mode==='cycles')void cycles();else void incidents();
 return ()=>{disposed=true;clearInterval(clock);stopScanner();};
}
