import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { vantisBackendConfig } from './vantis-backend-config.mjs?v=4.0.2';
// Excel loads only when requested; routine scanning must not wait for a large XLSX bundle.
let spreadsheetPromise=null;
function getSpreadsheet(){
  spreadsheetPromise ||= import('https://esm.sh/xlsx@0.18.5')
    .catch(error=>{spreadsheetPromise=null;throw error;});
  return spreadsheetPromise;
}
import { startScanner, stopScanner } from './scanner.js?v=5.1.1';
import { getMarbete, normalizeMarbete, parseMarbeteScan, assignProductLocation, registerMarbete, locationQuery } from './product-location.mjs?v=3.9.5';
import { FastExitQueue } from './exit-queue.mjs?v=3.8.0';
import { mountFastExit } from './exit-queue-ui.mjs?v=3.8.0';
import { ReceiveQueue } from './receive-queue.mjs?v=3.9.5';
import { mountFastReceive } from './receive-queue-ui.mjs?v=3.9.5';
import { ContinuousReceive, SupabaseReceiptApi } from './continuous-receive.mjs?v=5.1.0';
import { mountContinuousReceive } from './continuous-receive-ui.mjs?v=5.1.0';
import { mountOperations } from './operations-v4.mjs?v=5.0.0';
import { ScanEvidence, listSkuEvidence, listLocalSkuEvidence } from './scan-evidence.mjs?v=5.1.1';
import { lookupPublicCatalog, publicSearchUrl } from './catalog-hybrid.mjs?v=5.3.0';
import { liverpoolPreview } from './catalog-visual.mjs?v=5.3.0';

