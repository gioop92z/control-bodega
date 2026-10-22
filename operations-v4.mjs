// VANTIS 4.0: progressive operations workspace. No inventory writes outside confirmed existing APIs.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const integer = value => Number(value || 0).toLocaleString('es-MX');
const errorText = e => String(e?.message || e?.error?.message || e || 'Error desconocido');
const safeCode = code => String(code ?? '').trim().replace(/[\u200B-\u200D\uFEFF]/g,'');
export function normalizePickDraft(value) {
  const list = Array.isArray(value) ? value : [];
  const result = [];
  for (const entry of list) {
    const code=safeCode(entry?.code), qty=Number(entry?.quantity);
    if(!code || code.length>120 || !Number.isSafeInteger(qty) || qty<1 || qty>100000)continue;
    const existing=result.find(item=>item.code===code);
    if(existing)existing.quantity=Math.min(100000,existing.quantity+qty);
    else if(result.length<500)result.push({code,quantity:qty});
  }
  return result;
}
export function compareLocationQuantities(stock, assignments) {
  const values=(Array.isArray(assignments)?assignments:[]).map(x=>x.cantidad);
  const unknown=values.some(v=>v===null||v===undefined||v==='');
  const located=values.reduce((n,v)=>n+(v===null||v===undefined||v===''?0:Number(v)||0),0);
  return {located,unknown,difference:unknown?null:Number(stock||0)-located};
}
export function mountOperations(root,{sb,deptId,admin=false,actor='',onBack=()=>{},onExit=()=>{}}) {
  let destroyed=false,epoch=0,tab=admin?'control':'locate',busy=false,transferId=null;
  const localKey='vantis.ops.pick.v4:'+deptId+':'+actor;
  let draft=[];
  try{draft=normalizePickDraft(JSON.parse(localStorage.getItem(localKey)||'[]'));}catch{}
  const $=id=>root.querySelector('#'+id);
  const current=id=>!destroyed&&root.isConnected&&id===epoch;
  function persist(){try{localStorage.setItem(localKey,JSON.stringify(draft));return true;}catch(e){message('No hay espacio disponible para proteger esta preparación.','error');return false;}}
  function message(text,tone='info'){const el=$('opFeedback');if(el){el.textContent=text;el.dataset.tone=tone;el.hidden=false;}}
  function header(){
    root.innerHTML='<section class="op-shell"><div class="op-heading"><div><small>VANTIS · OPERACIONES</small><h1>Centro operativo</h1><p>Localiza, prepara y supervisa sin afectar movimientos existentes.</p></div><button id="opBack" type="button" class="ghost">← Volver</button></div><nav id="opTabs" class="op-tabs" aria-label="Funciones de operación"></nav><div id="opFeedback" class="op-feedback" hidden role="status"></div><section id="opBody" class="op-body"></section></section>';
    $('opBack').onclick=()=>{destroyed=true;onBack();};
    const tabs=[...(admin?[['control','Centro de control']]:[]),['locate','Localizar'],['picks','Preparar apoyos'],['transfer','Traslados'],['incidents','Incidencias'],...(admin?[['counts','Conteos y diferencias']]:[])];
    $('opTabs').innerHTML=tabs.map(([key,title])=>'<button class="op-tab'+(key===tab?' selected':'')+'" type="button" data-tab="'+key+'">'+title+'</button>').join('');
    $('opTabs').querySelectorAll('button').forEach(button=>button.onclick=()=>{if(busy)return;tab=button.dataset.tab;render();});
  }
  function render(){
    epoch++;header();
    if(tab==='control')void control(epoch);
    else if(tab==='locate')locator();
    else if(tab==='picks')picks();
    else if(tab==='transfer')transfer();
    else if(tab==='incidents')incidents();
    else if(tab==='counts')void counts(epoch);
  }
  function failQuery(result){if(result?.error)throw result.error;return result?.data;}
  async function control(id){
    if(!admin){tab='locate';render();return;}
    $('opBody').innerHTML='<div class="op-loading">Consultando las cifras confirmadas del servidor…</div>';
    try{
      const [summary,products,locations,recent,counts,empty,provisional]=await Promise.all([
        sb.rpc('resumen_departamento',{p_departamento:deptId}),
        sb.from('productos').select('id',{count:'exact',head:true}).eq('departamento_id',deptId).eq('activo',true),
        sb.from('marbetes').select('codigo',{count:'exact',head:true}).eq('departamento_id',deptId).eq('activo',true),
        sb.from('movimientos').select('tipo,sku,cantidad,impacto,created_at,marbete_codigo').eq('departamento_id',deptId).order('created_at',{ascending:false}).limit(15),
        sb.from('conteos').select('id,nombre,estado').eq('departamento_id',deptId).order('created_at',{ascending:false}).limit(12),
        sb.from('productos').select('id',{count:'exact',head:true}).eq('departamento_id',deptId).eq('activo',true).lte('stock',0),
        sb.from('productos').select('id',{count:'exact',head:true}).eq('departamento_id',deptId).eq('activo',true).ilike('descripcion','SIN DESCRIPCIÓN%')
      ]);
      if(!current(id))return;
      const numbers=failQuery(summary)||{},movements=failQuery(recent)||[],physical=failQuery(counts)||[];
      failQuery(products);failQuery(locations);failQuery(empty);failQuery(provisional);
      const cell=(name,val)=>'<div class="op-kpi"><span>'+name+'</span><strong>'+integer(val)+'</strong></div>';
      $('opBody').innerHTML='<div class="op-kpis">'+cell('Artículos en catálogo',products.count??0)+cell('Ubicaciones activas',locations.count??0)+cell('Unidades en inventario',numbers.unidades??0)+cell('Movimientos',numbers.movimientos??0)+'</div><div class="op-notice"><b>Alertas:</b> '+integer(empty.count??0)+' referencias sin existencias · '+integer(provisional.count??0)+' SKU provisionales · '+integer(physical.filter(c=>c.estado!=='CERRADO').length)+' conteos recientes abiertos.</div><div class="op-two"><section class="op-panel"><h2>Últimos movimientos</h2>'+ (movements.length?movements.map(m=>'<article class="op-line"><b>'+esc(m.tipo)+' · '+esc(m.sku)+'</b><span>'+esc(m.marbete_codigo||'Sin ubicación')+' · '+esc(new Date(m.created_at).toLocaleString('es-MX'))+'</span><strong>'+integer(m.impacto??m.cantidad)+'</strong></article>').join(''):'<p>No hay movimientos registrados.</p>')+'</section><section class="op-panel"><h2>Conteos recientes</h2>'+(physical.length?physical.map(c=>'<article class="op-line"><b>'+esc(c.nombre)+'</b><span>'+esc(c.estado)+'</span></article>').join(''):'<p>No hay conteos recientes.</p>')+'</section></div><p class="op-fine">Datos consultados del servidor: '+esc(new Date().toLocaleString('es-MX'))+'. Movimientos y conteos muestran los más recientes, no el historial completo.</p><button id="opRefresh" type="button" class="secondary">Actualizar cifras</button>';
      $('opRefresh').onclick=()=>void control(++epoch);
    }catch(error){if(current(id))$('opBody').innerHTML='<div class="op-error">No fue posible consultar el centro de control: '+esc(errorText(error))+'</div><button id="opRefresh" class="secondary">Reintentar</button>', $('opRefresh').onclick=()=>void control(++epoch);}
  }
  function locator(){
    $('opBody').innerHTML='<div class="op-panel"><h2>Localizador de mercancía</h2><p>Consulta un SKU o UPC para ver sus marbetes y detectar cantidades pendientes de conciliar.</p><form id="opFindForm" class="op-form"><input id="opFind" required maxlength="120" autocomplete="off" placeholder="Escribe o escanea SKU / UPC"><button class="primary" type="submit">Localizar</button></form><div id="opFindResult"></div></div>';
    $('opFindForm').onsubmit=event=>{event.preventDefault();void locate($('opFind').value,++epoch);};
  }
  async function locate(raw,id){
    const code=safeCode(raw),target=$('opFindResult');if(!code||code.length>120)return;
    target.innerHTML='<p>Buscando en el servidor…</p>';
    try{
      let query=await sb.from('productos').select('id,sku,upc,descripcion,marca,talla,color,stock').eq('departamento_id',deptId).eq('activo',true).eq('sku',code).limit(1);
      let product=failQuery(query)?.[0];
      if(!product){query=await sb.from('productos').select('id,sku,upc,descripcion,marca,talla,color,stock').eq('departamento_id',deptId).eq('activo',true).eq('upc',code).limit(1);product=failQuery(query)?.[0];}
      if(!current(id))return;
      if(!product){target.innerHTML='<div class="op-error">Este código no está en el catálogo de este departamento.</div>';return;}
      const assignments=failQuery(await sb.from('producto_marbetes').select('marbete_codigo,cantidad').eq('sku',product.sku))||[];
      const labels=assignments.length?failQuery(await sb.from('marbetes').select('codigo,zona,descripcion,activo').eq('departamento_id',deptId).in('codigo',[...new Set(assignments.map(a=>a.marbete_codigo))]))||[]:[];
      if(!current(id))return;
      const assignedHere=assignments.filter(a=>labels.some(m=>m.codigo===a.marbete_codigo));
      const ledger=compareLocationQuantities(product.stock,assignedHere);
      const details=assignedHere.map(a=>{const m=labels.find(item=>item.codigo===a.marbete_codigo);return '<article class="op-line"><b>'+esc(a.marbete_codigo)+'</b><span>'+esc(m?.zona||'Zona desconocida')+(m?.descripcion?' · '+esc(m.descripcion):'')+(m?.activo===false?' · INACTIVO':'')+'</span><strong>'+esc(a.cantidad===null||a.cantidad===undefined?'Cantidad pendiente':integer(a.cantidad)+' pzas')+'</strong></article>';}).join('');
      target.innerHTML='<section class="op-result"><h3>'+esc(product.descripcion||product.sku)+'</h3><p>SKU '+esc(product.sku)+(product.upc?' · UPC '+esc(product.upc):'')+'</p><div class="op-kpis"><div class="op-kpi"><span>Stock general</span><strong>'+integer(product.stock)+'</strong></div><div class="op-kpi"><span>Cantidad ubicada conocida</span><strong>'+integer(ledger.located)+'</strong></div></div><h3>Ubicaciones registradas</h3>'+(details||'<p>No se encontraron marbetes asignados.</p>')+(ledger.unknown?'<div class="op-notice">Hay cantidades sin determinar. No es posible calcular una diferencia exacta.</div>':ledger.difference!==0?'<div class="op-notice">Por conciliar: '+integer(ledger.difference)+' piezas. No se ajusta el stock automáticamente.</div>':'<div class="op-ok">Las cantidades ubicadas coinciden con el stock general registrado.</div>')+'</section>';
    }catch(error){if(current(id))target.innerHTML='<div class="op-error">No se pudo localizar: '+esc(errorText(error))+'</div>';}
  }
  function picks(){
    $('opBody').innerHTML='<div class="op-panel"><h2>Preparar apoyos</h2><p>Escanea cada pieza o agrega la cantidad manual. La preparación queda protegida en este navegador y se envía a la fila existente de salidas; el stock se descuenta solamente al confirmar la salida.</p><form id="opPickForm" class="op-form"><input id="opPickCode" required maxlength="120" autocomplete="off" placeholder="SKU o UPC" aria-label="SKU o UPC"><input id="opPickQty" type="number" min="1" max="100000" value="1" aria-label="Piezas" class="op-small"><button type="submit" class="primary">Agregar</button></form><div id="opPickLines"></div><button id="opSendExit" type="button" class="primary">Pasar a salida para revisar</button><button id="opClearPick" type="button" class="ghost">Vaciar preparación</button></div>';
    $('opPickForm').onsubmit=e=>{e.preventDefault();const code=safeCode($('opPickCode').value),quantity=Number($('opPickQty').value);if(!code||code.length>120||!Number.isSafeInteger(quantity)||quantity<1||quantity>100000){message('Código o cantidad inválida.','error');return;}const old=draft.find(x=>x.code===code);if(old){if(old.quantity+quantity>100000){message('Se supera la cantidad permitida.','error');return;}old.quantity+=quantity;}else if(draft.length<500)draft.push({code,quantity});else{message('Máximo 500 códigos por preparación.','error');return;}persist();$('opPickCode').value='';$('opPickQty').value='1';showPickLines();$('opPickCode').focus();};
    $('opClearPick').onclick=()=>{if(draft.length&&!confirm('¿Borrar la preparación guardada en este dispositivo?'))return;draft=[];persist();showPickLines();};
    $('opSendExit').onclick=()=>{if(!draft.length||busy)return;if(!confirm('¿Enviar '+draft.reduce((sum,x)=>sum+x.quantity,0)+' piezas a la fila de salidas? Todavía tendrás que revisar y confirmar la salida.'))return;busy=true;try{const moved=onExit(draft.map(x=>({...x})));if(moved!==false){draft=[];persist();}}catch(error){message('No se transfirió la preparación: '+errorText(error),'error');}finally{busy=false;}};
    showPickLines();
  }
  function showPickLines(){
    const el=$('opPickLines');if(!el)return;
    el.innerHTML=draft.length?'<div class="op-pick-header"><b>'+integer(draft.reduce((n,x)=>n+x.quantity,0))+' piezas · '+integer(draft.length)+' códigos</b></div>'+draft.map((line,i)=>'<article class="op-line"><b>'+esc(line.code)+'</b><strong>'+integer(line.quantity)+' pzas</strong><button type="button" class="ghost" data-remove="'+i+'" aria-label="Retirar código">Quitar</button></article>').join(''):'<div class="op-empty">Todavía no has agregado piezas.</div>';
    el.querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>{draft.splice(Number(button.dataset.remove),1);persist();showPickLines();});
    $('opSendExit').disabled=!draft.length;
  }
  function transfer(){
    $('opBody').innerHTML='<div class="op-panel"><h2>Trasladar entre marbetes</h2><p>Un traslado conserva el stock total. Solo podrá ejecutarse mediante una operación atómica autorizada por Supabase. Hasta que se instale su migración, VANTIS no realizará ningún movimiento.</p><form id="opTransferForm" class="op-stack"><label>SKU <input name="sku" required maxlength="120" autocomplete="off"></label><label>Marbete de origen <input name="source" required maxlength="120" autocomplete="off"></label><label>Marbete de destino <input name="target" required maxlength="120" autocomplete="off"></label><label>Cantidad <input name="qty" type="number" min="1" max="100000" required value="1"></label><button class="primary">Validar y trasladar</button></form></div>';
    const form=$('opTransferForm');
    form.addEventListener('input',()=>{transferId=null;});
    form.onsubmit=async e=>{
      e.preventDefault();if(busy)return;
      const data=new FormData(form),sku=safeCode(data.get('sku')),source=safeCode(data.get('source')),target=safeCode(data.get('target')),quantity=Number(data.get('qty'));
      if(!sku||!source||!target||source===target||![sku,source,target].every(x=>x.length<=120)||!Number.isSafeInteger(quantity)||quantity<1||quantity>100000){message('Verifica los datos y las ubicaciones.','error');return;}
      if(!confirm('¿Trasladar '+quantity+' piezas de '+source+' a '+target+'? Esta operación no cambia las existencias totales.'))return;
      transferId ||= crypto.randomUUID();busy=true;
      try{const r=await sb.rpc('vantis_trasladar_v4',{p_operacion_id:transferId,p_departamento:deptId,p_sku:sku,p_origen:source,p_destino:target,p_cantidad:quantity});failQuery(r);message('Traslado confirmado por el servidor. Folio '+transferId,'success');transferId=null;form.reset();}
      catch(error){message('No se confirmó el traslado: '+errorText(error)+'. Conserva el mismo formulario para reintentar con el mismo folio.','error');}
      finally{busy=false;}
    };
  }
  function incidents(){
    $('opBody').innerHTML='<div class="op-panel"><h2>Incidencias de mercancía</h2><p>Registra daños, diferencias, pérdidas o devoluciones para revisión. Una incidencia NO modifica stock automáticamente.</p><form id="opIncidentForm" class="op-stack"><label>SKU / UPC <input name="sku" required maxlength="120" autocomplete="off"></label><label>Tipo <select name="tipo"><option value="DANIO">Mercancía dañada</option><option value="DIFERENCIA">Diferencia de inventario</option><option value="PERDIDA">No localizada</option><option value="DEVOLUCION">Devolución</option></select></label><label>Detalle <textarea name="descripcion" required maxlength="1000" rows="3" placeholder="Describe qué sucedió"></textarea></label><button class="primary">Registrar incidencia</button></form><div id="opIncidentList"><p>Consultando incidencias…</p></div></div>';
    const form=$('opIncidentForm');let incidentId=null;
    form.addEventListener('input',()=>{incidentId=null;});
    form.onsubmit=async e=>{
      e.preventDefault();if(busy)return;const f=new FormData(form),sku=safeCode(f.get('sku')),descripcion=String(f.get('descripcion')||'').trim(),tipo=String(f.get('tipo')||'');
      if(!sku||sku.length>120||!descripcion||descripcion.length>1000){message('Completa los datos.','error');return;}
      incidentId ||= crypto.randomUUID();busy=true;
      try{
        const payload={id:incidentId,departamento_id:deptId,sku,tipo,descripcion};
        // Before retrying an uncertain write, verify the same folio first.
        const existing=await sb.from('vantis_incidencias_v4').select('id,departamento_id,sku,tipo,descripcion').eq('id',incidentId).maybeSingle();
        if(existing.error)throw existing.error;
        if(existing.data){
          if(existing.data.sku!==sku||existing.data.tipo!==tipo||existing.data.descripcion!==descripcion||existing.data.departamento_id!==deptId)throw Error('Folio previo con contenido diferente.');
        }else{
          const r=await sb.from('vantis_incidencias_v4').insert(payload).select('id').single();failQuery(r);
        }
        message('Incidencia confirmada por el servidor. Folio '+incidentId,'success');
        incidentId=null;form.reset();void loadIncidents(epoch);
      }
      catch(error){message('No se pudo confirmar la incidencia: '+errorText(error)+'. El folio se conserva para reintentar sin duplicar.','error');}
      finally{busy=false;}
    };
    void loadIncidents(epoch);
  }
  async function loadIncidents(id){
    try{const r=await sb.from('vantis_incidencias_v4').select('id,sku,tipo,descripcion,estado,created_at').eq('departamento_id',deptId).order('created_at',{ascending:false}).limit(30);
      const entries=failQuery(r)||[];if(!current(id))return;
      $('opIncidentList').innerHTML='<h3>Incidencias registradas</h3>'+(entries.length?entries.map(i=>'<article class="op-line"><b>'+esc(i.tipo)+' · '+esc(i.sku)+'</b><span>'+esc(i.descripcion)+' · '+esc(i.estado)+' · '+esc(new Date(i.created_at).toLocaleString('es-MX'))+'</span></article>').join(''):'<p>Sin incidencias.</p>');
    }catch(error){if(current(id))$('opIncidentList').innerHTML='<div class="op-notice">El registro de incidencias aún no está habilitado en Supabase. No se guardarán reportes hasta instalar y verificar la migración.</div>';}
  }
  async function counts(id){
    $('opBody').innerHTML='<div class="op-panel"><h2>Conteos y conciliación</h2><p>Consulta conteos físicos existentes. Los ajustes requieren autorización; este panel no cambia cantidades.</p><div id="opCountRows">Consultando…</div></div>';
    try{const r=await sb.from('conteos').select('id,nombre,estado,created_at').eq('departamento_id',deptId).order('created_at',{ascending:false}).limit(50);const rows=failQuery(r)||[];if(!current(id))return;
      $('opCountRows').innerHTML=rows.length?rows.map(c=>'<article class="op-line"><b>'+esc(c.nombre)+'</b><span>'+esc(c.estado)+' · '+esc(new Date(c.created_at).toLocaleString('es-MX'))+'</span></article>').join(''):'<p>No hay conteos.</p>';
    }catch(error){if(current(id))$('opCountRows').innerHTML='<div class="op-error">'+esc(errorText(error))+'</div>';}
  }
  render();
  return ()=>{destroyed=true;epoch++;};
}
