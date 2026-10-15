import {wireExitInput} from './exit-input.mjs?v=3.8.0';

const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count = rows => rows.filter(row=>row.status==='draft').reduce((n,row)=>n+row.quantity,0);

export function mountFastReceive(root,queue,{startScanner,stopScanner,isCurrent=()=>true}) {
  const ui={phase:'capture',error:'',camera:false,lastSuccess:'',restoreCamera:false};
  const $=id=>root.querySelector('#'+id);
  const current=()=>root.isConnected && isCurrent();
  const ready=()=>current() && ui.phase==='capture' && queue.accepting &&
    !queue.busy && !queue.stale && !queue.storageError && !queue.selecting && queue.activeValidated;
  const inFlight=()=>queue.busy || ui.phase==='preparing' || ui.phase==='confirm';
  let frame=null;
  root.innerHTML='<section class="card receive-location"><div class="receive-step"><b>1 · Ubicación física</b><small>Primero el marbete; luego todas las piezas del cajón o mueble.</small></div><form id="receiveMarbeteForm" class="inline-form"><input id="receiveMarbete" placeholder="Escanea marbete · Ej. 459-001" aria-label="Marbete del grupo" autocomplete="off" autocapitalize="off" spellcheck="false"><button id="receiveUseMarbete" class="secondary">Usar</button><button id="receiveScanMarbete" type="button" class="secondary">▣ Cámara</button></form><div id="receiveActive" role="status"></div></section>'
    +'<section class="card receive-capture"><div class="receive-step"><b>2 · Escaneo continuo</b><small>Una lectura = una pieza. No hay preguntas entre artículos.</small></div><form id="manualMove"><input id="receiveCode" aria-label="Escáner portátil, SKU o UPC" placeholder="Escanea aquí SKU o UPC" autocomplete="off" autocapitalize="off" spellcheck="false"><button id="receiveCameraButton" type="button" class="secondary">▣ Cámara</button></form><div id="receiveCamera"></div><div id="receiveStatus" class="receive-status" role="status" aria-live="polite"></div><div id="receiveError" class="error" hidden></div></section>'
    +'<section class="card receive-list"><div class="receive-step"><b>3 · Piezas acumuladas</b><small id="receiveLines">0 líneas</small></div><div id="receiveRows"></div></section>'
    +'<div id="receiveRecovery" class="notice" hidden></div>'
    +'<section id="receiveFinal" class="card" hidden><h2 id="receiveFinalTitle">Finalizar recepción</h2><p id="receiveFinalDetail"></p><label>Responsable / referencia<input id="receiveNote" maxlength="500" placeholder="Tu nombre, folio o referencia"></label><div class="quick-row"><button id="registerReceive" type="button" class="primary">Registrar recepción</button><button id="receiveContinue" type="button" class="secondary">Seguir escaneando</button></div></section>'
    +'<div id="receiveFooter" class="receive-footer"><strong id="receiveFooterCount">0 piezas</strong><button id="receiveFinish" type="button" class="primary" disabled>Finalizar recepción</button></div>';

  const input=wireExitInput({input:$('receiveCode'),active:ready,
    onCode:code=>capture([{code,quantity:1}]),
    onList:(entries,fingerprint)=>capture(entries,fingerprint),
    onError:fail});
  function fail(error) {ui.error=error?.message || String(error);render();}
  function capture(entries,fingerprint='') {
    ui.error='';ui.lastSuccess='';
    try{queue.capture(entries,fingerprint);}
    catch(error){fail(error);}
  }
  function render() {
    if (!current()) return;
    const rows=queue.state.rows, drafts=rows.filter(x=>x.status==='draft');
    const pieces=count(rows),total=rows.reduce((n,x)=>n+x.quantity,0);
    $('receiveLines').textContent=rows.length+' grupos de SKU y ubicación';
    $('receiveFooterCount').textContent=pieces+' piezas · '+drafts.length+' grupos';
    $('receiveCode').disabled=!ready();
    $('receiveCameraButton').disabled=!ready() && !ui.camera;
    $('receiveCameraButton').textContent=ui.camera?'Cerrar cámara':'▣ Cámara';
    $('receiveUseMarbete').disabled=inFlight() || queue.selecting || queue.stale;
    $('receiveScanMarbete').disabled=inFlight() || queue.selecting || queue.stale;
    $('receiveMarbete').disabled=inFlight() || queue.selecting || queue.stale;
    $('receiveMarbete').placeholder=queue.selecting?'Validando marbete…':'Escanea marbete · Ej. 459-001';
    $('receiveActive').innerHTML=queue.activeValidated && queue.state.activeMarbete
      ? '<div class="receive-active"><span>MARBETE ACTIVO</span><strong>'+esc(queue.state.activeMarbete)+'</strong><small>'+esc(queue.state.locationLabel)+'</small><span>Los siguientes escaneos se guardarán aquí</span></div>'
      : '<p class="notice">'+(queue.selecting?'Validando ubicación…':'Sin ubicación activa. Escanea un marbete registrado para empezar.')+'</p>';
    $('receiveStatus').textContent=ui.lastSuccess || (ui.phase==='preparing'?'Verificando el catálogo y los marbetes…':queue.busy?'Registrando piezas…':queue.message||'Selecciona el marbete para comenzar.');
    $('receiveError').hidden=!(ui.error||queue.storageError);
    $('receiveError').textContent=ui.error||queue.storageError;
    $('receiveRows').innerHTML=rows.length?rows.map(row=>{
      const label=row.product?.descripcion||row.code;
      const unresolved=!row.resolving && (!row.product || row.saveError || row.lookupError);
      return '<article class="receive-row '+(unresolved?'receive-problem ':'')+(row.status==='done'?'receive-done':'')+'">'
        +'<div class="receive-row-body"><b>'+esc(label)+'</b><small>SKU '+esc(row.product?.sku||row.code)+' · '+esc(row.location)+'</small>'
        +(row.resolving?'<small>Buscando en catálogo…</small>':'')
        +(unresolved?'<small class="txt-red">'+esc(row.saveError||row.lookupError||'Código no encontrado')+'</small>':'')
        +(row.status==='done'?'<small class="txt-green">✓ Registrado</small>':'')
        +'</div><div class="receive-count"><button type="button" data-receive-delta="'+esc(row.id)+'" data-delta="-1" aria-label="Quitar una pieza" '+(row.status==='draft'&&!inFlight()?'':'disabled')+'>−</button><strong>×'+row.quantity+'</strong><button type="button" data-receive-delta="'+esc(row.id)+'" data-delta="1" aria-label="Agregar una pieza" '+(row.status==='draft'&&!inFlight()?'':'disabled')+'>+</button></div>'
        +'<button type="button" data-receive-remove="'+esc(row.id)+'" class="ghost" aria-label="Quitar línea" '+(row.status==='draft'&&!inFlight()?'':'disabled')+'>✕</button></article>';
    }).join(''):'<div class="receive-empty">Escanea la primera pieza para comenzar.<small>Las siguientes se sumarán a esta fila sin interrupciones.</small></div>';
    root.querySelectorAll('[data-receive-delta]').forEach(el=>el.onclick=()=>{
      try {const row=queue.state.rows.find(x=>x.id===el.dataset.receiveDelta);
        if (!row || row.status!=='draft')return;
        const qty=row.quantity+Number(el.dataset.delta);
        if (qty<1)queue.remove(row.id);else queue.edit(row.id,'quantity',qty);
        input.focus();
      } catch(error){fail(error);}
    });
    root.querySelectorAll('[data-receive-remove]').forEach(el=>el.onclick=()=>{
      try {queue.remove(el.dataset.receiveRemove);input.focus();}catch(error){fail(error);}
    });
    const uncertain=rows.some(row=>row.status==='sending'||row.status==='uncertain');
    $('receiveRecovery').hidden=!uncertain&&!queue.stale;
    $('receiveRecovery').innerHTML=queue.stale?'<p>Otra pestaña cambió este borrador. Recarga su avance antes de continuar.</p><button id="receiveReload" type="button" class="secondary">Cargar avance</button>'
      : uncertain?'<p>Hay entradas pendientes de verificar. No vuelvas a capturar esas piezas.</p><button id="receiveVerify" type="button" class="secondary">Verificar movimientos</button>':'';
    $('receiveReload')?.addEventListener('click',()=>{queue.sync();input.focus();});
    $('receiveVerify')?.addEventListener('click',()=>work(async()=>queue.verify()));
    $('receiveFooter').hidden=ui.phase==='confirm';
    $('receiveFinish').disabled=!drafts.length || !queue.activeValidated || queue.busy || queue.stale || !!queue.storageError || ui.phase!=='capture';
    $('receiveFinal').hidden=ui.phase!=='confirm';
    if(ui.phase==='confirm') {
      const summary=queue.confirmation;
      $('receiveFinalTitle').textContent='Registrar '+(summary?.pieces ?? pieces)+' piezas';
      $('receiveFinalDetail').textContent=(summary?.rows??drafts.length)+' grupos de SKU/ubicación · '+(summary?.locations??0)+' marbetes. Todas las piezas válidas se agregarán al stock.';
      $('registerReceive').disabled=queue.busy;
      $('receiveContinue').disabled=queue.busy;
      $('registerReceive').textContent=queue.busy?'Registrando…':'Confirmar '+(summary?.pieces??pieces)+' piezas';
    }
  }
  function scheduleRender() {
    if(frame!==null)return;
    frame=requestAnimationFrame(()=>{frame=null;render();});
  }
  async function work(action) {ui.error='';try{await action();}catch(error){fail(error);}render();}
  async function setMarbete(code) {
    stopScanner();ui.camera=false;ui.error='';
    if (!code.trim())return;
    await work(async()=>{
      const label=await queue.selectMarbete(code);
      $('receiveMarbete').value=label.codigo;
      input.focus();
    });
  }
  $('receiveMarbeteForm').onsubmit=event=>{event.preventDefault();setMarbete($('receiveMarbete').value);};
  $('receiveScanMarbete').onclick=()=>work(async()=>{
    stopScanner();
    await startScanner(code=>{if(current())setMarbete(code);},'marbete de ubicación');
  });
  async function openCamera() {
    if(ui.camera){stopScanner();return;}
    ui.camera=true;render();
    try {
      await startScanner(code=>{
        if(!ready())return;
        capture([{code,quantity:1}]);
        return count(queue.state.rows)+' piezas capturadas · '+code;
      },'piezas',{continuous:true,inlineTarget:$('receiveCamera'),
        onClose:()=>{ui.camera=false;if(current()){render();input.focus();}}});
    } catch(error) {ui.camera=false;fail('No se pudo abrir la cámara. Continúa con el lector portátil.');}
  }
  $('receiveCameraButton').onclick=()=>work(openCamera);
  $('receiveFinish').onclick=async()=>{
    input.flush();if(!ready())return;
    ui.phase='preparing';ui.restoreCamera=ui.camera;stopScanner();render();
    try {
      await queue.prepare();ui.phase='confirm';render();
      $('receiveNote').value=queue.state.note||'';
      $('receiveFinal').scrollIntoView({block:'center',behavior:'instant'});
    } catch(error){ui.phase='capture';fail(error);input.focus();}
  };
  $('receiveContinue').onclick=()=>{
    queue.resume();ui.phase='capture';render();input.focus();
    if(ui.restoreCamera)work(openCamera);
  };
  $('receiveNote').oninput=event=>{queue.state.note=event.target.value.slice(0,500);queue.persist();};
  $('registerReceive').onclick=async()=>{
    if(!queue.confirmation||queue.busy)return;
    const pieces=queue.confirmation.pieces;
    await work(async()=>{
      queue.state.note=$('receiveNote').value.trim();
      if(!queue.persist()) throw Error(queue.storageError||queue.message);
      try {await queue.submit();}
      catch(error){queue.resume();ui.phase='capture';input.focus();throw error;}
      ui.phase='capture';
      ui.lastSuccess='✓ Recepción guardada: '+pieces+' piezas. Escanea el siguiente grupo cuando quieras.';
      render();input.focus();
    });
  };
  const onStorage=event=>{if(event.key===queue.key&&current()){queue.stale=true;queue.confirmation=null;ui.phase='capture';scheduleRender();}};
  window.addEventListener('storage',onStorage);
  queue.onChange=scheduleRender;
  queue.validateActive().then(scheduleRender);
  render();
  return ()=>{
    if(frame!==null)cancelAnimationFrame(frame);
    input.destroy();stopScanner();window.removeEventListener('storage',onStorage);queue.onChange=()=>{};
  };
}
