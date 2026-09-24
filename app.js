import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';
import { startScanner, stopScanner } from './scanner.js';

const sb = createClient(
  'https://dkqovohxkxlcccvagpij.supabase.co',
  'sb_publishable_iz06RtaObND0dWOpuX2vKg_wZVbrZCv',
  { auth: { persistSession: true, autoRefreshToken: true } }
);

const app = document.getElementById('app');
const $ = id => document.getElementById(id);
const esc = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const APP_VERSION = '3.3.0';

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
  count: null,
  importHeaders: [],
  importRows: [],
  importMap: { sku:'', upc:'', descripcion:'', marca:'', talla:'', color:'', precio:'', stock:'', minimo:'' }
};

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
  const r = await sb.from('departamentos').select('id,nombre,activo').eq('activo', true).order('nombre');
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
  app.innerHTML = `<div class="app-shell">${header()}<main class="content view-enter">${body}</main>${nav()}</div>`;
  wireShell();
}

function wireShell() {
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    stopScanner();
    S.view = b.dataset.view;
    S.product = null;
    S.searchResult = null;
    render();
  });
  $('logout').onclick = async () => {
    stopScanner();
    cleanupLegacyAccess();
    await sb.auth.signOut();
    location.reload();
  };
  $('deptSelect')?.addEventListener('change', e => {
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

function kpi(label,val,cls='') { return `<div class="kpi ${cls}"><span>${label}</span><strong>${val}</strong></div>`; }

async function homeView() {
  shell(`
    <section class="hero">
      <div><div class="eyebrow">${esc(deptName())}</div><h1>¿Qué necesitas hacer?</h1><p class="muted">Elige una acción. La app te guía paso a paso.</p></div>
      <div class="live-badge"><i></i> En línea</div>
    </section>
    <section class="action-grid">
      <button class="action-card green" data-act="ENTRADA"><b>＋</b><strong>Recibir mercancía</strong><span>Agregar lo que entra</span></button>
      <button class="action-card red" data-act="SALIDA"><b>−</b><strong>Sacar de bodega</strong><span>Registrar lo que sale</span></button>
      <button class="action-card" data-go="search"><b>⌕</b><strong>Buscar producto</strong><span>UPC, SKU o ubicación</span></button>
      <button class="action-card" data-go="count"><b>✓</b><strong>Inventario físico</strong><span>Contar y detectar diferencias</span></button>
    </section>
    <section class="card"><div class="section-head"><h3>Hoy</h3><span class="tiny">Actualización en tiempo real</span></div><div id="summary" class="kpis"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></section>
    ${S.admin ? `<section class="card"><h3>Estado de la operación</h3><div id="checklist"><div class="skeleton"></div></div></section><section class="quick-row"><button data-go="import" class="secondary">Importar Excel / CSV</button><button data-go="history" class="secondary">Ver historial</button></section>` : `<section class="tip-card"><b>Tip rápido</b><span>En cada entrada o salida escribe tu nombre en “Nota”. Así queda claro quién realizó el movimiento.</span></section>`}
  `);
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => { S.moveType=b.dataset.act; S.view='move'; render(); });
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { S.view=b.dataset.go; render(); });

  const [sum,loc] = await Promise.all([
    sb.rpc('resumen_departamento',{p_departamento:S.deptId}),
    sb.from('marbetes').select('*',{count:'exact',head:true}).eq('departamento_id',S.deptId).eq('activo',true)
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

function moveView() {
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
  $('manualMove').onsubmit = e => { e.preventDefault(); findForMove($('manualCode').value); };
  $('saveMove')?.addEventListener('click', saveMove);
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

async function findProduct(code) {
  code = String(code||'').trim();
  if (!code) return null;
  const r = await sb.rpc('buscar_producto_codigo',{p_codigo:code});
  const p = r.data?.[0];
  if (!p || p.departamento_id !== S.deptId) return null;
  return p;
}

async function loadLocations(sku) {
  const r = await sb.from('producto_marbetes').select('marbete_codigo,cantidad,marbetes(zona,descripcion,activo,departamento_id)').eq('sku',sku);
  return (r.data||[]).filter(x => x.marbetes?.activo !== false).map(x => ({marbete_codigo:x.marbete_codigo,cantidad:x.cantidad,zona:x.marbetes?.zona||'',descripcion:x.marbetes?.descripcion||''}));
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
  shell(`<section class="page-title"><h1>Buscar</h1><p class="muted">Escanea UPC, SKU o un marbete.</p></section><button id="scanSearch" class="scan-btn">📷 Escanear código</button><form id="manualSearch" class="inline-form"><input id="searchCode" placeholder="UPC, SKU o marbete" autocomplete="off"><button class="secondary">Buscar</button></form><section class="card">${searchResultHtml()}</section>`);
  $('scanSearch').onclick = () => openScanner(doSearch,'UPC, SKU o marbete');
  $('manualSearch').onsubmit = e => { e.preventDefault(); doSearch($('searchCode').value); };
}

function searchResultHtml() {
  if (!S.searchResult) return '<div class="empty small-empty"><div class="empty-icon">⌕</div><p>Escanea un código para ver stock y ubicación.</p></div>';
  if (S.searchType==='product') {
    const p=S.searchResult;
    return `<div class="product-head"><div><div class="tiny">SKU ${esc(p.sku)}${p.upc?' · UPC '+esc(p.upc):''}</div><h2>${esc(p.descripcion)}</h2><p class="muted">${esc([p.marca,p.talla,p.color].filter(Boolean).join(' · '))}</p></div><div class="stock-big">${p.stock}<span>piezas</span></div></div>${locationList(S.locations)}`;
  }
  const m=S.searchResult;
  return `<div><div class="tiny">Ubicación</div><h2>${esc(m.codigo)}</h2><p><span class="pill">${esc(m.zona)}</span> ${esc(m.descripcion||'')}</p><div>${(m.products||[]).map(p => `<div class="product-row"><div><b>${esc(p.descripcion)}</b><span>SKU ${esc(p.sku)}${p.upc?' · UPC '+esc(p.upc):''}</span></div><strong>${p.qty??'—'}</strong></div>`).join('')||'<p class="muted">No hay productos asignados.</p>'}</div></div>`;
}

async function doSearch(code) {
  stopScanner();
  code=String(code||'').trim();
  if (!code) return;
  const p=await findProduct(code);
  if (p) {
    S.searchType='product'; S.searchResult=p; S.locations=await loadLocations(p.sku); return render();
  }
  const mr=await sb.from('marbetes').select('codigo,zona,descripcion').eq('codigo',code).eq('activo',true).eq('departamento_id',S.deptId).maybeSingle();
  if (!mr.data) { S.searchResult=null; render(); return toast('Código no encontrado.','error'); }
  const pm=await sb.from('producto_marbetes').select('sku,cantidad').eq('marbete_codigo',code);
  const skus=(pm.data||[]).map(x=>x.sku);
  let products=[];
  if (skus.length) {
    const pr=await sb.from('productos').select('sku,upc,descripcion').in('sku',skus);
    products=(pr.data||[]).map(p=>({...p,qty:(pm.data||[]).find(x=>x.sku===p.sku)?.cantidad}));
  }
  S.searchType='marbete';
  S.searchResult={...mr.data,products};
  render();
}

function inventoryView() {
  shell(`<section class="page-title"><h1>Inventario</h1><p class="muted">Busca y consulta existencias en ${esc(deptName())}.</p></section><div class="card"><div class="inline-form"><input id="invQ" placeholder="SKU, UPC, descripción, marca…"><select id="stockFilter" class="compact"><option value="all">Todos</option><option value="positive">Con stock</option><option value="zero">Agotados</option><option value="low">Stock bajo</option></select></div><div id="invList"><div class="skeleton"></div></div></div>`);
  let t;
  const run=()=>{clearTimeout(t);t=setTimeout(loadInventory,160)};
  $('invQ').oninput=run;
  $('stockFilter').onchange=run;
  loadInventory();
}

async function loadInventory() {
  const q=$('invQ')?.value.trim()||'', f=$('stockFilter')?.value||'all';
  let req=sb.from('productos').select('id,sku,upc,descripcion,marca,talla,color,precio,stock,stock_minimo').eq('activo',true).eq('departamento_id',S.deptId).order('descripcion').limit(100);
  if (q) {
    const s=q.replace(/[,%]/g,' ');
    req=req.or(`sku.ilike.%${s}%,upc.ilike.%${s}%,descripcion.ilike.%${s}%,marca.ilike.%${s}%,talla.ilike.%${s}%,color.ilike.%${s}%`);
  }
  if (f==='positive') req=req.gt('stock',0);
  if (f==='zero') req=req.lte('stock',0);
  const r=await req;
  let rows=r.data||[];
  if (f==='low') rows=rows.filter(p=>p.stock>0&&p.stock<=p.stock_minimo);
  if (!$('invList')) return;
  $('invList').innerHTML=rows.map(p=>`<div class="product-row"><div><b>${esc(p.descripcion)}</b><span>SKU ${esc(p.sku)}${p.upc?' · UPC '+esc(p.upc):''}</span><span>${esc([p.marca,p.talla,p.color].filter(Boolean).join(' · '))}</span></div><div class="right"><strong>${p.stock}</strong>${S.admin?`<button class="mini" data-edit="${p.id}">Editar</button>`:''}</div></div>`).join('')||'<p class="muted">Sin resultados.</p>';
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editProduct(b.dataset.edit,rows.find(x=>x.id===b.dataset.edit)));
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
  const r=await sb.from('conteos').select('*').eq('departamento_id',S.deptId).order('created_at',{ascending:false}).limit(20);
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
  $('manualCount').onsubmit=e=>{e.preventDefault();findForCount($('countCode').value)};
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
  shell(`<section class="page-title"><button id="backHome" class="ghost">← Inicio</button><h1>Importar inventario</h1><p class="muted">Excel o CSV. Tú decides si solo actualiza catálogo o también ajusta existencias.</p></section><section class="card"><div class="quick-row"><label class="file-btn">Seleccionar Excel / CSV<input id="importFile" type="file" accept=".xlsx,.xls,.csv,text/csv"></label><button id="template" class="secondary">Descargar plantilla</button></div><div id="importBody"><p class="muted">Columnas sugeridas: SKU, UPC, Descripción, Marca, Talla, Color, Precio, Stock, Mínimo.</p></div></section>`);
  $('backHome').onclick=()=>{S.view='home';render()};
  $('importFile').onchange=readImportFile;
  $('template').onclick=downloadTemplate;
}

async function readImportFile(e) {
  const f=e.target.files?.[0]; if (!f) return;
  const buf=await f.arrayBuffer(), wb=XLSX.read(buf,{type:'array'}), ws=wb.Sheets[wb.SheetNames[0]], arr=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
  if (arr.length<2) return toast('El archivo no tiene filas de datos.','error');
  S.importHeaders=arr[0].map(x=>String(x).trim());
  S.importRows=arr.slice(1).filter(r=>r.some(x=>String(x).trim()!==''));
  autoMap(); renderImportMapping();
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
  $('importBody').innerHTML=`<h3>1. Revisa las columnas</h3><div class="map-grid">${fields.map(([k,l])=>`<label>${l}<select data-map="${k}"><option value="">— No importar —</option>${S.importHeaders.map((h,i)=>`<option value="${i}" ${S.importMap[k]===String(i)?'selected':''}>${esc(h||'Columna '+(i+1))}</option>`).join('')}</select></label>`).join('')}</div><h3>2. Vista previa</h3><div class="table-scroll"><table><thead><tr>${S.importHeaders.slice(0,8).map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${S.importRows.slice(0,10).map(r=>`<tr>${r.slice(0,8).map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><h3>3. ¿Qué quieres hacer?</h3><div class="import-options"><label><input type="radio" name="imode" value="catalog" checked> <b>Actualizar catálogo</b><span>No cambia stock existente.</span></label><label><input type="radio" name="imode" value="physical"> <b>Catálogo + inventario físico</b><span>Ajusta el stock al valor del archivo y deja cada diferencia en historial.</span></label></div><button id="runImport" class="primary">Importar ${S.importRows.length.toLocaleString('es-MX')} filas</button><div id="importProgress"></div>`;
  document.querySelectorAll('[data-map]').forEach(s=>s.onchange=()=>S.importMap[s.dataset.map]=s.value);
  $('runImport').onclick=runImport;
}

function mappedItems() {
  const get=(r,k)=>S.importMap[k]===''?'':r[Number(S.importMap[k])];
  const num=v=>{let s=String(v??'').trim().replace(/[$\s]/g,'');if(s.includes(',')&&!s.includes('.'))s=s.replace(',','.');else s=s.replace(/,/g,'');const n=Number(s);return Number.isFinite(n)?n:0};
  return S.importRows.map(r=>({sku:String(get(r,'sku')).trim(),upc:String(get(r,'upc')).trim(),descripcion:String(get(r,'descripcion')).trim(),marca:String(get(r,'marca')).trim(),talla:String(get(r,'talla')).trim(),color:String(get(r,'color')).trim(),precio:num(get(r,'precio')),stock:Math.round(num(get(r,'stock'))),minimo:Math.round(num(get(r,'minimo')))})).filter(x=>x.sku);
}

async function runImport() {
  const mode=document.querySelector('input[name="imode"]:checked').value, items=mappedItems();
  if (!items.length) return toast('No encontré SKUs para importar.','error');
  if (mode==='physical'&&S.importMap.stock==='') return toast('Selecciona la columna Stock.','error');
  const b=$('runImport'); b.disabled=true;
  let done=0, summary={};
  try {
    for (let i=0;i<items.length;i+=250) {
      const batch=items.slice(i,i+250), r=await sb.rpc('importar_catalogo',{p_departamento:S.deptId,p_items:batch});
      if (r.error) throw r.error;
      Object.keys(r.data||{}).forEach(k=>summary[k]=(summary[k]||0)+(r.data[k]||0));
      if (mode==='physical') {
        const a=await sb.rpc('ajuste_fisico_masivo',{p_items:batch.map(x=>({sku:x.sku,stock:x.stock})),p_nota:`Importación física · ${deptName()}`});
        if (a.error) throw a.error;
        Object.keys(a.data||{}).forEach(k=>summary[k]=(summary[k]||0)+(a.data[k]||0));
      }
      done+=batch.length;
      $('importProgress').innerHTML=`<div class="progress"><i style="width:${Math.round(done/items.length*100)}%"></i></div><p class="tiny">${done} / ${items.length}</p>`;
    }
    $('importProgress').innerHTML+=`<div class="success">Importación terminada. Nuevos: ${summary.nuevos||0} · Actualizados: ${summary.actualizados||0}${mode==='physical'?` · Ajustados: ${summary.ajustados||0}`:''}</div>`;
    toast('Importación terminada.');
  } catch(e) { toast(humanError(e),'error'); }
  finally { b.disabled=false; }
}

function downloadTemplate() {
  const ws=XLSX.utils.json_to_sheet([{SKU:'1000001',UPC:'750000000001',Descripción:'Producto ejemplo',Marca:'Marca',Talla:'M',Color:'Negro',Precio:499,Stock:10,Mínimo:2}]), wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Inventario'); XLSX.writeFile(wb,'plantilla_inventario.xlsx');
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
  let q=sb.from('movimientos').select('tipo,sku,upc,descripcion,cantidad,impacto,stock_anterior,stock_resultante,user_nombre,empleado_puesto,marbete_codigo,nota,created_at').eq('departamento_id',S.deptId).order('created_at',{ascending:false}).limit(1000);
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

function exportHistory(kind) {
  const rows=historyRows.map(x=>({Fecha:new Date(x.created_at).toLocaleString('es-MX'),Tipo:x.tipo,SKU:x.sku,UPC:x.upc||'',Descripción:x.descripcion||'',Cantidad:x.cantidad,Impacto:x.impacto,'Stock antes':x.stock_anterior,'Stock después':x.stock_resultante,Acceso:x.user_nombre||'',Ubicación:x.marbete_codigo||'',Nota:x.nota||''}));
  if (!rows.length) return toast('No hay datos para exportar.','error');
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
    const r=await sb.from('departamentos').select('*').order('nombre');
    box.innerHTML=`<h3>Departamentos</h3><form id="newDept" class="inline-form"><input id="deptName" placeholder="Nuevo departamento"><button class="primary">Crear</button></form>${(r.data||[]).map(d=>`<div class="product-row"><div><b>${esc(d.nombre)}</b><span>${d.activo?'Activo':'Inactivo'}</span></div><button class="mini" data-toggle-dept="${d.id}" data-active="${d.activo}">${d.activo?'Desactivar':'Activar'}</button></div>`).join('')}`;
    $('newDept').onsubmit=async e=>{e.preventDefault();const name=$('deptName').value.trim();if(!name)return;const x=await sb.from('departamentos').insert({nombre:name});if(x.error)return toast(humanError(x.error),'error');await loadDepartments();toast('Departamento creado.');loadAdminTab('departments')};
    document.querySelectorAll('[data-toggle-dept]').forEach(b=>b.onclick=async()=>{await sb.from('departamentos').update({activo:b.dataset.active!=='true'}).eq('id',b.dataset.toggleDept);await loadDepartments();loadAdminTab('departments')});
    return;
  }

  if (tab==='locations') {
    const r=await sb.from('marbetes').select('*').eq('departamento_id',S.deptId).order('zona').order('codigo').limit(200);
    box.innerHTML=`<h3>Ubicaciones · ${esc(deptName())}</h3><div class="two"><div><label>Código / marbete</label><input id="locCode"></div><div><label>Tipo</label><input id="locZone" list="zones" placeholder="BODEGA"><datalist id="zones"><option>BODEGA</option><option>PISO</option><option>CAJA</option><option>MUEBLE</option><option>RACK</option><option>CAJÓN</option></datalist></div></div><label>Descripción</label><input id="locDesc" placeholder="Ej. Rack A, nivel 2"><button id="saveLoc" class="primary">Guardar ubicación</button><hr><h3>Asignar producto</h3><div class="two"><div><label>UPC / SKU</label><input id="assignProduct"></div><div><label>Ubicación</label><input id="assignLoc"></div></div><label>Cantidad ubicada (opcional)</label><input id="assignQty" type="number" min="0"><button id="saveAssign" class="secondary">Asignar</button><hr><h3>Registradas</h3>${(r.data||[]).map(m=>`<div class="product-row"><div><b>${esc(m.codigo)}</b><span>${esc(m.zona)}${m.descripcion?' · '+esc(m.descripcion):''}</span></div><span class="pill">${m.activo?'Activa':'Inactiva'}</span></div>`).join('')||'<p class="muted">Aún no hay ubicaciones.</p>'}`;
    $('saveLoc').onclick=async()=>{const codigo=$('locCode').value.trim(),zona=$('locZone').value.trim().toUpperCase();if(!codigo||!zona)return toast('Falta código o tipo.','error');const x=await sb.from('marbetes').upsert({codigo,zona,descripcion:$('locDesc').value.trim()||null,activo:true,departamento_id:S.deptId,updated_at:new Date().toISOString()},{onConflict:'codigo'});if(x.error)return toast(humanError(x.error),'error');toast('Ubicación guardada.');loadAdminTab('locations')};
    $('saveAssign').onclick=async()=>{const p=await findProduct($('assignProduct').value),mar=$('assignLoc').value.trim();if(!p)return toast('Producto no encontrado.','error');const m=await sb.from('marbetes').select('codigo').eq('codigo',mar).eq('departamento_id',S.deptId).maybeSingle();if(!m.data)return toast('Ubicación no encontrada.','error');const v=$('assignQty').value.trim(),x=await sb.from('producto_marbetes').upsert({sku:p.sku,marbete_codigo:mar,cantidad:v===''?null:Math.max(0,Number(v)||0),updated_at:new Date().toISOString()},{onConflict:'sku,marbete_codigo'});if(x.error)return toast(humanError(x.error),'error');toast('Producto asignado.')};
    return;
  }

  box.innerHTML=`<h3>Cómo operar esta versión</h3><ol class="guide"><li><b>Administrador</b><span>Tu acceso 99 conserva configuración, importaciones, historial, ubicaciones y cierre de conteos.</span></li><li><b>Vendedor general</b><span>Todo el equipo entra con clave 10 y PIN 1010.</span></li><li><b>Nombre en Nota</b><span>En entradas y salidas cada vendedor escribe su nombre. Ya no se crean ni administran empleados.</span></li><li><b>Importar catálogo</b><span>Sube Excel o CSV desde el acceso administrador.</span></li><li><b>Escanear y trabajar</b><span>UPC, SKU y marbetes desde el celular, sin pasos extra.</span></li></ol><div class="access-summary"><div><span>ADMIN</span><b>99</b><small>PIN privado</small></div><div><span>VENTA</span><b>10</b><small>PIN 1010</small></div></div>`;
}

function openScanner(cb,label) {
  startScanner(async code=>{try{await cb(code)}catch(e){toast(humanError(e),'error')}},label).catch(()=>toast('No se pudo abrir la cámara. Revisa el permiso del navegador.','error'));
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
