import {lineIssue} from './support-batch.mjs?v=3.8.0';
import {wireExitInput} from './exit-input.mjs?v=3.8.0';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reasons = [['APOYO INTERNET','Apoyos por internet'],['VENTA NOCTURNA','Venta nocturna'],['VENTA','Venta'],['OTRA SALIDA','Otra salida']];

export function mountFastExit(root, queue, {startScanner, stopScanner, admin = false, isCurrent = () => true}) {
  const ui = {phase:'capture', error:'', editor:'', marbete:'', missing:false, camera:false, resumeCamera:false, lastSuccess:''};
  const $ = id => root.querySelector(`#${id}`);
  const current = () => root.isConnected && isCurrent();
  const ready = () => current() && ui.phase === 'capture' && !queue.busy && !queue.stale && !queue.storageError;
  const blocked = () => queue.busy || queue.pending > 0 || ui.phase !== 'capture';
  const disabled = value => value ? 'disabled' : '';
  root.innerHTML = `<section class="exit-capture card"><div class="exit-ready"><span id="exitReadyLight"></span><b>Escáner listo</b><span id="exitCount">0 piezas</span></div><form id="manualMove"><input id="manualCode" aria-label="Escáner portátil, SKU o UPC" placeholder="Escanea con tu lector o pega los códigos" autocomplete="off" autocapitalize="off" spellcheck="false"><button id="scanMove" type="button" class="secondary">▣ Cámara</button></form><p class="tiny">Cada lectura suma una pieza automáticamente.</p><div id="exitCamera"></div></section>
    <div id="exitStatus" class="exit-status" role="status" aria-live="polite"></div>
    <div id="exitError" class="error" role="alert" hidden></div>
    <section class="card exit-list"><div class="exit-list-head"><b>Mercancía en fila</b><small id="exitArticles">0 artículos</small></div><div id="exitQueueRows"></div></section>
    <section id="exitRecovery" class="notice" hidden></section>
    <section id="exitFinishPanel" class="card exit-final" hidden aria-label="Finalizar salida"><h2 id="exitFinishTitle">Finalizar salida</h2><label for="exitReason">¿Cómo registrar esta salida?</label><select id="exitReason">${reasons.map(([value,name])=>`<option value="${value}">${name}</option>`).join('')}</select><label for="exitNote">Nota opcional</label><input id="exitNote" maxlength="500" placeholder="Pedido, referencia o comentario"><p id="exitLocationWarning" class="notice" hidden></p><p class="tiny">Responsable: ${esc(queue.actor || 'Sin identificar')}</p><div class="exit-final-actions"><button id="saveExitBatch" type="button" class="danger">Registrar salida</button><button id="exitContinue" type="button" class="secondary">Seguir escaneando</button></div></section>
    <div id="exitFooter" class="exit-footer"><strong id="exitFooterCount">0 piezas</strong><button id="finishExit" type="button" class="primary" disabled>Finalizar salida</button></div>`;

  const controller = wireExitInput({input:$('manualCode'), active:ready,
    onCode:code=>capture([{code,quantity:1}]), onList:(entries,fingerprint)=>capture(entries,fingerprint), onError:fail});
  $('manualMove').onsubmit = event => { event.preventDefault(); controller.flush(); };
  function fail(error) { ui.error = error.message || String(error); render(); }
  function capture(entries, fingerprint = '') {
    ui.error = ''; ui.lastSuccess = ''; queue.capture(entries, fingerprint);
  }
  function rowHTML(row) {
    const p = row.product, locations = row.locations || [], frozen = blocked() || row.status !== 'draft';
    const problem = row.resolving ? '' : lineIssue(row,queue.deptId);
    const label = row.location || locations[0]?.marbete_codigo;
    const location = label ? `${label}${locations.length > 1 ? ' +' + (locations.length - 1) : ''}` : 'Sin marbete';
    return `<article class="exit-item ${row.status==='done'?'exit-done':''} ${problem?'exit-problem':''}" data-exit-row="${esc(row.id)}"><div class="exit-item-main"><strong>${esc(p?.descripcion || row.code)}</strong><small>SKU ${esc(p?.sku || row.code)}${p ? ' · ' + esc([p.talla,p.color].filter(Boolean).join(' · ')) : ''}${p && row.status!=='done' ? ' · Stock ' + esc(p.stock) : ''}</small><button type="button" class="exit-location-chip ${label?'located':'missing'}" data-exit-edit="${esc(row.id)}" ${disabled(frozen)}>${row.resolving?'Consultando…':esc(location)}${row.resolving?'':' ›'}</button></div><div class="exit-quantity"><button type="button" data-exit-delta="${esc(row.id)}" data-delta="-1" aria-label="Quitar una pieza de ${esc(row.code)}" ${disabled(frozen)}>−</button><b data-exit-quantity="${esc(row.id)}">×${row.quantity}</b><button type="button" data-exit-delta="${esc(row.id)}" data-delta="1" aria-label="Sumar una pieza de ${esc(row.code)}" ${disabled(frozen)}>+</button></div><button type="button" class="exit-remove" data-exit-remove="${esc(row.id)}" aria-label="Retirar ${esc(row.code)} de la fila" ${disabled(frozen)}>×</button>${row.status==='done'?'<span class="exit-item-note">✓ Registrado</span>':problem||row.saveError?`<span class="exit-item-note">${esc(row.saveError || problem)}</span>`:''}
    ${ui.editor === row.id ? `<div class="exit-editor"><div class="two"><label>Cantidad<input id="exitEditQuantity" type="number" min="1" step="1" value="${row.quantity}" ${disabled(frozen)}></label><label>Ubicación de salida<select id="exitEditLocation" ${disabled(frozen)}><option value="">Solo existencia total</option>${locations.map(loc=>`<option value="${esc(loc.marbete_codigo)}" ${row.location===loc.marbete_codigo?'selected':''}>${esc(loc.marbete_codigo)} · ${loc.cantidad==null?'sin conteo':loc.cantidad+' pzas'}</option>`).join('')}</select></label></div>${p ? `<form id="exitMarbeteForm" class="inline-form"><input id="exitMarbete" maxlength="120" value="${esc(ui.marbete)}" placeholder="Escanea o escribe otro marbete" aria-label="Marbete de este artículo" autocomplete="off" ${disabled(frozen)}><button class="secondary" ${disabled(frozen)}>Asignar</button></form><div class="quick-row"><button id="exitScanMarbete" type="button" class="secondary" ${disabled(frozen)}>Escanear marbete</button><button id="exitCloseEditor" type="button" class="ghost" ${disabled(frozen)}>Listo</button></div>${ui.missing ? admin?'<label>Tipo de ubicación<select id="exitNewZone"><option value="BODEGA">BODEGA</option><option value="PISO">PISO</option></select></label><button id="exitRegisterMarbete" type="button" class="secondary">Registrar y asignar</button>':'<p class="tiny">El administrador debe dar de alta este marbete.</p>':''}`:'<button id="exitCloseEditor" type="button" class="ghost">Listo</button>'}</div>`:''}</article>`;
  }
  function render() {
    if (!current()) return;
    const rows = queue.state.rows, drafts = rows.filter(row=>row.status!=='done');
    const pieces = drafts.reduce((sum,row)=>sum+row.quantity,0), total = rows.reduce((sum,row)=>sum+row.quantity,0);
    $('exitCount').textContent = `${pieces} piezas`;
    $('exitFooterCount').textContent = `${pieces} piezas · ${drafts.length} artículos`;
    $('exitArticles').textContent = `${rows.length} artículos`;
    $('manualCode').disabled = !ready(); $('scanMove').disabled = !ready();
    $('scanMove').textContent = ui.camera ? 'Cerrar cámara' : '▣ Cámara';
    $('exitReadyLight').classList.toggle('paused',!ready());
    $('exitStatus').textContent = ui.lastSuccess || (ui.phase==='preparing'?'Preparando salida…':queue.busy?'Registrando salida…':queue.message || 'Escanea todos los artículos y finaliza cuando termines.');
    $('exitError').hidden = !(ui.error || queue.storageError); $('exitError').textContent = ui.error || queue.storageError;
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    const focusId = active?.id, value = active?.value;
    $('exitQueueRows').innerHTML = rows.length ? rows.map(rowHTML).join('') : '<div class="exit-empty">Escanea el primer artículo.<small>Los siguientes se agregarán aquí sin preguntas.</small></div>';
    const restore = focusId && focusId.startsWith('exitEdit') ? $(focusId) : null;
    if (restore && !restore.disabled) { restore.value=value; restore.focus({preventScroll:true}); }
    const uncertain = rows.some(row=>['sending','uncertain'].includes(row.status));
    $('exitRecovery').hidden = !uncertain && !queue.stale;
    $('exitRecovery').innerHTML = queue.stale ? '<p>Otra pestaña actualizó esta salida.</p><button id="exitReload" class="secondary" type="button">Cargar avance</button>' : uncertain ? '<p>Hay una salida por verificar. Su lectura se conserva y no se enviará de nuevo.</p><button id="exitVerify" class="secondary" type="button">Verificar avance</button>' : '';
    $('exitFooter').hidden = ui.phase==='confirm';
    $('finishExit').disabled = !drafts.length || queue.busy || ui.phase!=='capture' || queue.stale || !!queue.storageError;
    $('finishExit').textContent = ui.phase==='preparing'?'Preparando…':'Finalizar salida';
    $('exitFinishPanel').hidden = ui.phase!=='confirm';
    root.classList.toggle('exit-confirming',ui.phase==='confirm');
    if (ui.phase==='confirm') {
      const confirmation = queue.confirmation;
      $('exitFinishTitle').textContent = `Finalizar ${confirmation?.pieces ?? pieces} piezas`;
      $('exitLocationWarning').hidden = !confirmation?.totalOnly;
      $('exitLocationWarning').textContent = `${confirmation?.totalOnly || 0} artículo(s) se descontarán solo de la existencia total porque no tienen una cantidad contada en un marbete seleccionado.`;
      for (const id of ['exitReason','exitNote','saveExitBatch','exitContinue']) $(id).disabled=queue.busy;
      $('saveExitBatch').textContent = queue.busy ? 'Registrando…' : `Registrar salida de ${confirmation?.pieces ?? pieces} piezas`;
    }
    root.querySelectorAll('[data-exit-delta]').forEach(button=>button.onclick=()=>work(async()=>{
      const row=queue.state.rows.find(row=>row.id===button.dataset.exitDelta), quantity=row.quantity+Number(button.dataset.delta);
      if(quantity<1)queue.remove(row.id);else queue.edit(row.id,'quantity',quantity); controller.focus();
    }));
    root.querySelectorAll('[data-exit-remove]').forEach(button=>button.onclick=()=>work(()=>{queue.remove(button.dataset.exitRemove);controller.focus();}));
    root.querySelectorAll('[data-exit-edit]').forEach(button=>button.onclick=()=>{
      ui.editor=ui.editor===button.dataset.exitEdit?'':button.dataset.exitEdit;ui.marbete='';ui.missing=false;render();
      if(ui.editor)$('exitMarbete')?.focus();else controller.focus();
    });
    $('exitEditQuantity')?.addEventListener('change',event=>work(()=>queue.edit(ui.editor,'quantity',event.target.value)));
    $('exitEditLocation')?.addEventListener('change',event=>work(()=>queue.edit(ui.editor,'location',event.target.value)));
    $('exitMarbete')?.addEventListener('input',event=>{ui.marbete=event.target.value;ui.missing=false;});
    $('exitMarbeteForm')?.addEventListener('submit',event=>{event.preventDefault();assign($('exitMarbete').value);});
    $('exitCloseEditor')?.addEventListener('click',()=>{ui.editor='';render();controller.focus();});
    $('exitScanMarbete')?.addEventListener('click',()=>work(async()=>{stopScanner();await startScanner(code=>{if(current())assign(code);},'marbete de este artículo');}));
    $('exitRegisterMarbete')?.addEventListener('click',()=>assign(ui.marbete,$('exitNewZone').value));
    $('exitVerify')?.addEventListener('click',()=>work(async()=>{await queue.settle();await queue.verify();}));
    $('exitReload')?.addEventListener('click',()=>work(()=>{queue.sync();controller.focus();}));
  }
  async function work(action) { ui.error='';try{await action();}catch(error){fail(error);}render(); }
  async function assign(code,zone=null) {
    ui.marbete=code;ui.error='';ui.missing=false;
    try { await queue.assign(ui.editor,code,zone,admin);ui.editor='';controller.focus(); }
    catch(error){ui.error=error.message;ui.missing=error.code==='NOT_REGISTERED';}
    render();
  }
  async function openCamera() {
    if (ui.camera) { stopScanner();return; }
    ui.camera=true;render();
    try {
      await startScanner(code=>{
        if(!ready())return;
        capture([{code,quantity:1}]);
        return `${queue.state.rows.filter(row=>row.status!=='done').reduce((sum,row)=>sum+row.quantity,0)} piezas en fila · ${code}`;
      },'artículos',{continuous:true,inlineTarget:$('exitCamera'),onClose:()=>{ui.camera=false;if(current()){render();controller.focus();}}});
      controller.focus();
    } catch(error) { ui.camera=false;ui.error='No pude abrir la cámara. Puedes seguir usando tu escáner portátil.';render();controller.focus(); }
  }
  $('scanMove').onclick=()=>work(openCamera);
  $('finishExit').onclick=async()=>{
    controller.flush();if(!ready())return;
    ui.error='';ui.editor='';ui.resumeCamera=ui.camera;ui.phase='preparing';stopScanner();render();
    try {
      await queue.prepare();ui.phase='confirm';
      $('exitReason').value=queue.state.reason || 'APOYO INTERNET';$('exitNote').value=queue.state.note || '';
      render();$('exitFinishPanel').scrollIntoView({block:'center',behavior:'instant'});$('exitReason').focus({preventScroll:true});
    } catch(error) {ui.phase='capture';fail(error);controller.focus();}
    render();
  };
  $('exitContinue').onclick=()=>{ui.phase='capture';queue.resume();render();controller.focus();if(ui.resumeCamera)work(openCamera);};
  $('exitNote').oninput=event=>{if(!queue.busy){queue.state.note=event.target.value.slice(0,500);queue.persist();}};
  $('exitReason').onchange=event=>{if(!queue.busy){queue.state.reason=event.target.value;queue.persist();}};
  $('saveExitBatch').onclick=()=>work(async()=>{
    const count=queue.confirmation?.pieces;
    if(!count||queue.busy)return;
    try { await queue.submit({acknowledgeTotalOnly:true,reason:$('exitReason').value}); }
    catch(error) { ui.phase='capture';queue.resume();controller.focus();throw error; }
    ui.phase='capture';ui.lastSuccess=`✓ Salida registrada: ${count} piezas. Puedes seguir escaneando.`;
    render();controller.focus();
  });
  const onStorage=event=>{if(event.key===queue.key&&current()){queue.stale=true;queue.confirmation=null;ui.phase='capture';render();}};
  window.addEventListener('storage',onStorage);
  queue.onChange=render;render();
  return ()=>{controller.destroy();window.removeEventListener('storage',onStorage);queue.onChange=()=>{};stopScanner();};
}
