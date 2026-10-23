import {wireReceivingInput} from './receiving-input.mjs?v=3.10.0';
import {receiptCsv} from './continuous-receive.mjs?v=3.10.0';

const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = value => Number(value).toLocaleString('es-MX');
const short = code => String(code || '').replace(/^ZAP-/, '');
const labels = {queued:'Pendiente de sincronización',sending:'Guardando…',uncertain:'Por confirmar · reintento seguro',confirmed:'Confirmado en servidor',failed:'No registrado'};

export function mountContinuousReceive(root,queue,{startScanner,stopScanner,isCurrent=()=>true,onLegacy=()=>{},onUnavailable=()=>{},onEvidence=()=>{},onEvidenceConfirmed=()=>{}}) {
  let destroyed=false,frame=null,camera=false,opening=false,resumeAfterSwitch=false,audio=null,lastSignal='',notice='',feedbackTimer=null,toastTimer=null,wake=null;
  const $=id=>root.querySelector('#'+id);
  const current=()=>!destroyed && root.isConnected && isCurrent();
  const ready=()=>current() && queue.canScan;
  root.innerHTML=`<section class="continuous-receive" aria-label="Recibir mercancía">
    <div class="cr-heading"><div><span class="cr-brand">VANTIS <i>|</i> ESCANEO ACTIVO</span><span class="cr-department">${esc(queue.actor)}</span></div><button id="crFinish" type="button" class="ghost">Finalizar recepción</button></div>
    <section class="cr-stage"><span id="crLocationLabel" class="cr-kicker">MARBETE ACTIVO</span><strong id="crLocation" class="cr-location">—</strong><h1 id="crInstruction">ESCANEA UN SKU O UN MARBETE</h1><p id="crLocationState"></p>
      <div class="cr-counters"><div><strong id="crVisitCount">0</strong><span>PIEZAS EN ESTE MARBETE</span></div><div><strong id="crTotalCount">0</strong><span>TOTAL CONFIRMADO EN SESIÓN</span></div></div>
      <form id="crScanForm" autocomplete="off"><label class="sr-only" for="crScan">Lectura del escáner portátil, marbete, SKU o UPC</label><input id="crScan" type="text" inputmode="text" enterkeyhint="done" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Escanea o escribe marbete, SKU o UPC" aria-describedby="crSync"><button id="crKeyboard" class="ghost" type="button" aria-label="Abrir teclado para escribir un código">⌨ Escribir</button></form>
      <div class="cr-indicators"><span id="crDevice">Captura preparada para lector portátil</span><span id="crSync" role="status" aria-live="polite">Comprobando servidor…</span><button id="crCameraButton" type="button" class="secondary">Cámara</button></div><p id="crPhotoStatus" class="cr-photo-status" role="status" aria-live="polite"></p>
    </section>
    <div id="crFeedback" class="cr-feedback" role="status" aria-live="polite" hidden></div>
    <section id="crPendingReview" class="cr-pending-review" aria-label="Lecturas pendientes" hidden>
      <div class="cr-pending-title"><div><small>PENDIENTE DE CONFIRMACIÓN</small><h2>Lecturas por resolver</h2></div><span id="crPendingBadge">0</span></div>
      <p>Estas piezas todavía <b>no cuentan como confirmadas</b>. El folio queda guardado en el dispositivo.</p>
      <div id="crPendingRows" class="cr-pending-rows"></div>
      <div class="cr-pending-actions"><button id="crPendingRetry" type="button" class="primary">Reintentar sincronización</button><button id="crPendingBackup" type="button" class="secondary">Guardar respaldo JSON</button></div>
    </section>
    <div id="crPendingLocation" class="cr-pending-location" hidden><div><b id="crPendingLocationCount">0 piezas esperando ubicación</b><small>Escanea un marbete y se vincularán automáticamente, o guárdalas sin ubicación.</small></div><button id="crSaveWithoutLocation" type="button" class="secondary">Registrar sin marbete</button></div>
    <div id="crError" class="cr-error" role="alert" hidden></div><div id="crNotice" class="cr-notice" role="status" aria-live="polite"></div>
    <section id="crLast" class="cr-last" aria-live="polite"><span>ÚLTIMA LECTURA</span><strong>Listo para comenzar</strong><small>El contador aumenta al recibir confirmación real del servidor.</small></section>
    <section class="cr-history"><div class="cr-section-title"><h2>Últimos registros</h2><button id="crUndo" type="button" class="ghost">Deshacer último registro</button></div><div id="crRows"></div></section>
    <div class="cr-tools"><button id="crRetry" type="button" class="secondary">Sincronizar ahora</button><button id="crRetryFailed" type="button" class="ghost" hidden>Reintentar fallidos</button><button id="crLegacy" type="button" class="ghost">Recepción por lote</button></div>
    <section id="crSwitch" class="cr-overlay" role="dialog" aria-modal="true" aria-labelledby="crSwitchTitle" hidden><div class="cr-dialog"><span class="cr-kicker">NUEVA UBICACIÓN DETECTADA</span><h2 id="crSwitchTitle">¿CAMBIAR DE MARBETE?</h2><p>Marbete actual: <b id="crOld"></b></p><p>Nuevo marbete: <b id="crNew"></b></p><button id="crConfirmSwitch" type="button" class="primary">Confirmar cambio</button><button id="crCancelSwitch" type="button" class="secondary">Cancelar y continuar en el anterior</button></div></section>
    <section id="crSummary" class="cr-overlay" role="dialog" aria-modal="true" aria-labelledby="crSummaryTitle" hidden><div class="cr-dialog cr-summary"><h2 id="crSummaryTitle">Resumen de recepción</h2><div id="crSummaryBody"></div>
      <div id="crSummaryPending" class="cr-summary-pending" hidden></div>
      <button id="crSummaryRetry" type="button" class="primary" hidden>Reintentar sincronización de pendientes</button>
      <div class="quick-row"><button id="crDownload" type="button" class="primary">Descargar reporte CSV</button><button id="crDownloadJson" type="button" class="secondary">Respaldo JSON</button></div><div class="quick-row"><button id="crResume" type="button" class="secondary">Volver al escaneo / revisar</button><button id="crNewSession" type="button" class="ghost">Nueva recepción</button></div></div></section>
  </section>`;

  const input=wireReceivingInput({input:$('crScan'),active:ready,onCode:scan,onError:fail,onActivity:()=>{lastSignal=new Date().toLocaleTimeString('es-MX');unlockSound();}});
  function unlockSound() {
    try {audio ||= new (window.AudioContext || window.webkitAudioContext)();void audio.resume();} catch {}
  }
  function beep(ok) {
    if (!audio || audio.state!=='running') return;
    try {const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.connect(gain);gain.connect(audio.destination);
      oscillator.frequency.value=ok?1046:220;gain.gain.value=.045;oscillator.start();gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.10);oscillator.stop(audio.currentTime+.12);}catch{}
  }
  function feedback(message,tone='success') {
    const node=$('crFeedback');if(!node||!current())return;
    clearTimeout(toastTimer);node.textContent=message;node.dataset.tone=tone;node.hidden=false;
    toastTimer=setTimeout(()=>{node.hidden=true;},2100);
  }
  function fail(error) {notice=error?.message||String(error);beep(false);feedback(notice,'error');render();}
  function scan(code,frame=null) {
    notice='';
    try {
      const result=queue.scan(code);
      if(result.type==='piece'&&frame)onEvidence(result.id,code,frame);
      if(result.type==='switch'){feedback('Confirma el cambio de marbete','info');queueMicrotask(()=>$('crConfirmSwitch')?.focus());}
      else if(result.type!=='piece')feedback('Validando marbete…','info');
      if(result.type==='piece'&&!queue.state.active&&!queue.state.candidate)feedback('✓ SKU conservado. Escanea un marbete o registra sin ubicación.','info');
      return result.type==='piece'?'Lectura protegida · pendiente de confirmación':result.type==='switch'?'Confirma el cambio de marbete':'Marbete en validación';
    } catch(error) {fail(error);throw error;}
    finally {scheduleRender();}
  }
  function scheduleRender() {if(frame===null&&current())frame=requestAnimationFrame(()=>{frame=null;render();});}
  let lastRowMarkup='',lastRowsMarkup='',lastSummaryMarkup='',lastPendingMarkup='',lastModalPending='';
  const pendingReason=row=>{
    if(row.status==='sending')return 'El servidor está procesando esta lectura.';
    if(row.status==='uncertain')return 'Sin confirmación del servidor. No vuelvas a escanear la misma pieza: se conciliará con su folio original.';
    if(!row.canSync)return 'Falta asignar un marbete o autorizar recepción sin ubicación.';
    if(row.error)return row.error;
    if(queue.backend==='offline'||!queue.online())return 'Conexión no confirmada. Puedes volver a intentar cuando haya señal.';
    return 'Lectura protegida, esperando respuesta del servidor.';
  };
  const pendingMarkup=rows=>rows.slice(0,30).map(row=>
    '<article class="cr-pending-item"><div><b>'+esc(row.descripcion||row.code)+'</b>'+
    '<span>SKU / código: '+esc(row.sku)+' · Marbete: '+esc(short(row.marbete)||'SIN UBICACIÓN')+
    ' · '+esc(new Date(row.capturedAt).toLocaleString('es-MX'))+'</span>'+
    '<small>'+esc(pendingReason(row))+'</small></div>'+
    '<span class="cr-pending-state">'+esc(labels[row.status]||row.status)+'</span></article>').join('')+
    (rows.length>30?'<p>Hay '+num(rows.length-30)+' lecturas adicionales en el respaldo JSON.</p>':'');
  const stamp=row=>'<span class="cr-badge cr-'+row.status+'">'+esc(labels[row.status])+'</span>';
  function render() {
    if(!current())return;
    const report=queue.report(),active=queue.state.candidate||queue.state.active,pending=Boolean(queue.state.candidate);
    const pendingRows=queue.pendingDetails?.()||queue.rows.filter(x=>!['confirmed','failed'].includes(x.status)).map(x=>({...x,sku:x.product?.sku||x.code,marbete:x.location,canSync:!!(x.location||x.unlocatedApproved)}));
    const pendingPanel=$('crPendingReview');
    pendingPanel.hidden=!pendingRows.length;
    $('crPendingBadge').textContent=num(pendingRows.length);
    const pendingHtml=pendingMarkup(pendingRows);
    if(pendingHtml!==lastPendingMarkup){$('crPendingRows').innerHTML=pendingHtml;lastPendingMarkup=pendingHtml;}
    const modalPending=$('crSummaryPending');
    modalPending.hidden=!pendingRows.length;
    const modalHtml=pendingRows.length?'<h3>Lectura'+(pendingRows.length===1?'':'s')+' pendiente'+(pendingRows.length===1?'':'s')+': '+num(pendingRows.length)+'</h3>'+
      '<p>Revisa el código, marbete y motivo. Estas piezas no se sumarán al confirmado hasta recibir acuse de Supabase.</p>'+pendingHtml:'';
    if(modalHtml!==lastModalPending){modalPending.innerHTML=modalHtml;lastModalPending=modalHtml;}
    $('crSummaryRetry').hidden=!pendingRows.length;
    $('crSummaryRetry').disabled=!queue.owned||queue.busy||Boolean(queue.storageError);
    $('crPendingRetry').disabled=!queue.owned||queue.busy||Boolean(queue.storageError);
    $('crLocationLabel').textContent=pending?'MARBETE POR VALIDAR':active?'MARBETE ACTIVO':'UBICACIÓN OPCIONAL';
    $('crLocation').textContent=active?short(active.code):'—';
    $('crInstruction').textContent=active?'ESCANEA LA SIGUIENTE PIEZA':'ESCANEA SKU O MARBETE PARA COMENZAR';
    $('crLocationState').textContent=queue.compatibility
      ? 'Cada lectura confirma una pieza en el historial. Si la red falla, queda protegida para revisión.'
      : pending?'Las lecturas quedarán pendientes hasta validar esta ubicación.':active?'Cada lectura registra una unidad en esta ubicación.':'Empieza por el SKU o el cajón. Si el SKU va primero, se conserva hasta asignarle ubicación o registrarlo sin marbete.';
    $('crVisitCount').textContent=num(report.visitPieces);$('crTotalCount').textContent=num(report.totalPieces);
    $('crPendingLocation').hidden=!report.awaitingLocation||Boolean(active);
    $('crPendingLocationCount').textContent=num(report.awaitingLocation)+' pieza'+(report.awaitingLocation===1?'':'s')+' esperando ubicación';
    $('crSaveWithoutLocation').disabled=!ready()||!report.awaitingLocation;
    $('crScan').disabled=!ready();
    $('crDevice').textContent=camera?'Cámara activa · QR y barras':opening?'Abriendo cámara…':lastSignal?'Lector portátil · última señal '+lastSignal:'Captura preparada para lector portátil';
    $('crCameraButton').textContent=camera?'Cerrar cámara':'Cámara';$('crCameraButton').disabled=opening||(!ready()&&!camera);
    const unknown=queue.rows.filter(row=>row.kind==='receive'&&row.status==='queued'&&/pendiente de alta|pendiente de confirmar|SKU pendiente/i.test(row.error||'')).length;
    $('crSync').textContent=(queue.backend==='checking'?'Comprobando servidor · ':!queue.online()?'Sin conexión de red · ':queue.backend==='offline'?'Servidor sin respuesta · ':'')+num(report.confirmed)+' confirmados · '+num(report.pending)+' pendientes'+(unknown?' · '+num(unknown)+' SKUs por catalogar':'')+(report.failed?' · '+num(report.failed)+' fallidos':'');
    $('crSync').className=report.pending?'cr-pending-text':'cr-confirmed-text';
    $('crError').hidden=!(queue.error||queue.storageError);$('crError').textContent=queue.storageError||queue.error;
    $('crNotice').textContent=notice;
    const last=queue.rows.at(-1);
    if(last){const markup='<span>ÚLTIMA LECTURA '+(last.kind==='undo'?'· COMPENSACIÓN':'')+'</span><strong>'+esc(last.product?.descripcion||last.code)+'</strong><small>SKU '+esc(last.product?.sku||last.code)+' · '+esc(short(last.location)||'SIN UBICACIÓN')+'</small>'+stamp(last)+(last.error?'<small>'+esc(last.error)+'</small>':'');
      if(markup!==lastRowMarkup){$('crLast').innerHTML=markup;lastRowMarkup=markup;}
    }
    const rowsMarkup=queue.rows.length?queue.rows.slice(-8).reverse().map(row=>'<article class="cr-row"><div><b>'+esc(row.product?.descripcion||row.code)+'</b><small>'+esc(row.product?.sku||row.code)+' · '+esc(short(row.location)||'SIN UBICACIÓN')+(row.kind==='undo'?' · Deshacer':'')+'</small>'+(row.error?'<small class="txt-red">'+esc(row.error)+'</small>':'')+'</div><div><strong>'+(row.kind==='undo'?'−1':'+1')+'</strong>'+stamp(row)+'</div></article>').join(''):'<p class="muted">Aquí aparecerán las piezas escaneadas.</p>';
    if(rowsMarkup!==lastRowsMarkup){$('crRows').innerHTML=rowsMarkup;lastRowsMarkup=rowsMarkup;}
    // Undo eligibility is linear, even after tens of thousands of pieces.
    const reversed=new Set();
    for(const row of queue.rows)if(row.reverses&&row.status!=='failed')reversed.add(row.reverses);
    let canUndo=false;
    for(let i=queue.rows.length-1;i>=0;i--){
      const row=queue.rows[i];
      if(row.kind==='receive'&&row.location&&row.status==='confirmed'&&!reversed.has(row.id)){canUndo=true;break;}
    }
    $('crUndo').disabled=queue.compatibility||!ready()||!canUndo;
    $('crUndo').title=queue.compatibility?'Deshacer automático disponible al activar la migración segura.':'Deshacer la última entrada confirmada';
    $('crRetry').disabled=!queue.owned||queue.busy||Boolean(queue.storageError);
    $('crRetryFailed').hidden=!report.failed;$('crRetryFailed').disabled=!queue.owned||queue.busy;
    $('crFinish').disabled=!queue.owned||Boolean(queue.state.pendingSwitch);
    $('crLegacy').disabled=queue.busy||Boolean(queue.pending)||Boolean(queue.state.pendingSwitch);
    $('crSwitch').hidden=!queue.state.pendingSwitch;
    $('crOld').textContent=short(active?.code);$('crNew').textContent=short(queue.state.pendingSwitch?.code);
    $('crSummary').hidden=!queue.state.endedAt;
    if(queue.state.endedAt) {
      const summaryMarkup='<strong class="cr-summary-count">'+num(report.totalPieces)+' piezas confirmadas</strong><p>'+num(report.locations.filter(row=>row.marbete).length)+' marbetes · '+num(report.confirmed)+' movimientos confirmados · '+num(report.pending)+' pendientes · '+num(report.failed)+' fallidos</p><p><b>'+esc(report.actor)+'</b><br>Inicio: '+esc(new Date(report.startedAt).toLocaleString('es-MX'))+'<br>Fin: '+esc(new Date(report.endedAt).toLocaleString('es-MX'))+'</p>'+(report.pending?'<p class="cr-pending-text">La sesión conserva lecturas pendientes. Continúa la sincronización; estas piezas todavía no están confirmadas.</p>':'')+'<table><thead><tr><th>Marbete</th><th>Piezas</th><th>Pendientes</th><th>Fallidos</th></tr></thead><tbody>'+report.locations.map(row=>'<tr><td>'+esc(short(row.marbete)||'SIN UBICACIÓN')+'</td><td>'+num(row.pieces)+'</td><td>'+num(row.pending)+'</td><td>'+num(row.failed)+'</td></tr>').join('')+'</tbody></table>';
      if(summaryMarkup!==lastSummaryMarkup){$('crSummaryBody').innerHTML=summaryMarkup;lastSummaryMarkup=summaryMarkup;}
      $('crNewSession').disabled=Boolean(report.pending)||queue.busy;
      $('crNewSession').title=report.pending?'Hay lecturas sin confirmar. Sincronízalas antes de crear otra sesión: quedan protegidas en el diario.':queue.busy?'Esperando al servidor.':'';
    }
  }
  $('crScanForm').onsubmit=event=>{event.preventDefault();input.flush();};
  $('crSaveWithoutLocation').onclick=()=>{
    try{const count=queue.approveWithoutLocation();feedback(count+' pieza'+(count===1?'':'s')+' preparada'+(count===1?'':'s')+' para registrar sin ubicación','info');render();input.focus();}
    catch(error){fail(error);}
  };
  $('crKeyboard').onclick=()=>{const field=$('crScan');if(!ready())return;field.inputMode='text';field.blur();field.focus({preventScroll:true});};
  function resolveSwitch(accept) {
    const reopen=resumeAfterSwitch;resumeAfterSwitch=false;
    queue.confirmSwitch(accept);render();
    if(reopen)void openCamera();else input.focus();
  }
  $('crConfirmSwitch').onclick=()=>resolveSwitch(true);
  $('crCancelSwitch').onclick=()=>resolveSwitch(false);
  async function openCamera() {
    if(opening||camera||!ready())return;
    unlockSound();opening=true;render();
    try {
      await startScanner((code,photo)=>{
        if(!ready())throw Error('Lectura en pausa. Confirma el cambio o reanuda la recepción.');
        const message=scan(code,photo);
        if(queue.state.pendingSwitch){
          // The confirmation dialog is underneath the full-screen reader.
          // Close the camera only for this explicit, required confirmation.
          resumeAfterSwitch=true;
          queueMicrotask(()=>stopScanner());
        }
        return message;
      },'marbete o mercancía',{
        continuous:true,qrEnabled:true,captureEvidence:true,acknowledgedOnly:true,allowRepeat:false,
        onClose:()=>{camera=false;opening=false;render();if(!resumeAfterSwitch)input.focus();}
      });
      camera=true;
    } catch(error) {
      fail(Error('No se pudo abrir la cámara. Revisa los permisos o utiliza el lector portátil.'));
    } finally {opening=false;render();}
  }
  $('crCameraButton').onclick=()=>{
    if(camera){resumeAfterSwitch=false;stopScanner();}
    else void openCamera();
  };
  $('crUndo').onclick=()=>{try{queue.undoLast();notice='Compensación pendiente de confirmación.';render();input.focus();}catch(error){fail(error);}};
  async function retryNow(button){
    if(queue.busy){feedback('El servidor ya está procesando una lectura.','info');return;}
    if(!queue.owned){fail(Error('Recepción abierta en otra pestaña o sin acceso al diario local.'));return;}
    if(queue.storageError){fail(Error(queue.storageError));return;}
    button.disabled=true;notice='Comprobando conexión y conciliando los folios pendientes…';render();
    try{
      await queue.reconnect();
      const count=queue.report().pending;
      notice=count?count+' lectura(s) sin confirmar. Revisa la lista y conserva su folio.':'Todas las lecturas están conciliadas.';
      feedback(notice,count?'info':'success');
    }catch(error){fail(error);}
    finally{render();}
  }
  $('crRetry').onclick=()=>void retryNow($('crRetry'));
  $('crPendingRetry').onclick=()=>void retryNow($('crPendingRetry'));
  $('crSummaryRetry').onclick=()=>void retryNow($('crSummaryRetry'));
  $('crRetryFailed').onclick=()=>queue.retryFailures();
  $('crFinish').onclick=()=>{input.flush();try{queue.finish();stopScanner();render();$('crResume').focus();}catch(error){fail(error);}};
  $('crResume').onclick=()=>{
    queue.resume();render();
    if(queue.pending)$('crPendingReview')?.scrollIntoView?.({behavior:'smooth',block:'start'});
    else input.focus();
  };
  $('crNewSession').onclick=()=>{try{queue.newSession();render();input.focus();}catch(error){fail(error);}};
  $('crLegacy').onclick=onLegacy;
  function download(json=false) {
    const report=queue.report(),blob=new Blob([json?JSON.stringify(report,null,2):receiptCsv(report)],{type:json?'application/json':'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='VANTIS-recepcion-'+report.sessionId+'.'+(json?'json':'csv');link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('crDownload').onclick=()=>download();$('crDownloadJson').onclick=()=>download(true);
  $('crPendingBackup').onclick=()=>download(true);
  const beforeUnload=event=>{if(queue.pending||queue.selecting){event.preventDefault();event.returnValue='';}};
  const online=()=>{void queue.reconnect().catch(fail);};
  const offline=()=>render();
  const visible=()=>{if(document.visibilityState==='visible'){input.focus();if(queue.pending)online();void requestWake();}};
  async function requestWake() {try{if(navigator.wakeLock&&!queue.state.endedAt)wake=await navigator.wakeLock.request('screen');}catch{}}
  const gesture=()=>{unlockSound();void requestWake();};
  window.addEventListener('beforeunload',beforeUnload);window.addEventListener('online',online);window.addEventListener('offline',offline);
  document.addEventListener('visibilitychange',visible);root.addEventListener('pointerdown',gesture,{once:true});
  queue.onChange=scheduleRender;
  queue.onFailure=row=>{notice=row.error;beep(false);feedback(row.error||'No se pudo confirmar esta pieza','error');scheduleRender();};
  queue.onConfirmed=row=>{
    onEvidenceConfirmed(row);
    beep(true);feedback('✓ Pieza registrada en servidor');root.classList.add('cr-success');clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>root.classList.remove('cr-success'),160);scheduleRender();
  };
  // Tras reabrir la recepción, reintenta imágenes locales de movimientos confirmados.
  queue.rows.filter(row=>row.kind==='receive'&&row.status==='confirmed').forEach(onEvidenceConfirmed);
  render();void queue.start().then(()=>{
    if(current()&&queue.backend==='missing'&&!queue.rows.length){onUnavailable();return;}
    render();input.focus();
  });
  return ()=>{
    destroyed=true;if(frame!==null)cancelAnimationFrame(frame);clearTimeout(feedbackTimer);clearTimeout(toastTimer);input.destroy();stopScanner();void queue.dispose();
    window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('online',online);window.removeEventListener('offline',offline);
    document.removeEventListener('visibilitychange',visible);void wake?.release();void audio?.close();queue.onConfirmed=()=>{};queue.onFailure=()=>{};
  };
}
