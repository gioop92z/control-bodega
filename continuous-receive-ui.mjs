import {wireReceivingInput} from './receiving-input.mjs?v=5.12.3';
import {receiptCsv} from './continuous-receive.mjs?v=5.12.3';
import {captureMethodLabel} from './receiving-audit.mjs?v=5.8.3';

const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = value => Number(value).toLocaleString('es-MX');
const short = code => String(code || '').replace(/^ZAP-/, '');
const labels = {queued:'Por guardar',sending:'Guardando…',uncertain:'Por confirmar',confirmed:'Guardado',failed:'No registrado',cancelled:'Cancelado'};

export function mountContinuousReceive(root,queue,{startScanner,stopScanner,isCurrent=()=>true,onLegacy=()=>{},onUnavailable=()=>{},onEvidence=()=>{},onEvidenceConfirmed=()=>{}}) {
  let destroyed=false,frame=null,camera=false,opening=false,audio=null,lastSignal='',notice='',feedbackTimer=null,toastTimer=null,wake=null,confirmedVisit=null;
  const $=id=>root.querySelector('#'+id);
  const current=()=>!destroyed && root.isConnected && isCurrent();
  const ready=()=>current() && queue.canScan;
  root.innerHTML=`<section class="continuous-receive" aria-label="Recibir mercancía">
    <div class="cr-heading"><div><span class="cr-brand">VANTIS <i>·</i> Escaneo activo</span><span class="cr-department">${esc(queue.actor)}</span></div><button id="crFinish" type="button" class="ghost">Finalizar</button></div>
    <section class="cr-stage"><span id="crLocationLabel" class="cr-kicker">Marbete requerido</span><strong id="crLocation" class="cr-location">Sin asignar</strong><h1 id="crInstruction">Escanea primero un marbete</h1><p id="crLocationState"></p>
      <div class="cr-counters"><div><strong id="crVisitCount">0</strong><span>Piezas en marbete</span></div><div><strong id="crTotalCount">0</strong><span>Confirmadas en sesión</span></div></div>
      <form id="crScanForm" autocomplete="off"><label class="sr-only" for="crScan">Lectura del escáner portátil, marbete, SKU o UPC</label><input id="crScan" type="text" inputmode="text" enterkeyhint="done" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Escanea un marbete o una pieza" aria-describedby="crSync"></form>
      <div class="cr-indicators"><span id="crDevice">Lector portátil listo</span><span id="crSync" role="status" aria-live="polite">Comprobando servidor…</span><button id="crCameraButton" type="button" class="secondary">Cámara</button></div><p id="crPhotoStatus" class="cr-photo-status" role="status" aria-live="polite"></p>
    </section>
    <div id="crFeedback" class="cr-feedback" role="status" aria-live="polite" hidden></div>
    <div id="crPendingLocation" class="cr-pending-location" hidden><div><b id="crPendingLocationCount">0 piezas esperando ubicación</b><small>Escanea el marbete correspondiente para vincular estas lecturas anteriores.</small></div></div>
    <div id="crError" class="cr-error" role="alert" hidden></div><div id="crNotice" class="cr-notice" role="status" aria-live="polite"></div>
    <section id="crLast" class="cr-last" aria-live="polite"><span>Última lectura</span><strong>Listo para comenzar</strong><small>Las piezas se guardan automáticamente en el marbete activo.</small></section>
    <details id="crReview" class="cr-review" hidden>
      <summary>Revisar lecturas</summary>
      <section id="crPendingReview" class="cr-pending-review" aria-label="Lecturas pendientes" hidden>
        <div class="cr-pending-title"><h2>Lecturas pendientes</h2><span id="crPendingBadge">0</span></div>
        <p>Solo se suman las piezas confirmadas.</p>
        <div id="crPendingRows" class="cr-pending-rows"></div><div class="cr-pending-actions"><button id="crResetPending" type="button" class="ghost">Cancelar lecturas sin enviar</button></div>
      </section>
      <section class="cr-history"><div class="cr-section-title"><h2>Últimos registros</h2><button id="crUndo" type="button" class="ghost">Deshacer último registro</button></div><div id="crRows"></div></section>
    </details>
    <section id="crSummary" class="cr-overlay" role="dialog" aria-modal="true" aria-labelledby="crSummaryTitle" hidden><div class="cr-dialog cr-summary"><h2 id="crSummaryTitle">Resumen de recepción</h2><div id="crSummaryBody"></div>
      <div id="crSummaryPending" class="cr-summary-pending" hidden></div>
      <div class="quick-row"><button id="crDownload" type="button" class="primary">Descargar reporte CSV</button><button id="crDownloadJson" type="button" class="secondary">Respaldo JSON</button></div><div class="quick-row"><button id="crResume" type="button" class="secondary">Volver al escaneo</button><button id="crNewSession" type="button" class="ghost">Nueva recepción</button><button id="crLegacy" type="button" class="ghost">Recepción por lote</button></div></div></section>
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
  function scan(code,details={}) {
    notice='';
    try {
      const source=details?.source||'scanner';
      const result=queue.scan(code,{source});
      if(result.type==='piece'&&source==='camera')onEvidence(result.id,code,details?.frame??null);
      if(result.type==='piece'){
        const status='Lectura '+code+' · '+result.location+' · pendiente de confirmación';
        feedback(status,'info');
        return status;
      }
      const pending=Boolean(queue.state.candidate);
      const status=(pending?'Marbete detectado · guardando · ':'✓ Marbete activo · ')+result.location;
      feedback(status,pending?'info':'success');
      return status;
    } finally {scheduleRender();}
  }
  function scheduleRender() {if(frame===null&&current())frame=requestAnimationFrame(()=>{frame=null;render();});}
  let lastRowMarkup='',lastRowsMarkup='',lastSummaryMarkup='',lastPendingMarkup='',lastModalPending='';
  const pendingMarkup=(rows,allowCancel)=>rows.slice(0,30).map(row=>
    '<article class="cr-pending-item"><div><b>'+esc(row.descripcion||row.code)+'</b>'+
    '<span>'+esc(row.sku)+' · '+esc(short(row.marbete)||'Sin marbete')+' · '+esc(row.status==='uncertain'?'Por verificar':row.canSync?'Por confirmar':'Sin enviar')+'</span>'+
    (row.error?'<span>'+esc(row.error)+'</span>':'')+'</div>'+
    (allowCancel&&row.status==='queued'&&row.attempts===0
      ?'<button class="cr-cancel-row ghost" type="button" data-cancel-id="'+esc(row.id)+'" aria-label="Cancelar lectura '+esc(row.code)+'">Cancelar</button>'
      :'<span class="cr-pending-state">'+esc(row.status==='uncertain'?'Verificar':'En proceso')+'</span>')+'</article>').join('')+
    (rows.length>30?'<p>Hay '+num(rows.length-30)+' lecturas adicionales en el respaldo JSON.</p>':'');
  const stamp=row=>'<span class="cr-badge cr-'+row.status+'">'+esc(labels[row.status])+'</span>';
  const method=row=>row.kind==='undo'?'Compensación':captureMethodLabel(row.captureMethod);
  const photoState=row=>row.captureMethod==='camera'?(row.evidenceStatus==='local'?' · Foto guardada en dispositivo':row.evidenceStatus==='failed'?' · Sin foto (revisar)':' · Foto pendiente'):'';
  function render() {
    if(!current())return;
    const report=queue.report(),active=queue.state.candidate||queue.state.active,pending=Boolean(queue.state.candidate);
    const pendingRows=report.pending?queue.pendingDetails():[];
    $('crReview').hidden=!queue.rows.length;
    const pendingPanel=$('crPendingReview');
    pendingPanel.hidden=!pendingRows.length;
    $('crPendingBadge').textContent=num(pendingRows.length);
    $('crResetPending').disabled=!queue.owned||!queue.rows.some(row=>row.kind==='receive'&&row.status==='queued'&&row.attempts===0&&!row.payload);
    const pendingHtml=pendingMarkup(pendingRows,true);
    if(pendingHtml!==lastPendingMarkup){$('crPendingRows').innerHTML=pendingHtml;lastPendingMarkup=pendingHtml;}
    const modalPending=$('crSummaryPending');
    modalPending.hidden=!pendingRows.length;
    const modalHtml=pendingRows.length?'<h3>Lectura'+(pendingRows.length===1?'':'s')+' pendiente'+(pendingRows.length===1?'':'s')+': '+num(pendingRows.length)+'</h3>'+
      '<p>Las piezas se suman cuando el servidor confirma el guardado.</p>'+pendingMarkup(pendingRows,false):'';
    if(modalHtml!==lastModalPending){modalPending.innerHTML=modalHtml;lastModalPending=modalHtml;}
    $('crLocationLabel').textContent=queue.backend==='denied'?'Guardado bloqueado':pending?'Marbete detectado':active?'Marbete activo':'Marbete requerido';
    $('crLocation').textContent=active?.code||'Sin asignar';
    $('crLocation').dataset.state=pending?'pending':active?'active':'';
    $('crInstruction').textContent=active?'Escanea la siguiente pieza':'Escanea primero un marbete';
    $('crLocationState').textContent=queue.backend==='denied'?'No escanees más: el servidor rechazó el guardado. Conservamos las lecturas anteriores en este dispositivo.':pending?'Ubicación reconocida. Las piezas siguientes se asociarán aquí cuando el servidor confirme el guardado.'
      :active?'Otro marbete cambia la ubicación automáticamente.'
      :'Después del marbete, escanea el SKU o UPC de cada pieza.';
    if(active&&!pending&&active.visitId!==confirmedVisit){
      confirmedVisit=active.visitId;
      feedback('✓ Marbete activo · '+active.code);
    }
    $('crVisitCount').textContent=num(report.visitPieces);$('crTotalCount').textContent=num(report.totalPieces);
    $('crPendingLocation').hidden=!report.awaitingLocation||Boolean(active);
    $('crPendingLocationCount').textContent=num(report.awaitingLocation)+' pieza'+(report.awaitingLocation===1?'':'s')+' esperando ubicación';
    $('crScan').disabled=!ready();
    $('crDevice').textContent=camera?'Cámara activa · QR y barras':opening?'Abriendo cámara…':lastSignal?'Lector portátil · última señal '+lastSignal:'Lector portátil listo';
    $('crCameraButton').textContent=camera?'Cerrar cámara':'Cámara';$('crCameraButton').disabled=opening||(!ready()&&!camera);
    const connected=queue.online();
    const storageStatus=queue.storageError||['missing','invalid','denied'].includes(queue.backend)?'Guardado no disponible'
      :queue.backend==='checking'?'Comprobando servidor…'
      :!connected?'Sin conexión · Guardado local'
      :queue.backend==='offline'?(queue.api.mode==='local'?'Almacenamiento local no disponible':'Recuperando conexión…'):(queue.api.mode==='local'?'Guardado local automático':'Guardado automático');
    const pendingStatus=report.pending?' · '+num(report.pending)+(report.pending===1?' pendiente':' pendientes'):'';
    $('crSync').textContent=storageStatus+pendingStatus+(report.failed?' · '+num(report.failed)+' sin registrar':'');
    $('crSync').className=report.pending?'cr-pending-text':'cr-confirmed-text';
    $('crSync').dataset.connection=queue.backend==='checking'?'checking':(!connected||queue.backend==='offline')?'offline':report.pending?'pending':'online';
    $('crError').hidden=!(queue.error||queue.storageError);$('crError').textContent=queue.storageError||queue.error;
    $('crNotice').textContent=notice;
    const last=queue.rows.at(-1);
    if(last){const markup='<span>Última lectura '+(last.kind==='undo'?'· COMPENSACIÓN':'')+'</span><strong>'+esc(last.product?.descripcion||last.code)+'</strong><small>'+(last.product?'SKU ':'Código ')+esc(last.product?.sku||last.code)+' · '+esc(short(last.location)||'SIN UBICACIÓN')+' · '+esc(method(last))+esc(photoState(last))+'</small>'+stamp(last)+(last.error?'<small>'+esc(last.error)+'</small>':'');
      if(markup!==lastRowMarkup){$('crLast').innerHTML=markup;lastRowMarkup=markup;}
    }
    const rowsMarkup=queue.rows.length?queue.rows.slice(-8).reverse().map(row=>'<article class="cr-row"><div><b>'+esc(row.product?.descripcion||row.code)+'</b><small>'+esc(row.product?.sku||row.code)+' · '+esc(short(row.location)||'SIN UBICACIÓN')+(row.kind==='undo'?' · Deshacer':'')+' · '+esc(method(row))+esc(photoState(row))+'</small>'+(row.error?'<small class="txt-red">'+esc(row.error)+'</small>':'')+'</div><div>'+(row.status==='confirmed'?'<strong>'+(row.kind==='undo'?'−1':'+1')+'</strong>':'')+stamp(row)+'</div></article>').join(''):'<p class="muted">Aquí aparecerán las piezas escaneadas.</p>';
    if(rowsMarkup!==lastRowsMarkup){$('crRows').innerHTML=rowsMarkup;lastRowsMarkup=rowsMarkup;}
    // Undo eligibility is linear, even after tens of thousands of pieces.
    const reversed=new Set();
    for(const row of queue.rows)if(row.reverses&&row.status!=='failed')reversed.add(row.reverses);
    let canUndo=false;
    for(let i=queue.rows.length-1;i>=0;i--){
      const row=queue.rows[i];
      if(row.kind==='receive'&&row.location&&row.status==='confirmed'&&!reversed.has(row.id)){canUndo=row.writeMode!=='legacy';break;}
    }
    $('crUndo').disabled=queue.compatibility||!ready()||!canUndo;
    $('crUndo').title=queue.compatibility?'Deshacer automático disponible al activar la migración segura.':'Deshacer la última entrada confirmada';
    $('crFinish').disabled=!queue.owned||Boolean(queue.state.pendingLabels?.length)||Boolean(queue.state.pendingSwitch);
    $('crLegacy').disabled=queue.busy||Boolean(queue.pending)||Boolean(queue.state.pendingLabels?.length)||Boolean(queue.state.pendingSwitch);
    $('crSummary').hidden=!queue.state.endedAt;
    if(queue.state.endedAt) {
      const summaryMarkup='<strong class="cr-summary-count">'+num(report.totalPieces)+' piezas confirmadas</strong><p>'+num(report.locations.filter(row=>row.marbete).length)+' marbetes · '+num(report.confirmed)+' movimientos confirmados · '+num(report.pending)+' pendientes · '+num(report.failed)+' fallidos</p><p><b>'+esc(report.actor)+'</b><br>Inicio: '+esc(new Date(report.startedAt).toLocaleString('es-MX'))+'<br>Fin: '+esc(new Date(report.endedAt).toLocaleString('es-MX'))+'</p><table><thead><tr><th>Marbete</th><th>Piezas</th><th>Pendientes</th><th>Fallidos</th></tr></thead><tbody>'+report.locations.map(row=>'<tr><td>'+esc(short(row.marbete)||'SIN UBICACIÓN')+'</td><td>'+num(row.pieces)+'</td><td>'+num(row.pending)+'</td><td>'+num(row.failed)+'</td></tr>').join('')+'</tbody></table>';
      if(summaryMarkup!==lastSummaryMarkup){$('crSummaryBody').innerHTML=summaryMarkup;lastSummaryMarkup=summaryMarkup;}
      $('crNewSession').disabled=Boolean(report.pending)||queue.busy;
      $('crNewSession').title=report.pending?'Espera a que se guarden las lecturas pendientes.':queue.busy?'Esperando al servidor.':'';
    }
  }
  $('crScanForm').onsubmit=event=>{event.preventDefault();input.flush('manual');};
  async function openCamera() {
    if(opening||camera||!ready())return;
    unlockSound();opening=true;render();
    try {
      await startScanner((code,photo)=>{
        if(!ready())throw Error('Lectura en pausa. Reanuda la recepción.');
        return scan(code,{source:'camera',frame:photo});
      },'marbete o mercancía',{
        continuous:true,qrEnabled:true,captureEvidence:true,acknowledgedOnly:true,allowRepeat:false,
        onClose:()=>{camera=false;opening=false;render();input.focus();}
      });
      camera=true;
    } catch(error) {
      fail(Error('No se pudo abrir la cámara. Revisa los permisos o utiliza el lector portátil.'));
    } finally {opening=false;render();}
  }
  $('crCameraButton').onclick=()=>{
    if(camera)stopScanner();
    else void openCamera();
  };
  $('crUndo').onclick=()=>{try{queue.undoLast();notice='Compensación pendiente de confirmación.';render();input.focus();}catch(error){fail(error);}};
  $('crPendingRows').addEventListener('click',event=>{
    const button=event.target.closest('button[data-cancel-id]');
    if(!button)return;
    if(!window.confirm('¿Cancelar esta lectura sin enviar?'))return;
    try{queue.cancelPending(button.dataset.cancelId);feedback('Lectura cancelada','info');render();}
    catch(error){fail(error);}
  });
  $('crResetPending').onclick=()=>{
    const count=queue.rows.filter(row=>row.kind==='receive'&&row.status==='queued'&&row.attempts===0&&!row.payload).length;
    if(!count||!window.confirm('¿Cancelar '+count+' lectura(s) que aún no se han enviado? Las que pudieron llegar al servidor se conservarán.'))return;
    try{queue.resetUnsent();feedback('Pendientes sin enviar cancelados','info');render();}
    catch(error){fail(error);}
  };
  $('crFinish').onclick=()=>{
    input.flush();
    try{queue.finish();stopScanner();render();$('crResume').focus();}
    catch(error){if(queue.pending)$('crReview').open=true;fail(error);}
  };
  $('crResume').onclick=()=>{
    $('crReview').open=false;queue.resume();render();
    input.focus();
  };
  $('crNewSession').onclick=()=>{try{queue.newSession();$('crReview').open=false;render();input.focus();}catch(error){fail(error);}};
  $('crLegacy').onclick=onLegacy;
  function download(json=false) {
    const report=queue.report(),blob=new Blob([json?JSON.stringify(report,null,2):receiptCsv(report)],{type:json?'application/json':'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='VANTIS-recepcion-'+report.sessionId+'.'+(json?'json':'csv');link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('crDownload').onclick=()=>download();$('crDownloadJson').onclick=()=>download(true);
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
    const codeType=row.product?.sku===row.code?'SKU':'UPC';
    const status=row.kind==='undo'?'✓ Compensación confirmada':'✓ '+codeType+' '+row.code+' · '+row.location+' · pieza confirmada';
    beep(true);feedback(status);root.classList.add('cr-success');clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>root.classList.remove('cr-success'),160);scheduleRender();
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