const sb = createClient(
  vantisBackendConfig.url,
  vantisBackendConfig.key,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

const app = document.getElementById('app');
const $ = id => document.getElementById(id);
const esc = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const APP_VERSION = '5.3.0';
const VISUAL_CLEANUP_CUTOFF = '2026-09-28T05:38:00.000Z';
const HISTORY_RESTART_CUTOFF = '2026-10-15T22:15:00.000Z';

const S = {
  user: null,
  access: null,
  admin: false,
  staff: false,
  displayName: '',
  depts: [],
  deptId: null,
  view: 'home',
  moveType: 'ENTRADA',
  product: null,
  locations: [],
  searchResult: null,
  searchType: null,
  evidencePhotos: [],
  evidenceStatus: 'idle',
  externalStatus: 'idle',
  externalProduct: null,
  externalPreview: null,
  externalCountdown: 8,
  count: null,
  importHeaders: [],
  importRows: [],
  importMap: { sku:'', upc:'', descripcion:'', marca:'', talla:'', color:'', precio:'', stock:'', minimo:'' }
};

let locationAssignment = null;
let locationSaveNotice = null;
let searchRequest = 0;
let searchPending = false;
let lastSearchCode = '';
let exitQueue = null;
let exitCleanup = null;
let receiveQueue = null;
let receiveCleanup = null;
let continuousQueue = null;
let continuousCleanup = null;
let floatingReceiveElement=null,floatingReceiveFocus=null,floatingReceiveKeydown=null;
let operationsCleanup=null;
let photoEvidenceService=null;
let catalogCountdownTimer=null;
const catalogBackgroundQueue=[];
const catalogBackgroundSeen=new Set();
let catalogBackgroundTimer=null;
// Nunca detiene el lector ni modifica stock: precarga solo nuevos SKU sin descripción.
function prefetchUnknownCatalog(product){
  if(navigator.onLine===false||!product?.sku)return;
  const name=String(product.descripcion||'').toLowerCase().trim();
  const unknown=!name||/^(sku|producto sin|desconocido|pendiente|sin descripci[oó]n)/i.test(name)||name===String(product.sku).toLowerCase();
  if(!unknown||catalogBackgroundSeen.has(product.sku))return;
  if(catalogBackgroundQueue.length>=30)return; // evita colas descontroladas en recepciones masivas
  catalogBackgroundSeen.add(product.sku);
  if(catalogBackgroundSeen.size>500)catalogBackgroundSeen.clear();
  catalogBackgroundQueue.push([product.sku,product.upc]);
  if(!catalogBackgroundTimer)catalogBackgroundTimer=setTimeout(drainUnknownCatalog,1000);
}
async function drainUnknownCatalog(){
  catalogBackgroundTimer=null;
  const codes=catalogBackgroundQueue.shift();
  if(codes&&navigator.onLine!==false){try{await lookupPublicCatalog(codes);}catch{}}
  // Límite conservador: 1 consulta/10 s para respetar el sitio externo.
  if(catalogBackgroundQueue.length)catalogBackgroundTimer=setTimeout(drainUnknownCatalog,10000);
}

function cameraEvidenceService(){
  if(photoEvidenceService?.departmentId===S.deptId&&photoEvidenceService?.userId===S.user?.id)return photoEvidenceService;
  photoEvidenceService?.dispose();
  photoEvidenceService=new ScanEvidence({sb,departmentId:S.deptId,userId:S.user.id,
    cloudEnabled:vantisBackendConfig.mode!=='LEGACY_PRODUCCION',onIssue:message=>{
    const status=document.getElementById('crPhotoStatus');
    if(status)status.textContent=message;
  }});
  return photoEvidenceService;
}

function receiveBusy() {
  if(continuousQueue && !continuousQueue.disposed && (continuousQueue.busy || continuousQueue.pending || continuousQueue.state.pendingSwitch)) { toast('La recepción conserva lecturas pendientes. Revisa su estado antes de salir.','error'); return true; }
  if(receiveQueue?.busy || receiveQueue?.pending || receiveQueue?.selecting) { toast('Espera a que termine la recepción o la lectura pendiente.','error'); return true; }
  return false;
}

function exitBusy() {
  if (exitQueue?.busy || exitQueue?.pending) { toast('Espera a que termine la consulta o el registro de la salida.','error'); return true; }
  return false;
}

function clearEvidenceImages(){
  for(const photo of S.evidencePhotos||[]){
    if(photo.local&&photo.url?.startsWith('blob:'))URL.revokeObjectURL(photo.url);
  }
  S.evidencePhotos=[];
}
function resetSearchContext() {
  searchRequest++;
  searchPending = false;
  locationAssignment = null;
  locationSaveNotice = null;
  clearEvidenceImages();S.evidenceStatus='idle';
  clearInterval(catalogCountdownTimer);catalogCountdownTimer=null;
  S.externalStatus='idle';S.externalProduct=null;S.externalPreview=null;
  stopScanner();
}

function humanError(e) {
  const s = String(e?.message || e || 'Error');
  if (/fetch|network|load failed|abort/i.test(s)) return 'Sin conexión. Revisa tu internet e intenta de nuevo.';
  if (/permission|policy|42501|not authorized/i.test(s)) return 'Este acceso no tiene permiso para realizar esa acción.';
  if (/JWT|expired|sesión|session/i.test(s)) return 'Tu sesión expiró. Vuelve a entrar.';
  return s.replace(/^.*?ERROR:\s*/,'');
}

function roleFromUser(user) {
  const email = String(user?.email || '').toLowerCase();
  if (email === '99@bodega.local') return 'admin';
  if (email === '10@bodega.local') return 'seller';
  return null;
}

function applyRole(role) {
  S.access = role;
  S.admin = role === 'admin';
  S.staff = S.admin;
  S.displayName = S.admin ? 'Administrador' : 'Vendedor general';
}

function cleanupLegacyAccess() {
  localStorage.removeItem('inv.employee');
  localStorage.removeItem('inv.employeeToken');
  localStorage.removeItem('inv.staff');
}

function saveState() {
  localStorage.setItem('inv.dept', S.deptId || '');
}

async function boot() {
  cleanupLegacyAccess();
  const { data: { user }, error } = await sb.auth.getUser();
  if (error || !user) return renderLogin();
  const role = roleFromUser(user);
  if (!role) {
    await sb.auth.signOut();
    return renderLogin('Este acceso ya no está habilitado.');
  }
  S.user = user;
  applyRole(role);
  await loadDepartments();
  render();
}

async function loadDepartments() {
  const r = await sb.from('departamentos').select('id,nombre,activo,created_at').eq('activo', true).gt('created_at',VISUAL_CLEANUP_CUTOFF).order('nombre');
  if (r.error) {
    S.depts = [];
    S.deptId = null;
    return;
  }
  S.depts = r.data || [];
  const saved = localStorage.getItem('inv.dept');
  S.deptId = S.depts.some(x => x.id === saved) ? saved : (S.depts[0]?.id || null);
  saveState();
}

function renderLogin(err='') {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card">
        <div class="brandmark"><span>CI</span></div>
        <div class="eyebrow">Bodega inteligente · v${APP_VERSION}</div>
        <h1>Control de Inventario</h1>
        <p class="muted">Dos accesos. Menos pasos. Inventario en tiempo real.</p>
        <div class="login-accesses">
          <div><b>Administrador</b><span>Configuración, importaciones e historial</span></div>
          <div><b>Vendedor general</b><span>Entradas, salidas, búsqueda y conteos</span></div>
        </div>
        <form id="loginForm" class="stack">
          <label>Clave</label>
          <input id="clave" autocomplete="username" inputmode="numeric" maxlength="2" placeholder="99 o 10">
          <label>PIN</label>
          <input id="pin" type="password" autocomplete="current-password" inputmode="numeric" placeholder="Tu PIN">
          <div id="loginMsg">${err ? `<div class="error">${esc(err)}</div>` : ''}</div>
          <button class="primary" type="submit">Entrar</button>
        </form>
        <p class="tiny center">Acceso seguro · Información separada por departamento</p>
      </section>
    </main>`;
  $('loginForm').onsubmit = doLogin;
}

async function doLogin(e) {
  e.preventDefault();
  const button = e.submitter;
  const clave = $('clave').value.trim();
  const pin = $('pin').value.trim();
  $('loginMsg').innerHTML = '';

  if (!['99','10'].includes(clave)) {
    $('loginMsg').innerHTML = '<div class="error">Solo existen los accesos 99 (Administrador) y 10 (Vendedor general).</div>';
    return;
  }
  if (!pin) {
    $('loginMsg').innerHTML = '<div class="error">Escribe tu PIN.</div>';
    return;
  }
  if (clave === '10' && pin !== '1010') {
    $('loginMsg').innerHTML = '<div class="error">Clave o PIN incorrectos.</div>';
    return;
  }

  button.disabled = true;
  button.textContent = 'Validando…';
  try {
    cleanupLegacyAccess();
    await sb.auth.signOut();
    const email = `${clave}@bodega.local`;
    const password = clave === '10' ? 'bodega-10-1010' : `bodega-99-${pin}`;
    const r = await sb.auth.signInWithPassword({ email, password });
    if (r.error) throw Error('Clave o PIN incorrectos.');
    location.reload();
  } catch (x) {
    $('loginMsg').innerHTML = `<div class="error">${esc(humanError(x))}</div>`;
    button.disabled = false;
    button.textContent = 'Entrar';
  }
}

function deptName() {
  return S.depts.find(d => d.id === S.deptId)?.nombre || 'Sin departamento';
}

function nav() {
  const items = [['home','Inicio','⌂'],['search','Buscar','⌕'],['inventory','Inventario','▦']];
  if (S.admin) items.push(['history','Historial','☷'],['admin','Ajustes','⚙']);
  return `<nav class="bottom-nav">${items.map(([v,l,i]) => `<button data-view="${v}" class="${S.view===v?'active':''}"><span>${i}</span>${l}</button>`).join('')}</nav>`;
}

function header() {
  return `<header class="topbar">
    <div>
      <div class="eyebrow">Control de Inventario</div>
      <h2>${esc(deptName())}</h2>
      <div class="tiny access-label"><span class="status-dot"></span>${esc(S.displayName)} · acceso ${S.admin?'99':'10'}</div>
    </div>
    <div class="top-actions">
      ${S.depts.length > 1 ? `<select id="deptSelect" class="compact">${S.depts.map(d => `<option value="${d.id}" ${d.id===S.deptId?'selected':''}>${esc(d.nombre)}</option>`).join('')}</select>` : ''}
      <button id="logout" class="ghost">Salir</button>
    </div>
  </header>`;
}

function shell(body) {
  operationsCleanup?.(); operationsCleanup=null;
  exitCleanup?.(); exitCleanup = null;
  receiveCleanup?.(); receiveCleanup = null;
  continuousCleanup?.(); continuousCleanup = null;
  app.innerHTML = `<div class="app-shell">${header()}<main class="content view-enter">${body}</main>${nav()}</div>`;
  wireShell();
}

function wireShell() {
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    if (exitBusy() || receiveBusy()) return;
    resetSearchContext();
    S.view = b.dataset.view;
    S.product = null;
    S.searchResult = null;
    render();
  });
  $('logout').onclick = async () => {
    if (exitBusy() || receiveBusy()) return;
    resetSearchContext();
    cleanupLegacyAccess();
    await sb.auth.signOut();
    location.reload();
  };
  $('deptSelect')?.addEventListener('change', e => {
    if (exitBusy() || receiveBusy()) { e.target.value=S.deptId; return; }
    resetSearchContext();
    S.deptId = e.target.value;
    saveState();
    S.product = null;
    S.searchResult = null;
    render();
  });
}

function render() {
  if (!S.user) return renderLogin();
  if (!S.deptId && S.view !== 'admin') {
    shell(`<section class="empty"><div class="empty-icon">▦</div><h3>No hay departamentos activos</h3><p>El administrador debe crear el primero.</p>${S.admin?'<button id="goAdmin" class="primary">Crear departamento</button>':''}</section>`);
    $('goAdmin')?.addEventListener('click', () => { S.view='admin'; render(); });
    return;
  }
  if (S.view==='home') return homeView();
  if (S.view==='operations') return operationsView();
  if (S.view==='move') return moveView();
  if (S.view==='search') return searchView();
  if (S.view==='inventory') return inventoryView();
  if (S.view==='count') return countView();
  if (S.view==='import') return importView();
  if (S.view==='history') return historyView();
  if (S.view==='admin') return adminView();
  S.view='home';
  homeView();
}

function syncNetworkBadge(){
  const node=document.getElementById('connectionState');if(!node)return;
  const online=navigator.onLine!==false;
  node.classList.toggle('offline',!online);
  node.innerHTML='<i></i> '+(online?'Red disponible':'Sin conexión de red');
}
window.addEventListener?.('online',syncNetworkBadge);
window.addEventListener?.('offline',syncNetworkBadge);

function kpi(label,val,cls='') { return `<div class="kpi ${cls}"><span>${label}</span><strong>${val}</strong></div>`; }

async function homeView() {
  shell(`
    <section class="hero">
      <div><div class="eyebrow">${esc(deptName())}</div><h1>¿Qué necesitas hacer?</h1><p class="muted">Elige una acción. La app te guía paso a paso.</p></div>
      <div class="live-badge" id="connectionState" role="status"><i></i> Comprobando red</div>
    </section>
    <section class="action-grid">
      <button class="action-card green" data-act="ENTRADA"><b>＋</b><strong>Recibir mercancía</strong><span>Escanea y registra sin pasos extra</span></button>
      <button class="action-card red" data-act="SALIDA"><b>−</b><strong>Sacar de bodega</strong><span>Registrar lo que sale</span></button>
      <button class="action-card" data-go="search"><b>⌕</b><strong>Buscar producto</strong><span>UPC, SKU o ubicación</span></button>
      <button class="action-card" data-go="count"><b>✓</b><strong>Inventario físico</strong><span>Contar y detectar diferencias</span></button>
      <button class="action-card" data-go="operations"><b>◈</b><strong>Centro operativo</strong><span>Localizar, preparar, trasladar y supervisar</span></button>
    </section>
    <button id="quickReceive" class="vr-floating-launch" type="button" aria-label="Abrir escaneo de mercancía"><span class="vr-launch-glyph" aria-hidden="true">▦</span><span>Escanear</span></button>
    <section class="card"><div class="section-head"><h3>Hoy</h3><span class="tiny">Actualización en tiempo real</span></div><div id="summary" class="kpis"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></section>
    ${S.admin ? `<section class="card"><h3>Estado de la operación</h3><div id="checklist"><div class="skeleton"></div></div></section><section class="quick-row"><button data-go="import" class="secondary">Importar Excel / CSV</button><button data-go="history" class="secondary">Ver historial</button></section>` : `<section class="tip-card"><b>Tip rápido</b><span>En cada entrada o salida escribe tu nombre en “Nota”. Así queda claro quién realizó el movimiento.</span></section>`}
  `);
  syncNetworkBadge();
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => { S.moveType=b.dataset.act; if(S.moveType==='ENTRADA'){fastReceiveView();return;} S.view='move'; render(); });
  $('quickReceive').onclick=()=>{S.moveType='ENTRADA';fastReceiveView();};
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { S.view=b.dataset.go; render(); });

  const [sum,loc] = await Promise.all([
    sb.rpc('resumen_departamento',{p_departamento:S.deptId}),
    sb.from('marbetes').select('*',{count:'exact',head:true}).eq('departamento_id',S.deptId).eq('activo',true).gt('created_at',VISUAL_CLEANUP_CUTOFF)
  ]);
  if (!$('summary')) return;
  const x = sum.data || {};
  $('summary').innerHTML = kpi('Entradas',`+${x.entradas||0}`,'good') + kpi('Salidas',`−${x.salidas||0}`,'bad') + kpi('Movimientos',x.movimientos||0) + kpi('Unidades',x.unidades||0);
  if ($('checklist')) {
    $('checklist').innerHTML = [
      ['Departamento creado',true],
      ['Catálogo cargado',(x.productos||0)>0],
      ['Ubicaciones creadas',(loc.count||0)>0],
      ['Accesos simplificados',true]
    ].map(([t,ok]) => `<div class="check ${ok?'done':''}"><span>${ok?'✓':'○'}</span>${t}</div>`).join('');
  }
}

function operationsView() {
  shell('<div id="operationsRoot"></div>');
  const department=S.deptId;
  operationsCleanup=mountOperations($('operationsRoot'),{
    sb,deptId:department,admin:S.admin,actor:sessionStorage.getItem('nova.employeeNumber')||S.displayName,
    userId:S.user?.id||'',startScanner,stopScanner,
    getReceiveStatus:()=>{
      const q=continuousQueue;
      if(!q||q.deptId!==department)return {backend:'No abierta',pending:0,confirmed:0};
      const r=q.report();
      return {backend:q.backend,pending:r.pending,confirmed:r.confirmed,mirrorError:q.mirror?.error||'',restored:q.restoredFromBackup};
    },
    onBack:()=>{if(S.view!=='operations')return;S.view='home';render();},
    onExit:lines=>{
      if(S.view!=='operations'||S.deptId!==department||exitBusy()||receiveBusy())throw Error('La operación actual no permite preparar otra salida.');
      S.moveType='SALIDA';S.view='move';fastExitView();
      if(!exitQueue)throw Error('No se pudo iniciar la salida.');
      exitQueue.capture(lines);
      return true;
    }
  });
}

function moveView() {
  if (S.moveType==='SALIDA') return fastExitView();
  if (S.moveType==='ENTRADA') return fastReceiveView();
  const sellerNote = !S.admin;
  shell(`
    <section class="page-title"><button id="backHome" class="ghost">← Inicio</button><h1>${S.moveType==='ENTRADA'?'Recibir mercancía':'Sacar de bodega'}</h1><p class="muted">Escanea, confirma y sigue con el siguiente producto.</p></section>
    <div id="moveSuccess"></div>
    <button id="scanMove" class="scan-btn">📷 Escanear UPC o SKU</button>
    <form id="manualMove" class="inline-form"><input id="manualCode" placeholder="O escribe UPC / SKU" autocomplete="off"><button class="secondary">Buscar</button></form>
    <section class="card">${S.product ? productMoveCard(sellerNote) : '<div class="empty small-empty"><div class="empty-icon">⌁</div><b>Listo para escanear</b><p>Después de guardar, se limpia automáticamente para el siguiente.</p></div>'}</section>
  `);
  $('backHome').onclick = () => { S.view='home'; S.product=null; render(); };
  $('scanMove').onclick = () => openScanner(findForMove,'UPC o SKU');
  $('manualMove').onsubmit = e => { e.preventDefault(); findForMove($('manualCode').value).catch(x=>toast(humanError(x),'error')); };
  $('saveMove')?.addEventListener('click', saveMove);
}

function fastExitView() {
  const badge = (sessionStorage.getItem('nova.employeeNumber') || '').trim();
  const actor = badge ? `${S.admin?'Jefe':'Empleado'} ${badge}` : '';
  if (!exitQueue || exitQueue.deptId!==S.deptId || exitQueue.userId!==S.user.id || exitQueue.actor!==actor) {
    exitQueue = new FastExitQueue({sb,deptId:S.deptId,userId:S.user.id,actor,storage:localStorage,uuid:()=>crypto.randomUUID()});
  }
  exitQueue.resume();
  shell('<section class="page-title"><button id="backHome" type="button" class="ghost">← Inicio</button><h1>Sacar de bodega</h1></section><div id="fastExitRoot"></div>');
  $('backHome').onclick = () => { if(exitBusy())return; S.view='home'; render(); };
  const deptId=S.deptId, current=exitQueue;
  exitCleanup = mountFastExit($('fastExitRoot'),current,{startScanner,stopScanner,admin:S.admin,isCurrent:()=>S.view==='move'&&S.moveType==='SALIDA'&&S.deptId===deptId&&exitQueue===current});
}



function floatingReceiveFrame(){
  if(floatingReceiveElement?.isConnected)return floatingReceiveElement;
  floatingReceiveFocus=document.activeElement;
  const layer=document.createElement('div');
  layer.id='vantisReceiveFloat';layer.className='vr-receive-float';
  layer.innerHTML=`<div class="vr-float-backdrop" aria-hidden="true"></div><section class="vr-float-sheet" role="dialog" aria-modal="true" aria-label="Recibir mercancía">
    <header class="vr-float-header"><div class="vr-float-identity"><span class="vr-float-mark" aria-hidden="true">▦</span><div><strong>Recibir mercancía</strong><span>Escaneo directo · ${esc(deptName())}</span></div></div><button id="vrFloatClose" class="vr-close" type="button" aria-label="Cerrar ventana de escaneo">✕</button></header>
    <div id="vrFloatBody" class="vr-float-body"></div></section>`;
  document.body.appendChild(layer);document.body.classList.add('vr-receive-open');floatingReceiveElement=layer;
  layer.querySelector('#vrFloatClose').addEventListener('click',closeFloatingReceive);
  layer.querySelector('.vr-float-backdrop').addEventListener('click',closeFloatingReceive);
  floatingReceiveKeydown=event=>{if(event.key!=='Escape'||layer.querySelector('.cr-overlay:not([hidden])'))return;event.preventDefault();closeFloatingReceive();};
  document.addEventListener('keydown',floatingReceiveKeydown);
  return layer;
}
function closeFloatingReceive(){
  if(!floatingReceiveElement)return;
  const pending=continuousQueue?.pending||0;
  if(continuousQueue){
    if(continuousQueue.busy){
      toast('El servidor está procesando una lectura. En cuanto termine o expire la conexión, podrás cerrar y recuperar el registro.','error');
      return;
    }
    if(continuousQueue.selecting||continuousQueue.state.pendingSwitch){
      toast('Confirma o cancela el cambio de marbete antes de cerrar.','error');
      return;
    }
    if(pending&&!confirm('Hay '+pending+' lectura(s) pendiente(s) de confirmación.\n\nSe conservarán en este dispositivo para reintentar al abrir otra vez Recibir mercancía. NO se consideran existencias confirmadas.\n\n¿Cerrar solo esta ventana?'))return;
  } else if(receiveBusy())return;
  continuousCleanup?.();continuousCleanup=null;continuousQueue=null;
  receiveCleanup?.();receiveCleanup=null;
  document.removeEventListener('keydown',floatingReceiveKeydown);floatingReceiveKeydown=null;
  floatingReceiveElement.remove();floatingReceiveElement=null;
  document.body.classList.remove('vr-receive-open');
  if(floatingReceiveFocus?.isConnected)floatingReceiveFocus.focus();
  floatingReceiveFocus=null;
}
function fastReceiveView(){
  // El escaneo funciona en la pantalla Inicio, sin navegar a otro módulo.
  if(S.view!=='home'){S.view='home';homeView();}
  const layer=floatingReceiveFrame(),panel=layer.querySelector('#vrFloatBody');
  receiveCleanup?.();receiveCleanup=null;
  continuousCleanup?.();continuousCleanup=null;
  panel.innerHTML='<div id="continuousReceiveRoot"></div>';
  const badge=(sessionStorage.getItem('nova.employeeNumber')||'').trim();
  const actor=badge?(S.admin?'Jefe ':'Empleado ')+badge:'';
  const deptId=S.deptId;
  const current=new ContinuousReceive({api:new SupabaseReceiptApi(sb,deptId),storage:localStorage,userId:S.user.id,deptId,actor});
  const evidence=cameraEvidenceService();
  continuousQueue=current;
  continuousCleanup=mountContinuousReceive(panel.querySelector('#continuousReceiveRoot'),current,{
    startScanner,stopScanner,
    onEvidence:(id,code,frame)=>{void evidence.capture(id,code,frame,()=>current.rows.find(row=>row.id===id));},
    onEvidenceConfirmed:row=>{void evidence.confirm(row);prefetchUnknownCatalog(row.product);},
    isCurrent:()=>S.view==='home'&&S.deptId===deptId&&continuousQueue===current&&floatingReceiveElement===layer,
    onLegacy:()=>{if(receiveBusy())return;legacyReceiveView();},
    onUnavailable:()=>{if(floatingReceiveElement===layer)legacyReceiveView('Escaneo directo no disponible en el servidor. Usa el registro por lote mientras se activa.');}
  });
}
function legacyReceiveView(notice=''){
  const layer=floatingReceiveFrame(),panel=layer.querySelector('#vrFloatBody');
  continuousCleanup?.();continuousCleanup=null;continuousQueue=null;
  receiveCleanup?.();receiveCleanup=null;
  const badge=(sessionStorage.getItem('nova.employeeNumber')||'').trim();
  const actor=badge?(S.admin?'Jefe ':'Empleado ')+badge:'';
  if(!receiveQueue||receiveQueue.deptId!==S.deptId||receiveQueue.userId!==S.user.id||receiveQueue.actor!==actor)
    receiveQueue=new ReceiveQueue({sb,deptId:S.deptId,userId:S.user.id,actor,storage:localStorage,uuid:()=>crypto.randomUUID()});
  receiveQueue.resume();
  panel.innerHTML=(notice?'<p class="vr-compat-note" role="status">'+esc(notice)+'</p>':'')+'<div id="fastReceiveRoot"></div>';
  const deptId=S.deptId,current=receiveQueue;
  receiveCleanup=mountFastReceive(panel.querySelector('#fastReceiveRoot'),current,{
    startScanner,stopScanner,
    isCurrent:()=>S.view==='home'&&S.deptId===deptId&&receiveQueue===current&&floatingReceiveElement===layer
  });
}

function productMoveCard(sellerNote) {
  const p = S.product;
  const bodega = S.locations.filter(x => String(x.zona).toUpperCase().includes('BODEGA'));
  return `<div class="product-head">
      <div><div class="tiny">SKU ${esc(p.sku)}${p.upc?' · UPC '+esc(p.upc):''}</div><h2>${esc(p.descripcion)}</h2><p class="muted">${esc([p.marca,p.talla,p.color].filter(Boolean).join(' · '))}</p></div>
      <div class="stock-big">${p.stock}<span>en sistema</span></div>
    </div>
    ${locationList(S.locations)}
    <label>${S.moveType==='ENTRADA'?'Guardar en ubicación':'Sacar de ubicación'} (opcional)</label>
    <select id="moveLocation"><option value="">Sin ubicación específica</option>${bodega.map(x => `<option value="${esc(x.marbete_codigo)}">${esc(x.marbete_codigo)} · ${esc(x.descripcion||x.zona)}${x.cantidad!=null?' · '+x.cantidad+' pzas':''}</option>`).join('')}</select>
    <div class="two"><div><label>Cantidad</label><input id="moveQty" type="number" min="1" value="1" inputmode="numeric"></div><div><label>${sellerNote?'Nota / tu nombre *':'Nota'}</label><input id="moveNote" placeholder="${sellerNote?'Ej. Laura':'Opcional'}" ${sellerNote?'required':''}></div></div>
    ${sellerNote?'<p class="tiny note-help">Tu nombre en la nota reemplaza el antiguo sistema de empleados.</p>':''}
    <button id="saveMove" class="${S.moveType==='ENTRADA'?'primary':'danger'}">${S.moveType==='ENTRADA'?'Registrar entrada':'Registrar salida'}</button>`;
}

function cleanCodeText(value) {
  return String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g,'')
    .replace(/\u00A0/g,' ')
    .trim()
    .replace(/^['’]+|['’]+$/g,'');
}

function lookupCodeVariants(value) {
  const raw=cleanCodeText(value);
  if (!raw) return [];
  const compact=raw.replace(/\s+/g,'');
  return [...new Set([raw,compact])].filter(Boolean);
}

function upcLookupVariants(value) {
  const raw=cleanCodeText(value);
  if (!raw) return [];
  const compact=raw.replace(/[\s-]+/g,'');
  if (!/^\d+$/.test(compact)) return [compact];

  const out=new Set([compact]);
  const stripped=compact.replace(/^0+(?=\d)/,'');
  out.add(stripped);

  if (stripped.length >= 10 && stripped.length <= 14) {
    for (const len of [11,12,13,14]) {
      if (stripped.length <= len) out.add(stripped.padStart(len,'0'));
    }
  }
  return [...out].filter(Boolean);
}

function pickByPriority(rows, field, values) {
  if (!rows?.length) return null;
  const order=new Map(values.map((v,i)=>[String(v),i]));
  return [...rows].sort((a,b)=>(order.get(String(a?.[field])) ?? 999)-(order.get(String(b?.[field])) ?? 999))[0] || null;
}

async function findProduct(code, deptId=S.deptId) {
  const skuCandidates=lookupCodeVariants(code);
  const upcCandidates=upcLookupVariants(code);
  if (!skuCandidates.length) return null;

  const cols='id,sku,upc,descripcion,marca,talla,color,precio,stock,stock_minimo,departamento_id,activo';
  const skuReq=sb.from('productos')
    .select(cols)
    .eq('departamento_id',deptId)
    .eq('activo',true)
    .in('sku',skuCandidates)
    .limit(Math.max(1,skuCandidates.length));

  const upcReq=upcCandidates.length
    ? sb.from('productos')
        .select(cols)
        .eq('departamento_id',deptId)
        .eq('activo',true)
        .in('upc',upcCandidates)
        .limit(Math.max(1,upcCandidates.length))
    : Promise.resolve({data:[],error:null});

  const [bySku,byUpc]=await Promise.all([locationQuery(skuReq),upcCandidates.length?locationQuery(upcReq):Promise.resolve([])]);

  return pickByPriority(bySku||[],'sku',skuCandidates)
    || pickByPriority(byUpc||[],'upc',upcCandidates)
    || null;
}

async function loadLocations(sku, deptId=S.deptId) {
  const rows = await locationQuery(sb.from('producto_marbetes').select('marbete_codigo,cantidad,marbetes(zona,descripcion,activo,departamento_id)').eq('sku',sku));
  return (rows||[])
  .filter(x => x.marbetes?.activo === true && x.marbetes?.departamento_id === deptId)
  .map(x => ({marbete_codigo:x.marbete_codigo,cantidad:x.cantidad,zona:x.marbetes?.zona||'',descripcion:x.marbetes?.descripcion||''}));
}

function locationList(locs) {
  return locs.length ? `<div class="loc-list">${locs.map(x => `<div><b>${esc(x.marbete_codigo)}</b><span>${esc(x.zona)}${x.descripcion?' · '+esc(x.descripcion):''}</span>${x.cantidad!=null?`<em>${x.cantidad}</em>`:''}</div>`).join('')}</div>` : `<div class="notice">Sin ubicación asignada todavía.</div>`;
}

async function findForMove(code) {
  stopScanner();
  const p = await findProduct(code);
  if (!p) return toast('Producto no encontrado en este departamento.','error');
  S.product = p;
  S.locations = await loadLocations(p.sku);
  render();
}

async function saveMove() {
  const q = Math.max(1, Number($('moveQty').value)||1);
  const note = $('moveNote').value.trim();
  if (!S.admin && !note) return toast('Escribe tu nombre en Nota antes de guardar.','error');
  if (S.moveType==='SALIDA' && q > S.product.stock) return toast(`Solo hay ${S.product.stock} piezas disponibles.`,'error');
  const b = $('saveMove');
  b.disabled = true;
  b.textContent = 'Guardando…';
  const r = await sb.rpc('mover_stock_v2',{
    p_token:null,
    p_id:uuid(),
    p_producto:S.product.id,
    p_tipo:S.moveType,
    p_cantidad:q,
    p_marbete:$('moveLocation').value||null,
    p_nota:note||null
  });
  if (r.error) {
    b.disabled = false;
    b.textContent = S.moveType==='ENTRADA'?'Registrar entrada':'Registrar salida';
    return toast(humanError(r.error),'error');
  }
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  const old = S.product;
  S.product = null;
  S.locations = [];
  render();
  if ($('moveSuccess')) $('moveSuccess').innerHTML = `<div class="success success-pop">✓ ${S.moveType==='ENTRADA'?'Entrada':'Salida'} registrada · ${q} pza${q===1?'':'s'} · SKU ${esc(old.sku)} · stock ${row?.stock_resultante??'actualizado'}</div>`;
  setTimeout(() => openScanner(findForMove,'UPC o SKU'), 450);
}

function searchView() {
  shell(`<section class="page-title"><h1>Buscar</h1><p class="muted">Escanea UPC, SKU o un marbete.</p></section><button id="scanSearch" class="scan-btn">📷 Escanear código</button><form id="manualSearch" class="inline-form"><input id="searchCode" aria-label="UPC, SKU o marbete" placeholder="UPC, SKU o marbete" autocomplete="off" value="${esc(lastSearchCode)}"><button class="secondary">Buscar</button></form><section class="card" aria-busy="${searchPending}">${searchResultHtml()}</section>`);
  $('scanSearch').onclick = () => openScanner(doSearch,'UPC, SKU o marbete');
  $('manualSearch').onsubmit = e => { e.preventDefault(); doSearch($('searchCode').value).catch(x=>toast(humanError(x),'error')); };
  $('giveProductLocation')?.addEventListener('click', openProductLocation);
  $('receiveUnknown')?.addEventListener('click',()=>fastReceiveView());
  document.querySelectorAll('.catalog-hero-image').forEach(img=>img.addEventListener('error',()=>{img.hidden=true;img.parentElement?.classList.add('image-missing');},{once:true}));
}

function searchEvidenceHtml() {
  if(S.evidenceStatus==='loading')return '<section class="vantis-evidence"><h3>Registro visual</h3><p class="muted">Cargando imágenes privadas de las recepciones…</p></section>';
  if(S.evidenceStatus==='error')return '<section class="vantis-evidence"><h3>Registro visual</h3><p class="muted">Las fotografías todavía no están disponibles desde esta instancia. Las nuevas capturas de cámara se intentarán sincronizar.</p></section>';
  const photos=S.evidencePhotos||[];
  if(!photos.length)return '<section class="vantis-evidence"><h3>Registro visual</h3><p class="muted">Sin capturas de cámara para este SKU. Esta evidencia de recepción es independiente de la fotografía del catálogo mostrada arriba.</p>'+(vantisBackendConfig.mode==='LEGACY_PRODUCCION'?'<p class="tiny">Las capturas del lector de cámara permanecen en este dispositivo hasta habilitar la sincronización.</p>':'')+'</section>';
  return '<section class="vantis-evidence"><h3>Registro visual <small>'+photos.length+' últimas capturas</small></h3>'+
    '<p class="muted">Fotogramas de cámara (pueden mostrar el código sin el producto completo).'+(photos.some(p=>p.pendingLink)?' Hay lecturas con imagen que siguen pendientes de confirmar en el inventario.':'')+(photos.some(p=>p.local)?(vantisBackendConfig.mode==='LEGACY_PRODUCCION'?' Fotos locales: no sincronizadas entre dispositivos.':' Algunas fotos permanecen en este dispositivo, pendientes de sincronización.'):'')+'</p>'
    '<div class="vantis-evidence-grid">'+photos.map(photo=>{
      const when=new Date(photo.capturada_en).toLocaleString('es-MX',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
      return '<figure class="vantis-evidence-item">'+(photo.url?
        '<a href="'+esc(photo.url)+'" target="_blank" rel="noopener noreferrer" aria-label="Abrir evidencia del '+esc(when)+'"><img loading="lazy" src="'+esc(photo.url)+'" alt="Imagen del código escaneado para '+esc(S.searchResult?.sku||'SKU')+'"></a>'
        :'<div class="vantis-evidence-missing">Imagen no disponible</div>')+
        '<figcaption>'+esc(when)+' <span>· '+esc(photo.codigo_leido)+(photo.local?' · En este dispositivo':'')+(photo.pendingLink?' · Pendiente de confirmar':'')+'</span></figcaption></figure>';
    }).join('')+'</div></section>';
}

function catalogSectionHtml(){
  const state=S.externalStatus,item=S.externalProduct,preview=S.externalPreview;
  const verified=state==='verified'&&item;
  const image=verified?item.imageUrl:preview?.imageUrl||'';
  const title=verified?item.title:(S.searchType==='product'?S.searchResult?.descripcion:'Producto por identificar')||'Producto por identificar';
  const code=String(S.searchType==='product'?S.searchResult?.sku||lastSearchCode:lastSearchCode);
  const sourceLink=verified?item.productUrl:publicSearchUrl(code);
  const photoKind=verified?'IMAGEN VERIFICADA · LIVERPOOL':image?'REFERENCIA POR CÓDIGO · LIVERPOOL':'FOTO PENDIENTE';
  const loading=state==='loading';
  const stateLine=verified?'Coincidencia exacta con ficha pública del producto.':
    image?'Imagen localizada por código en el servidor de Liverpool. Verifica visualmente modelo, talla y color.':
    loading?'Buscando fotografía y ficha pública…':
    state==='offline'?'Sin conexión: no hay foto guardada en este dispositivo.':
    state==='not_found'?'No se encontró una ficha pública exacta para este código.':
    'No hay fotografía confirmada en Liverpool para este SKU.';
  const statusInfo=loading?'<div class="catalog-timer" role="status"><span class="catalog-spinner" aria-hidden="true"></span><b id="catalogCountdown">'+S.externalCountdown+' s</b></div>':'';
  const stage=image?
    '<img class="catalog-hero-image" loading="eager" decoding="async" src="'+esc(image)+'" alt="Fotografía del catálogo Liverpool asociada al código '+esc(verified?item.code:preview.code)+'">':
    '<div class="catalog-placeholder" aria-hidden="true"><svg viewBox="0 0 300 190" role="img"><path d="M24 129c19 0 37-6 59-30l34-35 35 7 29 31 40 14 49 7c11 2 17 12 15 22l-4 12H27c-8-6-11-15-3-28Z" fill="#f7ddea" stroke="#bc0c72" stroke-width="4" stroke-linejoin="round"/><path d="M40 151h237" stroke="#ba0a72" stroke-width="6" stroke-linecap="round"/><path d="m130 71 18 26m-31-9 35 15m-50 0 42 10" stroke="#b30a6b" stroke-width="4" stroke-linecap="round"/><path d="m199 118 29 7" stroke="#d28baa" stroke-width="5" stroke-linecap="round"/></svg><span>Esperando imagen del producto</span></div>';
  return '<section class="catalog-product-showcase" aria-label="Imagen y catálogo Liverpool">'+
    '<div class="catalog-showcase-header"><span class="catalog-showcase-eyebrow">VANTIS · CATÁLOGO VISUAL</span><strong>Vista de producto</strong></div>'+
    '<div class="catalog-visual-stage'+(image?' has-photo':'')+'"><div class="catalog-halo"></div>'+stage+
      '<span class="catalog-visual-stamp">'+photoKind+'</span></div>'+
    '<div class="catalog-showcase-foot"><div><span class="catalog-showcase-code">SKU '+esc(code)+'</span>'+
      '<h3>'+esc(title)+'</h3><p>'+esc(stateLine)+'</p></div>'+statusInfo+'</div>'+
    '<div class="catalog-showcase-actions"><a href="'+esc(sourceLink)+'" target="_blank" rel="noopener noreferrer">Consultar Liverpool ↗</a>'+
       '<small>Imagen de referencia si no existe ficha verificada. El stock no se modifica.</small></div></section>';
}

function startCatalogLookup(codes,current){
  clearInterval(catalogCountdownTimer);catalogCountdownTimer=null;
  S.externalProduct=null;S.externalPreview=null;S.externalCountdown=8;
  // También consulta el caché del dispositivo cuando no hay internet.
  S.externalStatus='loading';render();
  // La imagen con código idéntico se intenta en paralelo, sin bloquear la API ni el escaneo.
  void liverpoolPreview(codes).then(preview=>{if(!current()||!preview)return;S.externalPreview=preview;render();}).catch(()=>{});
  catalogCountdownTimer=setInterval(()=>{
    if(!current()||S.externalStatus!=='loading'){clearInterval(catalogCountdownTimer);catalogCountdownTimer=null;return;}
    S.externalCountdown=Math.max(0,S.externalCountdown-1);
    const label=document.getElementById('catalogCountdown');if(label)label.textContent=S.externalCountdown+' s';
  },1000);
  void lookupPublicCatalog(codes).then(item=>{
    if(!current())return;
    clearInterval(catalogCountdownTimer);catalogCountdownTimer=null;
    S.externalStatus=item.status;S.externalProduct=item.status==='verified'?item:null;render();
  }).catch(()=>{
    if(!current())return;
    clearInterval(catalogCountdownTimer);catalogCountdownTimer=null;
    S.externalStatus='unavailable';render();
  });
}

function searchResultHtml() {
  if (searchPending) return '<p class="muted" role="status">Consultando artículo y ubicaciones…</p>';
  if (!S.searchResult) return '<div class="empty small-empty"><div class="empty-icon">⌕</div><p>Escanea un código para ver stock y ubicación.</p></div>';
  if (S.searchType==='external')return '<div class="catalog-unknown"><div class="tiny">Código consultado</div><h2>'+esc(S.searchResult.code)+'</h2><p class="muted">No aparece en el inventario de este departamento. La consulta pública es solo informativa y no confirma existencias.</p>'+catalogSectionHtml()+'<button id="receiveUnknown" class="secondary" type="button">Registrar escaneando en recepción</button></div>';
  if (S.searchType==='product') {
    const p=S.searchResult;
    return `<div class="product-head"><div><div class="tiny">SKU ${esc(p.sku)}${p.upc?' · UPC '+esc(p.upc):''}</div><h2>${esc(p.descripcion)}</h2><p class="muted">${esc([p.marca,p.talla,p.color].filter(Boolean).join(' · '))}</p></div><div class="stock-big">${p.stock}<span>piezas</span></div></div>${catalogSectionHtml()}${locationList(S.locations)}${searchEvidenceHtml()}${locationSaveNotice?.productId===p.id?`<div class="success" role="status">✓ ${locationSaveNotice.alreadyAssigned?'El artículo ya estaba asignado a':'Ubicación guardada:'} <b>${esc(locationSaveNotice.code)}</b>.</div>`:''}<div class="product-location-action"><button id="giveProductLocation" class="${S.locations.length?'secondary':'primary'}" type="button">⌖ ${S.locations.length?'Agregar otra ubicación':'Darle ubicación'}</button><p class="tiny">${S.locations.length?'Conserva las ubicaciones actuales.':'Escanea el marbete del cajón, mueble o rack.'}</p></div><div id="productLocationPanel" hidden></div>`;
  }
  const m=S.searchResult;
  return `<div><div class="tiny">Ubicación</div><h2>${esc(m.codigo)}</h2><p><span class="pill">${esc(m.zona)}</span> ${esc(m.descripcion||'')}</p><div>${(m.products||[]).map(p => `<div class="product-row"><div><b>${esc(p.descripcion)}</b><span>SKU ${esc(p.sku)}${p.upc?' · UPC '+esc(p.upc):''}</span></div><strong>${p.qty??'—'}</strong></div>`).join('')||'<p class="muted">No hay productos asignados.</p>'}</div></div>`;
}

async function doSearch(code) {
  if (S.view!=='search') return;
  stopScanner();
  code=String(code||'').trim();
  if (!code) return;
  try {if (!/^\d{3}-\d{3,4}$/.test(code)) code=parseMarbeteScan(code);} catch { /* SKU and UPC stay unchanged. */ }
  const request=++searchRequest, deptId=S.deptId;
  const current=()=>request===searchRequest && S.deptId===deptId && S.view==='search';
  locationAssignment=null; locationSaveNotice=null; lastSearchCode=code;
  clearInterval(catalogCountdownTimer);catalogCountdownTimer=null;
  S.externalStatus='idle';S.externalProduct=null;S.externalPreview=null;
  clearEvidenceImages();S.searchResult=null; S.locations=[]; S.evidenceStatus='idle'; searchPending=true;
  render();
  try {
    const p=await findProduct(code,deptId);
    if (!current()) return;
    if (p) {
      const locs=await loadLocations(p.sku,deptId);
      if (!current()) return;
      S.searchType='product'; S.searchResult=p; S.locations=locs; S.evidenceStatus='loading';
      startCatalogLookup([p.sku,p.upc],current);
      // La búsqueda de stock es independiente de la descarga de imágenes.
      void Promise.allSettled([
        vantisBackendConfig.mode==='LEGACY_PRODUCCION'?Promise.resolve([]):listSkuEvidence(sb,deptId,p.sku),
        listLocalSkuEvidence(deptId,S.user.id,p.sku,{codes:[p.upc]})
      ]).then(([remote,local])=>{
        if(!current()){
          if(local.status==='fulfilled')local.value.forEach(item=>URL.revokeObjectURL(item.url));
          return;
        }
        const cloud=remote.status==='fulfilled'?remote.value:[];
        const localRows=local.status==='fulfilled'?local.value:[];
        const cloudIds=new Set(cloud.map(item=>item.evento_id));
        clearEvidenceImages();
        S.evidencePhotos=[...cloud,...localRows.filter(item=>{
          if(cloudIds.has(item.evento_id)){URL.revokeObjectURL(item.url);return false;}
          return true;
        })].sort((a,b)=>String(b.capturada_en).localeCompare(String(a.capturada_en))).slice(0,8);
        S.evidenceStatus=cloud.length||localRows.length||remote.status==='fulfilled'?'ready':'error';
        render();
      });
      return;
    }
    const marbete=await locationQuery(sb.from('marbetes').select('codigo,zona,descripcion,created_at').eq('codigo',code).eq('activo',true).eq('departamento_id',deptId).gt('created_at',VISUAL_CLEANUP_CUTOFF).maybeSingle());
    if (!current()) return;
    if (!marbete){S.searchType='external';S.searchResult={code};startCatalogLookup([code],current);return;}
    const assignments=await locationQuery(sb.from('producto_marbetes').select('sku,cantidad').eq('marbete_codigo',code));
    const skus=(assignments||[]).map(x=>x.sku);
    let products=[];
    if (skus.length) {
      const rows=await locationQuery(sb.from('productos').select('sku,upc,descripcion').eq('departamento_id',deptId).eq('activo',true).in('sku',skus));
      products=(rows||[]).map(p=>({...p,qty:(assignments||[]).find(x=>x.sku===p.sku)?.cantidad}));
    }
    if (!current()) return;
    S.searchType='marbete'; S.searchResult={...marbete,products};
  } catch(error) { if (current()) toast(humanError(error),'error'); }
  finally { if (current()) { searchPending=false; render(); } }
}

function assignmentCurrent(a) {
  return locationAssignment===a && S.view==='search' && S.deptId===a.deptId && S.searchType==='product' && S.searchResult?.id===a.productId;
}

function assignmentOnline(a) {
  if (!assignmentCurrent(a)) return false;
  if (navigator.onLine!==false) return true;
  a.error='Necesitas conexión para validar y guardar la ubicación.';
  paintProductLocation(a);
  return false;
}

function openProductLocation() {
  if (locationAssignment && assignmentCurrent(locationAssignment)) return;
  const p=S.searchResult;
  if (S.view!=='search' || S.searchType!=='product' || !p) return;
  const a={productId:p.id,sku:p.sku,upc:p.upc,deptId:S.deptId,department:deptName(),code:'',candidate:null,missing:false,phase:'',error:''};
  locationAssignment=a;
  paintProductLocation(a);
  scanProductMarbete(a);
}

function paintProductLocation(a) {
  if (!assignmentCurrent(a)) return;
  const panel=$('productLocationPanel');
  if (!panel) return;
  panel.hidden=false;
  $('giveProductLocation').hidden=true;
  const busy=Boolean(a.phase), disabled=busy?'disabled':'';
  panel.innerHTML=`<section class="product-location-panel" aria-labelledby="locationPanelTitle" aria-busy="${busy}"><h3 id="locationPanelTitle">Asignar ubicación</h3><p class="tiny">SKU ${esc(a.sku)} · ${esc(a.department)}</p><button id="scanProductMarbete" class="scan-btn" type="button" ${disabled}>▣ Escanear marbete</button><form id="manualProductMarbete" class="inline-form"><input id="productMarbeteCode" aria-label="Código del marbete" placeholder="O escribe el código del marbete" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="120" value="${esc(a.code)}" ${disabled}><button class="secondary" ${disabled}>Validar</button></form><div role="status" aria-live="polite">${busy?`<p class="muted">${a.phase==='saving'?'Guardando y comprobando ubicación…':a.phase==='registering'?'Registrando marbete…':'Validando marbete…'}</p>`:''}${a.error?`<div class="error">${esc(a.error)}</div>`:''}</div>${a.missing?(S.admin?`<div class="notice"><b>Marbete nuevo: ${esc(a.code)}</b><p>Confirma que este código está colocado en el mueble de ${esc(a.department)}.</p><label for="newProductMarbeteZone">Tipo de ubicación</label><select id="newProductMarbeteZone" ${disabled}><option value="BODEGA">BODEGA</option><option value="PISO">PISO</option></select><button id="registerProductMarbete" class="secondary" type="button" ${disabled}>Registrar este marbete</button></div>`:'<div class="notice">Pide al administrador que registre este marbete en Ajustes → Ubicaciones.</div>'):''}${a.candidate?`<div class="location-confirm"><span class="tiny">Ubicación verificada</span><strong>${esc(a.candidate.codigo)}</strong><span>${esc(a.candidate.zona)}${a.candidate.descripcion?' · '+esc(a.candidate.descripcion):''}</span><button id="confirmProductLocation" class="primary" type="button" ${disabled}>Guardar ubicación</button></div>`:''}<p class="tiny">Asigna la ubicación sin modificar el stock total ni las cantidades ya registradas.</p><button id="cancelProductLocation" class="ghost" type="button" ${a.phase==='saving'||a.phase==='registering'?'disabled':''}>Cancelar</button></section>`;
  $('scanProductMarbete').onclick=()=>scanProductMarbete(a);
  $('productMarbeteCode').oninput=e=>{
    a.code=e.target.value;
    if ($('confirmProductLocation')) $('confirmProductLocation').disabled=true;
    if ($('registerProductMarbete')) $('registerProductMarbete').disabled=true;
  };
  $('manualProductMarbete').onsubmit=e=>{e.preventDefault();validateProductMarbete(a,$('productMarbeteCode').value)};
  $('confirmProductLocation')?.addEventListener('click',()=>saveProductLocation(a));
  $('registerProductMarbete')?.addEventListener('click',()=>registerProductLocationMarbete(a,$('newProductMarbeteZone').value));
  $('cancelProductLocation').onclick=()=>{
    if (a.phase==='saving'||a.phase==='registering') return;
    stopScanner(); locationAssignment=null; panel.hidden=true;
    $('giveProductLocation').hidden=false; $('giveProductLocation').focus();
  };
}

async function scanProductMarbete(a) {
  if (a.phase || !assignmentOnline(a)) return;
  try { await startScanner(code=>{validateProductMarbete(a,code)},'marbete QR o código de barras',{qrEnabled:true}); }
  catch { if (assignmentCurrent(a)) { a.error='No pude abrir la cámara. Permite el acceso o escribe el código del marbete.'; paintProductLocation(a); $('productMarbeteCode')?.focus(); } }
}

async function validateProductMarbete(a,raw) {
  if (a.phase || !assignmentOnline(a)) return;
  stopScanner();
  a.phase='checking'; a.candidate=null; a.missing=false; a.error=''; a.code=String(raw??'').trim();
  paintProductLocation(a);
  try {
    const original=String(a.code??'').trim();
    if (original===a.sku || original===a.upc) throw Error('Escaneaste el código del artículo. Escanea el marbete del cajón, mueble o rack.');
    const parsed=parseMarbeteScan(original);
    // Preserve pre-existing legacy IDs such as "459-001". For full ZAP
    // codes and QR payloads, use the canonical "ZAP-459-001".
    const legacy=/^\d{3}-\d{3,4}$/.test(original);
    const preferred=legacy ? original : parsed;
    // If this is a previously unknown QR, register its decoded marbete ID,
    // never the raw URL/JSON payload.
    a.code=preferred;
    let row;
    try {
      row=await getMarbete(sb,preferred,a.deptId);
    } catch(error) {
      if(error?.code!=='NOT_REGISTERED' || preferred===parsed) throw error;
      row=await getMarbete(sb,parsed,a.deptId);
    }
    if (assignmentCurrent(a)) {
      a.candidate=row;
      a.code=row.codigo;
    }
  } catch(error) { if (assignmentCurrent(a)) { a.error=humanError(error); a.missing=error.code==='NOT_REGISTERED'; } }
  finally { a.phase=''; paintProductLocation(a); }
}

async function registerProductLocationMarbete(a,zona) {
  if (!S.admin || !a.missing || a.phase || !assignmentOnline(a)) return;
  a.phase='registering'; a.error=''; paintProductLocation(a);
  try {
    const row=await registerMarbete(sb,{code:a.code,deptId:a.deptId,zona});
    if (assignmentCurrent(a)) { a.candidate=row; a.missing=false; }
  } catch(error) { if (assignmentCurrent(a)) a.error=humanError(error); }
  finally { a.phase=''; paintProductLocation(a); }
}

async function saveProductLocation(a) {
  if (a.phase || !a.candidate || !assignmentOnline(a)) return;
  if (normalizeMarbete(a.code)!==a.candidate.codigo) return validateProductMarbete(a,a.code);
  a.phase='saving'; a.error=''; paintProductLocation(a);
  try {
    const result=await assignProductLocation(sb,{productId:a.productId,sku:a.sku,deptId:a.deptId,marbeteCode:a.candidate.codigo});
    if (!assignmentCurrent(a)) return;
    let locs;
    try { locs=await loadLocations(a.sku,a.deptId); }
    catch { locs=[...S.locations.filter(x=>x.marbete_codigo!==result.marbete.codigo),{marbete_codigo:result.marbete.codigo,cantidad:result.assignment.cantidad,zona:result.marbete.zona,descripcion:result.marbete.descripcion}]; }
    if (!assignmentCurrent(a)) return;
    S.locations=locs;
    locationSaveNotice={productId:a.productId,code:result.marbete.codigo,alreadyAssigned:result.alreadyAssigned};
    locationAssignment=null;
    render();
    toast(`${result.alreadyAssigned?'Ubicación ya asignada':'Ubicación guardada'} · SKU ${a.sku}`);
  } catch(error) { if (assignmentCurrent(a)) a.error=humanError(error); }
  finally { a.phase=''; paintProductLocation(a); }
}

let inventoryPage=0, inventoryLastPage=false, inventoryEpoch=0, inventoryRows=[];
const INVENTORY_PAGE_SIZE=100;
function inventoryView() {
  inventoryPage=0;inventoryLastPage=false;inventoryRows=[];inventoryEpoch++;
  shell('<section class="page-title"><h1>Inventario</h1><p class="muted">Consulta paginada para catálogos grandes · '+esc(deptName())+'</p></section><div class="card"><div class="inline-form"><input id="invQ" placeholder="SKU, UPC, descripción, marca…"><select id="stockFilter" class="compact"><option value="all">Todos</option><option value="positive">Con stock</option><option value="zero">Agotados</option><option value="low">Stock bajo</option></select></div><div id="invList"></div><button id="invLoadMore" class="secondary" type="button" hidden>Cargar más productos</button><p id="invRangeInfo" class="tiny"></p></div>');
  let timer;
  const restart=()=>{clearTimeout(timer);timer=setTimeout(()=>{inventoryPage=0;inventoryRows=[];inventoryLastPage=false;void loadInventory();},170);};
  $('invQ').oninput=restart;$('stockFilter').onchange=restart;
  $('invLoadMore').onclick=()=>void loadInventory(true);
  void loadInventory();
}
function inventoryPassesFilter(p,f) {
  if(f==='positive')return Number(p.stock)>0;
  if(f==='zero')return Number(p.stock)<=0;
  if(f==='low')return Number(p.stock)>0&&Number(p.stock)<=Number(p.stock_minimo||0);
  return true;
}
function renderInventoryRows(rows){
  if(!$('invList'))return;
  $('invList').innerHTML=rows.map(p=>'<div class="product-row"><div><b>'+esc(p.descripcion)+'</b><span>SKU '+esc(p.sku)+(p.upc?' · UPC '+esc(p.upc):'')+'</span><span>'+esc([p.marca,p.talla,p.color].filter(Boolean).join(' · '))+'</span></div><div class="right"><strong>'+p.stock+'</strong>'+(S.admin?'<button class="mini" data-edit="'+esc(p.id)+'">Editar</button>':'')+'</div></div>').join('')||'<p class="muted">Sin resultados en estas páginas.</p>';
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editProduct(b.dataset.edit,rows.find(x=>x.id===b.dataset.edit)));
}
async function loadInventory(append=false){
  const input=$('invQ'),filter=$('stockFilter');if(!input||!filter)return;
  const q=input.value.trim(),f=filter.value, page=append?inventoryPage:0,request=++inventoryEpoch,dept=S.deptId;
  const active=()=>S.view==='inventory'&&S.deptId===dept&&request===inventoryEpoch;
  const more=$('invLoadMore'),info=$('invRangeInfo');
  more.disabled=true;info.textContent='Consultando catálogo…';
  try{
    if(!append&&q&&/^[A-Za-z0-9._ -]{5,40}$/.test(q)){
      const exact=await findProduct(q,dept);
      if(!active())return;
      if(exact){inventoryRows=inventoryPassesFilter(exact,f)?[exact]:[];inventoryLastPage=true;inventoryPage=1;renderInventoryRows(inventoryRows);more.hidden=true;info.textContent='Resultado exacto.';return;}
    }
    let req=sb.from('productos').select('id,sku,upc,descripcion,marca,talla,color,precio,stock,stock_minimo')
      .eq('activo',true).eq('departamento_id',dept)
      .gt('created_at',VISUAL_CLEANUP_CUTOFF).order('descripcion').order('sku')
      .range(page*INVENTORY_PAGE_SIZE,(page+1)*INVENTORY_PAGE_SIZE-1);
    if(q){const x=q.replace(/[(),%*]/g,' ').trim();if(x)req=req.or('sku.ilike.%'+x+'%,upc.ilike.%'+x+'%,descripcion.ilike.%'+x+'%,marca.ilike.%'+x+'%,talla.ilike.%'+x+'%,color.ilike.%'+x+'%');}
    if(f==='positive')req=req.gt('stock',0);
    if(f==='zero')req=req.lte('stock',0);
    const res=await req;if(!active())return;
    if(res.error)throw res.error;
    const chunk=res.data||[];
    inventoryRows=append?inventoryRows.concat(chunk.filter(p=>inventoryPassesFilter(p,f))):chunk.filter(p=>inventoryPassesFilter(p,f));
    inventoryPage=page+1;inventoryLastPage=chunk.length<INVENTORY_PAGE_SIZE;
    renderInventoryRows(inventoryRows);
    more.hidden=inventoryLastPage;
    info.textContent=inventoryRows.length.toLocaleString('es-MX')+' artículos visibles'+(inventoryLastPage?' · Fin de resultados':' · Hay más páginas')+(f==='low'?' · Revisa todas las páginas para encontrar los de stock bajo':'');
  }catch(error){if(active())info.textContent='Error al cargar catálogo: '+humanError(error);}
  finally{if(active())more.disabled=false;}
}

async function editProduct(id,p) {
  const descripcion=prompt('Descripción',p.descripcion); if (descripcion===null) return;
  const upc=prompt('UPC',p.upc||''); if (upc===null) return;
  const minimo=prompt('Stock mínimo',p.stock_minimo); if (minimo===null) return;
  const r=await sb.from('productos').update({descripcion:descripcion.trim()||p.descripcion,upc:upc.trim()||null,stock_minimo:Math.max(0,Number(minimo)||0)}).eq('id',id);
  if (r.error) return toast(humanError(r.error),'error');
  toast('Producto actualizado.'); loadInventory();
}

function countView() {
  shell(`<section class="page-title"><button id="backHome" class="ghost">← Inicio</button><h1>Inventario físico</h1><p class="muted">Cuenta lo que realmente hay. Las diferencias quedan auditadas.</p></section><section id="countArea" class="card"><div class="skeleton"></div></section>`);
  $('backHome').onclick=()=>{S.view='home';S.count=null;render()};
  loadCounts();
}

async function loadCounts() {
  const r=await sb.from('conteos').select('*').eq('departamento_id',S.deptId).gt('created_at',VISUAL_CLEANUP_CUTOFF).order('created_at',{ascending:false}).limit(20);
  if (!$('countArea')) return;
  if (S.count) return renderActiveCount();
  const open=(r.data||[]).filter(x=>x.estado!=='CERRADO');
  $('countArea').innerHTML=`<button id="newCount" class="primary">＋ Nuevo conteo</button>${open.length?`<h3>Conteos en curso</h3>${open.map(c=>`<button class="count-row" data-count="${c.id}"><b>${esc(c.nombre)}</b><span>${esc(c.estado)}</span></button>`).join('')}`:'<p class="muted">No hay conteos abiertos.</p>'}`;
  $('newCount').onclick=createCount;
  document.querySelectorAll('[data-count]').forEach(b=>b.onclick=()=>{S.count=(r.data||[]).find(x=>x.id===b.dataset.count);renderActiveCount()});
}

async function createCount() {
  const name=prompt('Nombre del conteo',`Conteo ${new Date().toLocaleDateString('es-MX')}`);
  if (!name) return;
  const r=await sb.from('conteos').insert({departamento_id:S.deptId,nombre:name.trim(),estado:'ABIERTO',creado_nombre:S.displayName}).select().single();
  if (r.error) return toast(humanError(r.error),'error');
  S.count=r.data; renderActiveCount();
}

async function renderActiveCount() {
  const c=S.count;
  const lines=await sb.from('conteo_lineas').select('producto_id,sku,contado,updated_at').eq('conteo_id',c.id).order('updated_at',{ascending:false}).limit(60);
  $('countArea').innerHTML=`<div class="count-head"><div><h2>${esc(c.nombre)}</h2><span class="pill">${esc(c.estado)}</span></div><button id="exitCount" class="ghost">Cambiar conteo</button></div><button id="scanCount" class="scan-btn" ${c.estado==='CERRADO'?'disabled':''}>📷 Escanear producto</button><form id="manualCount" class="inline-form"><input id="countCode" placeholder="UPC o SKU" ${c.estado==='CERRADO'?'disabled':''}><button class="secondary">Buscar</button></form><div id="countProduct"></div><h3>Contados (${(lines.data||[]).length})</h3><div>${(lines.data||[]).map(x=>`<div class="product-row"><div><b>SKU ${esc(x.sku)}</b><span>${new Date(x.updated_at).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}</span></div><strong>${x.contado}</strong></div>`).join('')||'<p class="muted">Aún no has contado productos.</p>'}</div><div class="quick-row">${c.estado!=='CERRADO'?`<button id="pauseCount" class="secondary">${c.estado==='PAUSADO'?'Reanudar':'Pausar'}</button>`:''}${S.admin&&c.estado!=='CERRADO'?'<button id="closeCount" class="danger">Cerrar y ajustar</button>':''}</div>`;
  $('exitCount').onclick=()=>{S.count=null;loadCounts()};
  $('scanCount')?.addEventListener('click',()=>openScanner(findForCount,'UPC o SKU'));
  $('manualCount').onsubmit=e=>{e.preventDefault();findForCount($('countCode').value).catch(x=>toast(humanError(x),'error'))};
  $('pauseCount')?.addEventListener('click',async()=>{const next=c.estado==='PAUSADO'?'ABIERTO':'PAUSADO',r=await sb.from('conteos').update({estado:next}).eq('id',c.id).select().single();if(r.data){S.count=r.data;renderActiveCount()}});
  $('closeCount')?.addEventListener('click',closeCount);
}

async function findForCount(code) {
  stopScanner();
  if (S.count.estado==='PAUSADO') return toast('Reanuda el conteo primero.','error');
  const p=await findProduct(code);
  if (!p) return toast('Producto no encontrado.','error');
  const prev=await sb.from('conteo_lineas').select('contado').eq('conteo_id',S.count.id).eq('producto_id',p.id).maybeSingle();
  $('countProduct').innerHTML=`<div class="count-product"><div><div class="tiny">SKU ${esc(p.sku)}</div><h3>${esc(p.descripcion)}</h3><p class="muted">Sistema: ${p.stock} · Ya contado: ${prev.data?.contado||0}</p></div><label>Cantidad que tienes enfrente</label><input id="countQty" type="number" min="0" value="1" inputmode="numeric"><div class="quick-row"><button id="addCount" class="primary">Sumar al conteo</button><button id="setCount" class="secondary">Reemplazar total</button></div></div>`;
  const save=async add=>{
    const q=Math.max(0,Number($('countQty').value)||0), total=add?(prev.data?.contado||0)+q:q;
    const r=await sb.from('conteo_lineas').upsert({conteo_id:S.count.id,producto_id:p.id,sku:p.sku,contado:total,user_id:S.user.id,updated_at:new Date().toISOString()},{onConflict:'conteo_id,producto_id'});
    if (r.error) return toast(humanError(r.error),'error');
    toast(`Conteo guardado: ${total}`); renderActiveCount(); setTimeout(()=>openScanner(findForCount,'UPC o SKU'),300);
  };
  $('addCount').onclick=()=>save(true);
  $('setCount').onclick=()=>save(false);
}

async function closeCount() {
  const lines=await sb.from('conteo_lineas').select('producto_id,contado').eq('conteo_id',S.count.id);
  if (!confirm(`Cerrar conteo con ${lines.data?.length||0} productos contados? Los no contados NO cambian.`)) return;
  const r=await sb.rpc('cerrar_conteo',{p_conteo:S.count.id});
  if (r.error) return toast(humanError(r.error),'error');
  toast(`Conteo cerrado. ${r.data||0} ajustes registrados.`); S.count=null; loadCounts();
}

function importView() {
  if (!S.admin) { S.view='home'; return render(); }
  shell(`<section class="page-title"><button id="backHome" class="ghost">← Inicio</button><h1>Importar inventario</h1><p class="muted">El catálogo mensual completa automáticamente los SKU provisionales que coincidan exactamente y conserva su stock. Un ajuste físico es una operación distinta.</p></section><section class="card"><div class="quick-row"><label class="file-btn">Seleccionar Excel / CSV<input id="importFile" type="file" accept=".xlsx,.xls,.csv,text/csv"></label><button id="template" class="secondary">Descargar plantilla</button></div><div id="importBody"><p class="muted">Columnas sugeridas: SKU, UPC, Descripción, Marca, Talla, Color, Precio, Stock, Mínimo.</p></div></section>`);
  $('backHome').onclick=()=>{S.view='home';render()};
  $('importFile').onchange=readImportFile;
  $('template').onclick=downloadTemplate;
}

const MAX_IMPORT_ROWS=100000;
const IMPORT_BATCH_SIZE=500;

function normalizeImportCode(value,{upc=false}={}) {
  let x=cleanCodeText(value).replace(/\s+/g,'');
  if (!x) return '';
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(x)) {
    const n=Number(x);
    if (Number.isSafeInteger(n)) x=String(n);
  }
  if (upc) x=x.replace(/-/g,'');
  return x;
}

async function readImportFile(e) {
  const f=e.target.files?.[0]; if (!f) return;
  try {
    const XLSX=await getSpreadsheet();
    const buf=await f.arrayBuffer();
    const wb=XLSX.read(buf,{type:'array',cellDates:false});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const arr=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
    if (arr.length<2) return toast('El archivo no tiene filas de datos.','error');
    const rows=arr.slice(1).filter(r=>r.some(x=>String(x).trim()!==''));
    if (rows.length>MAX_IMPORT_ROWS) return toast(`El máximo por importación es ${MAX_IMPORT_ROWS.toLocaleString('es-MX')} filas. Divide el archivo en bloques.`,'error');
    S.importHeaders=arr[0].map(x=>String(x).replace(/\u00A0/g,' ').trim());
    S.importRows=rows;
    autoMap();
    renderImportMapping();
  } catch(err) {
    toast('No pude leer ese Excel/CSV. Verifica que el archivo no esté dañado.','error');
  }
}

function autoMap() {
  const syn={sku:['sku','código','codigo','articulo','artículo'],upc:['upc','ean','barcode','código de barras','codigo de barras'],descripcion:['descripcion','descripción','producto','nombre'],marca:['marca'],talla:['talla'],color:['color'],precio:['precio','price'],stock:['stock','existencia','existencias','cantidad'],minimo:['minimo','mínimo','stock minimo','stock mínimo']};
  for (const k of Object.keys(S.importMap)) {
    const ix=S.importHeaders.findIndex(h=>syn[k].some(s=>h.toLowerCase().trim()===s));
    S.importMap[k]=ix>=0?String(ix):'';
  }
}

function renderImportMapping() {
  const fields=[['sku','SKU *'],['upc','UPC'],['descripcion','Descripción'],['marca','Marca'],['talla','Talla'],['color','Color'],['precio','Precio'],['stock','Stock'],['minimo','Mínimo']];
  $('importBody').innerHTML=`<h3>1. Revisa las columnas</h3><div class="map-grid">${fields.map(([k,l])=>`<label>${l}<select data-map="${k}"><option value="">— No importar —</option>${S.importHeaders.map((h,i)=>`<option value="${i}" ${S.importMap[k]===String(i)?'selected':''}>${esc(h||'Columna '+(i+1))}</option>`).join('')}</select></label>`).join('')}</div><h3>2. Vista previa</h3><div class="table-scroll"><table><thead><tr>${S.importHeaders.slice(0,8).map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${S.importRows.slice(0,10).map(r=>`<tr>${r.slice(0,8).map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><h3>3. ¿Qué quieres hacer?</h3><div class="import-options"><label><input type="radio" name="imode" value="catalog" checked> <b>Actualizar catálogo</b><span>Completa SKU nuevos por coincidencia exacta. Conserva existencias escaneadas.</span></label><label><input type="radio" name="imode" value="physical"> <b>Catálogo + inventario físico</b><span>Ajusta el stock al valor del archivo y deja cada diferencia en historial.</span></label></div><button id="runImport" class="primary">Importar ${S.importRows.length.toLocaleString('es-MX')} filas</button><div id="importProgress"></div>`;
  document.querySelectorAll('[data-map]').forEach(s=>s.onchange=()=>S.importMap[s.dataset.map]=s.value);
  $('runImport').onclick=runImport;
}

function mappedItems(mode='catalog') {
  const get=(r,k)=>S.importMap[k]===''?'':r[Number(S.importMap[k])];
  const num=v=>{let x=String(v??'').trim().replace(/[$\s]/g,'');if(x.includes(',')&&!x.includes('.'))x=x.replace(',','.');else x=x.replace(/,/g,'');const n=Number(x);return Number.isFinite(n)?n:0};
  const bySku=new Map();
  const upcOwner=new Map();
  const conflicts=[];
  let duplicateSkuRows=0;

  for (const r of S.importRows) {
    const sku=normalizeImportCode(get(r,'sku'));
    if (!sku) continue;
    const upc=normalizeImportCode(get(r,'upc'),{upc:true});
    const item={sku,upc,descripcion:String(get(r,'descripcion')).trim(),marca:String(get(r,'marca')).trim(),talla:String(get(r,'talla')).trim(),color:String(get(r,'color')).trim(),precio:num(get(r,'precio')),stock:Math.round(num(get(r,'stock'))),minimo:Math.max(0,Math.round(num(get(r,'minimo'))))};

    if (upc) {
      const canonical=upc.replace(/^0+(?=\d)/,'');
      const owner=upcOwner.get(canonical);
      if (owner && owner!==sku && conflicts.length<12) conflicts.push(`UPC ${upc}: SKU ${owner} y ${sku}`);
      else if (!owner) upcOwner.set(canonical,sku);
    }

    const prev=bySku.get(sku);
    if (prev) {
      duplicateSkuRows++;
      const a=prev.upc?.replace(/^0+(?=\d)/,'')||'';
      const b=upc?.replace(/^0+(?=\d)/,'')||'';
      if (a && b && a!==b && conflicts.length<12) conflicts.push(`SKU ${sku}: UPC ${prev.upc} y ${upc}`);
      prev.upc=prev.upc||item.upc;
      prev.descripcion=item.descripcion||prev.descripcion;
      prev.marca=item.marca||prev.marca;
      prev.talla=item.talla||prev.talla;
      prev.color=item.color||prev.color;
      if (item.precio) prev.precio=item.precio;
      if (mode==='physical') prev.stock+=item.stock;
      continue;
    }
    bySku.set(sku,item);
  }
  return {items:[...bySku.values()],duplicateSkuRows,conflicts};
}

function retryableImportError(error) {
  const x=String(error?.message||error?.details||error?.code||'');
  return /fetch|network|timeout|timed out|502|503|504|connection/i.test(x);
}

async function rpcWithRetry(name,payload,maxAttempts=3) {
  let last=null;
  for (let attempt=1; attempt<=maxAttempts; attempt++) {
    const r=await sb.rpc(name,payload);
    if (!r.error) return r;
    last=r.error;
    if (!retryableImportError(r.error) || attempt===maxAttempts) break;
    await new Promise(resolve=>setTimeout(resolve,300*attempt));
  }
  return {data:null,error:last};
}

async function runImport() {
  const mode=document.querySelector('input[name="imode"]:checked').value;
  const prepared=mappedItems(mode), items=prepared.items;
  if (!items.length) return toast('No encontré SKUs para importar.','error');
  if (mode==='physical'&&S.importMap.stock==='') return toast('Selecciona la columna Stock.','error');
  if (prepared.conflicts.length) return toast(`Hay códigos ambiguos en el archivo. Corrige: ${prepared.conflicts.slice(0,3).join(' · ')}`,'error');
  if(mode==='physical'&&!confirm('Un inventario físico sustituye cantidades existentes por las del archivo, incluso en SKU que empezaron sin catálogo. ¿Continuar con el ajuste físico?'))return;

  const b=$('runImport'); b.disabled=true;
  let done=0, summary={};
  try {
    for (let i=0;i<items.length;i+=IMPORT_BATCH_SIZE) {
      const batch=items.slice(i,i+IMPORT_BATCH_SIZE);
      const r=await rpcWithRetry('importar_catalogo',{p_departamento:S.deptId,p_items:batch});
      if (r.error) throw r.error;
      Object.keys(r.data||{}).forEach(k=>summary[k]=(summary[k]||0)+(r.data[k]||0));
      if (mode==='physical') {
        const a=await rpcWithRetry('ajuste_fisico_masivo',{p_items:batch.map(x=>({sku:x.sku,stock:x.stock})),p_nota:`Importación física · ${deptName()}`});
        if (a.error) throw a.error;
        Object.keys(a.data||{}).forEach(k=>summary[k]=(summary[k]||0)+(a.data[k]||0));
      }
      done+=batch.length;
      if ($('importProgress')) $('importProgress').innerHTML=`<div class="progress"><i style="width:${Math.round(done/items.length*100)}%"></i></div><p class="tiny">${done.toLocaleString('es-MX')} / ${items.length.toLocaleString('es-MX')}</p>`;
    }
    const dup=prepared.duplicateSkuRows?` · Filas SKU consolidadas: ${prepared.duplicateSkuRows}`:'';
    if ($('importProgress')) $('importProgress').innerHTML+=`<div class="success">Importación terminada. Nuevos: ${summary.nuevos||0} · Actualizados: ${summary.actualizados||0}${mode==='physical'?` · Ajustados: ${summary.ajustados||0}`:''}${dup}</div>`;
    toast(mode==='catalog'?'Catálogo enlazado por SKU; existencias conservadas.':'Importación física terminada.');
  } catch(e) {
    if ($('importProgress')) $('importProgress').innerHTML+=`<div class="error">Se detuvo en ${done.toLocaleString('es-MX')} de ${items.length.toLocaleString('es-MX')}: ${esc(humanError(e))}</div>`;
    toast(humanError(e),'error');
  } finally {
    b.disabled=false;
  }
}

async function downloadTemplate() {
  try {
  const XLSX=await getSpreadsheet();
  const ws=XLSX.utils.json_to_sheet([{SKU:'1000001',UPC:'750000000001',Descripción:'Producto ejemplo',Marca:'Marca',Talla:'M',Color:'Negro',Precio:499,Stock:10,Mínimo:2}]), wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Inventario'); XLSX.writeFile(wb,'plantilla_inventario.xlsx');
  } catch {toast('No se pudo cargar Excel. Comprueba tu conexión y reintenta.','error');}
}

let historyRows=[];
function historyView() {
  if (!S.admin) { S.view='home'; return render(); }
  shell(`<section class="page-title"><h1>Historial</h1><p class="muted">Auditoría de movimientos por departamento. El nombre del vendedor queda en Nota.</p></section><section class="card"><div class="filter-grid"><label>Desde<input id="hFrom" type="date"></label><label>Hasta<input id="hTo" type="date"></label><label>Tipo<select id="hType"><option value="">Todos</option><option>ENTRADA</option><option>SALIDA</option><option>AJUSTE</option></select></label><label>Nombre / nota<input id="hUser" placeholder="Ej. Laura"></label><label>SKU / UPC<input id="hCode" placeholder="Código"></label><label>Ubicación<input id="hLoc" placeholder="Marbete"></label></div><div class="quick-row"><button id="hSearch" class="primary">Aplicar filtros</button><button id="hCSV" class="secondary">CSV</button><button id="hXLSX" class="secondary">Excel</button></div><div id="historyList"><div class="skeleton"></div></div></section>`);
  const d=new Date(),f=new Date(); f.setDate(d.getDate()-7);
  $('hFrom').value=f.toISOString().slice(0,10); $('hTo').value=d.toISOString().slice(0,10);
  $('hSearch').onclick=loadHistory; $('hCSV').onclick=()=>exportHistory('csv'); $('hXLSX').onclick=()=>exportHistory('xlsx'); loadHistory();
}

async function loadHistory() {
  let q=sb.from('movimientos').select('tipo,sku,upc,descripcion,cantidad,impacto,stock_anterior,stock_resultante,user_nombre,empleado_puesto,marbete_codigo,nota,created_at').eq('departamento_id',S.deptId).gt('created_at',HISTORY_RESTART_CUTOFF).order('created_at',{ascending:false}).limit(1000);
  const from=$('hFrom').value,to=$('hTo').value,type=$('hType').value,user=$('hUser').value.trim(),code=$('hCode').value.trim(),loc=$('hLoc').value.trim();
  if (from) q=q.gte('created_at',`${from}T00:00:00`);
  if (to) q=q.lte('created_at',`${to}T23:59:59`);
  if (type) q=q.eq('tipo',type);
  if (user) q=q.or(`user_nombre.ilike.%${user.replace(/[,%]/g,' ')}%,nota.ilike.%${user.replace(/[,%]/g,' ')}%`);
  if (loc) q=q.ilike('marbete_codigo',`%${loc}%`);
  if (code) q=q.or(`sku.ilike.%${code.replace(/[,%]/g,' ')}%,upc.ilike.%${code.replace(/[,%]/g,' ')}%`);
  const r=await q;
  historyRows=r.data||[];
  if (!$('historyList')) return;
  $('historyList').innerHTML=historyRows.map(x=>`<div class="history-row"><div><b class="${x.tipo==='SALIDA'?'txt-red':x.tipo==='ENTRADA'?'txt-green':''}">${esc(x.tipo)} · ${esc(x.sku)}</b><span>${esc(x.descripcion||'')}</span><span>${x.marbete_codigo?'Ubicación '+esc(x.marbete_codigo):''}</span><span>${new Date(x.created_at).toLocaleString('es-MX')}</span>${x.nota?`<span class="history-note">Nota: ${esc(x.nota)}</span>`:''}</div><div class="right"><strong>${x.impacto>0?'+':''}${x.impacto}</strong><span>${x.stock_anterior??'—'} → ${x.stock_resultante}</span></div></div>`).join('')||'<p class="muted">Sin movimientos.</p>';
}

async function exportHistory(kind) {
  const rows=historyRows.map(x=>({Fecha:new Date(x.created_at).toLocaleString('es-MX'),Tipo:x.tipo,SKU:x.sku,UPC:x.upc||'',Descripción:x.descripcion||'',Cantidad:x.cantidad,Impacto:x.impacto,'Stock antes':x.stock_anterior,'Stock después':x.stock_resultante,Acceso:x.user_nombre||'',Ubicación:x.marbete_codigo||'',Nota:x.nota||''}));
  if (!rows.length) return toast('No hay datos para exportar.','error');
  let XLSX;
  try {XLSX=await getSpreadsheet();}
  catch {toast('No se pudo cargar el exportador. Comprueba tu conexión.','error');return;}
  const ws=XLSX.utils.json_to_sheet(rows);
  if (kind==='csv') { const csv=XLSX.utils.sheet_to_csv(ws); downloadBlob(csv,'historial.csv','text/csv;charset=utf-8'); }
  else { const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Historial'); XLSX.writeFile(wb,'historial_inventario.xlsx'); }
}

function downloadBlob(text,name,type) {
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function adminView() {
  if (!S.admin) { S.view='home'; return render(); }
  shell(`<section class="page-title"><h1>Ajustes</h1><p class="muted">Departamentos, ubicaciones y operación. Sin módulo de empleados.</p></section><div class="tabs-row"><button data-atab="departments" class="tabbtn">Departamentos</button><button data-atab="locations" class="tabbtn">Ubicaciones</button><button data-atab="onboarding" class="tabbtn">Guía</button></div><section id="adminBody" class="card"></section>`);
  document.querySelectorAll('[data-atab]').forEach(b=>b.onclick=()=>loadAdminTab(b.dataset.atab));
  loadAdminTab('departments');
}

async function loadAdminTab(tab) {
  document.querySelectorAll('[data-atab]').forEach(b=>b.classList.toggle('active',b.dataset.atab===tab));
  const box=$('adminBody');
  box.classList.remove('tab-enter'); void box.offsetWidth; box.classList.add('tab-enter');

  if (tab==='departments') {
    const r=await sb.from('departamentos').select('*').gt('created_at',VISUAL_CLEANUP_CUTOFF).order('nombre');
    box.innerHTML=`<h3>Departamentos</h3><form id="newDept" class="inline-form"><input id="deptName" placeholder="Nuevo departamento"><button class="primary">Crear</button></form>${(r.data||[]).map(d=>`<div class="product-row"><div><b>${esc(d.nombre)}</b><span>${d.activo?'Activo':'Inactivo'}</span></div><button class="mini" data-toggle-dept="${d.id}" data-active="${d.activo}">${d.activo?'Desactivar':'Activar'}</button></div>`).join('')}`;
    $('newDept').onsubmit=async e=>{e.preventDefault();const name=$('deptName').value.trim();if(!name)return;const x=await sb.from('departamentos').insert({nombre:name});if(x.error)return toast(humanError(x.error),'error');await loadDepartments();toast('Departamento creado.');loadAdminTab('departments')};
    document.querySelectorAll('[data-toggle-dept]').forEach(b=>b.onclick=async()=>{await sb.from('departamentos').update({activo:b.dataset.active!=='true'}).eq('id',b.dataset.toggleDept);await loadDepartments();loadAdminTab('departments')});
    return;
  }

  if (tab==='locations') {
    const r=await sb.from('marbetes').select('*').eq('departamento_id',S.deptId).gt('created_at',VISUAL_CLEANUP_CUTOFF).order('zona').order('codigo').limit(200);
    box.innerHTML=`<h3>Ubicaciones · ${esc(deptName())}</h3><div class="two"><div><label>Código / marbete</label><input id="locCode"></div><div><label>Tipo</label><input id="locZone" list="zones" placeholder="BODEGA"><datalist id="zones"><option>BODEGA</option><option>PISO</option><option>CAJA</option><option>MUEBLE</option><option>RACK</option><option>CAJÓN</option></datalist></div></div><label>Descripción</label><input id="locDesc" placeholder="Ej. Rack A, nivel 2"><button id="saveLoc" class="primary">Guardar ubicación</button><hr><h3>Asignar producto</h3><div class="two"><div><label>UPC / SKU</label><input id="assignProduct"></div><div><label>Ubicación</label><input id="assignLoc"></div></div><label>Cantidad ubicada (opcional)</label><input id="assignQty" type="number" min="0"><button id="saveAssign" class="secondary">Asignar</button><hr><h3>Registradas</h3>${(r.data||[]).map(m=>`<div class="product-row"><div><b>${esc(m.codigo)}</b><span>${esc(m.zona)}${m.descripcion?' · '+esc(m.descripcion):''}</span></div><span class="pill">${m.activo?'Activa':'Inactiva'}</span></div>`).join('')||'<p class="muted">Aún no hay ubicaciones.</p>'}`;
    $('saveLoc').onclick=async()=>{const codigo=$('locCode').value.trim(),zona=$('locZone').value.trim().toUpperCase();if(!codigo||!zona)return toast('Falta código o tipo.','error');const x=await sb.from('marbetes').upsert({codigo,zona,descripcion:$('locDesc').value.trim()||null,activo:true,departamento_id:S.deptId,created_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'codigo'});if(x.error)return toast(humanError(x.error),'error');toast('Ubicación guardada.');loadAdminTab('locations')};
    $('saveAssign').onclick=async()=>{const p=await findProduct($('assignProduct').value),mar=$('assignLoc').value.trim();if(!p)return toast('Producto no encontrado.','error');const m=await sb.from('marbetes').select('codigo').eq('codigo',mar).eq('departamento_id',S.deptId).maybeSingle();if(!m.data)return toast('Ubicación no encontrada.','error');const v=$('assignQty').value.trim(),x=await sb.from('producto_marbetes').upsert({sku:p.sku,marbete_codigo:mar,cantidad:v===''?null:Math.max(0,Number(v)||0),updated_at:new Date().toISOString()},{onConflict:'sku,marbete_codigo'});if(x.error)return toast(humanError(x.error),'error');toast('Producto asignado.')};
    return;
  }

  box.innerHTML=`<h3>Cómo operar esta versión</h3><ol class="guide"><li><b>Administrador</b><span>Tu acceso 99 conserva configuración, importaciones, historial, ubicaciones y cierre de conteos.</span></li><li><b>Vendedor general</b><span>Todo el equipo entra con clave 10 y PIN 1010.</span></li><li><b>Nombre en Nota</b><span>En entradas y salidas cada vendedor escribe su nombre. Ya no se crean ni administran empleados.</span></li><li><b>Importar catálogo</b><span>Sube Excel o CSV desde el acceso administrador.</span></li><li><b>Escanear y trabajar</b><span>UPC, SKU y marbetes desde el celular, sin pasos extra.</span></li></ol><div class="access-summary"><div><span>ADMIN</span><b>99</b><small>PIN privado</small></div><div><span>VENTA</span><b>10</b><small>PIN 1010</small></div></div>`;
}

function openScanner(cb,label) {
  startScanner(async code=>{try{await cb(code)}catch(e){toast(humanError(e),'error')}},label,{qrEnabled:/marbete/i.test(label)}).catch(()=>toast('No se pudo abrir la cámara. Revisa el permiso del navegador.','error'));
}

function toast(text,type='success') {
  let el=document.getElementById('toast');
  if(!el){el=document.createElement('div');el.id='toast';document.body.appendChild(el)}
  el.className=`toast ${type}`;
  el.textContent=text;
  if(type==='success') { try{navigator.vibrate?.(25)}catch{} }
  clearTimeout(window.__toastTimer);
  window.__toastTimer=setTimeout(()=>el.remove(),3200);
}

boot();
