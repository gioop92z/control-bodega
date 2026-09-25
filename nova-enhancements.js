import { startScanner, stopScanner } from './scanner.js';

const NOVA_VERSION = '3.4.0';
const EMPLOYEE_KEY = 'nova.employeeNumber';
const SELLER_ACCESS = '10';
const SHARED_SELLER_PIN = '1010';

const $ = id => document.getElementById(id);
const htmlEsc = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const employeeNumber = () => (sessionStorage.getItem(EMPLOYEE_KEY) || '').trim();
const sellerActive = () => /Vendedor general|acceso\s*10/i.test(document.querySelector('.access-label')?.textContent || '');

function saveEmployeeNumber(value) {
  const clean = String(value || '').trim().slice(0, 80);
  if (!clean) return false;
  sessionStorage.setItem(EMPLOYEE_KEY, clean);
  return true;
}

function clearEmployeeNumber() {
  sessionStorage.removeItem(EMPLOYEE_KEY);
}

function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

function speakWelcome() {
  return new Promise(resolve => {
    try {
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return resolve();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance('Bienvenido a Nova');
      u.lang = 'es-MX';
      u.rate = 0.96;
      u.pitch = 1;
      u.volume = 1;
      const voices = speechSynthesis.getVoices?.() || [];
      u.voice = voices.find(v => /^es-MX$/i.test(v.lang)) || voices.find(v => /^es/i.test(v.lang)) || null;
      let ended = false;
      const done = () => { if (ended) return; ended = true; resolve(); };
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
      setTimeout(done, 1600);
    } catch {
      resolve();
    }
  });
}

function novaToast(text, type='success') {
  let el = $('novaToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'novaToast';
    document.body.appendChild(el);
  }
  el.className = `nova-toast ${type}`;
  el.textContent = text;
  clearTimeout(window.__novaToastTimer);
  window.__novaToastTimer = setTimeout(() => el.remove(), 3300);
}

async function scanEmployee(input, { autoSubmit=false, onDone=null }={}) {
  try {
    await startScanner(async raw => {
      stopScanner();
      const value = String(raw || '').trim();
      if (!value) return;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles:true }));
      if (onDone) return onDone(value);
      if (autoSubmit) input.closest('form')?.querySelector('button[type="submit"]')?.click();
    }, 'gafete o número de empleado');
  } catch {
    novaToast('No se pudo abrir la cámara. Revisa el permiso del navegador.', 'error');
  }
}

function syncLogin() {
  const form = $('loginForm');
  if (!form || form.dataset.novaEnhanced === '1') return;
  form.dataset.novaEnhanced = '1';

  const clave = $('clave');
  const pin = $('pin');
  const pinLabel = pin?.previousElementSibling;
  if (!clave || !pin) return;

  const scanBtn = document.createElement('button');
  scanBtn.type = 'button';
  scanBtn.id = 'scanEmployeeLogin';
  scanBtn.className = 'nova-scan-employee';
  scanBtn.innerHTML = '<span class="nova-scan-icon">▣</span><span><b>Escanear gafete</b><small>Usa la cámara del teléfono</small></span>';
  pin.insertAdjacentElement('afterend', scanBtn);

  const help = document.createElement('div');
  help.className = 'nova-login-help';
  help.innerHTML = '<b>Acceso vendedor libre</b><span>Clave 10 + tu número de empleado. No necesita registro previo.</span>';
  scanBtn.insertAdjacentElement('afterend', help);

  const mode = () => {
    const seller = clave.value.trim() === SELLER_ACCESS;
    scanBtn.hidden = !seller;
    help.hidden = !seller;
    setText(pinLabel, seller ? 'Gafete / número de empleado' : 'PIN de administrador');
    pin.type = seller ? 'text' : 'password';
    pin.inputMode = seller ? 'text' : 'numeric';
    pin.autocomplete = seller ? 'off' : 'current-password';
    pin.placeholder = seller ? 'Escanea o digita cualquier número' : 'Tu PIN privado';
  };

  clave.addEventListener('input', mode);
  clave.addEventListener('change', mode);
  scanBtn.addEventListener('click', () => scanEmployee(pin, { autoSubmit:true }));
  mode();

  setText(document.querySelector('.brandmark span'), 'N');
  setText(document.querySelector('.login-card .eyebrow'), `NOVA · Control inteligente · v${NOVA_VERSION}`);
  setText(document.querySelector('.login-card h1'), 'Nova');
  setText(document.querySelector('.login-card > .muted'), 'Inventario inteligente, trazable y listo para trabajar.');

  const cards = document.querySelectorAll('.login-accesses > div');
  if (cards[1] && cards[1].dataset.nova !== '1') {
    cards[1].dataset.nova = '1';
    cards[1].innerHTML = '<b>Vendedor</b><span>Clave 10 + gafete o número de empleado</span>';
  }
}

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'loginForm') return;

  const clave = $('clave')?.value.trim() || '';
  const pin = $('pin');
  const value = pin?.value.trim() || '';

  if (clave !== SELLER_ACCESS) {
    clearEmployeeNumber();
    return;
  }
  if (!value) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  saveEmployeeNumber(value);
  const handler = form.onsubmit;
  const submitter = event.submitter || form.querySelector('button[type="submit"]');
  if (submitter) {
    submitter.disabled = true;
    submitter.textContent = 'Identificando…';
  }

  await speakWelcome();

  if (typeof handler !== 'function') return;
  const visible = value;
  pin.value = SHARED_SELLER_PIN;
  try {
    await handler.call(form, { preventDefault(){}, submitter });
  } finally {
    if (document.contains(pin)) pin.value = visible;
  }
}, true);

function ensureIdentityGate() {
  if (!sellerActive() || employeeNumber() || $('novaIdentityGate')) return;

  const overlay = document.createElement('div');
  overlay.id = 'novaIdentityGate';
  overlay.className = 'nova-identity-gate';
  overlay.innerHTML = `
    <section class="nova-identity-card" role="dialog" aria-modal="true" aria-labelledby="novaIdentityTitle">
      <div class="nova-orbit-logo"><span>N</span></div>
      <div class="eyebrow">NOVA · IDENTIFICACIÓN</div>
      <h2 id="novaIdentityTitle">Identifica tu gafete</h2>
      <p>Esta sesión no tiene un número de empleado asociado. Identifícate antes de realizar movimientos.</p>
      <label>Número de empleado</label>
      <input id="novaGateEmployee" autocomplete="off" placeholder="Escanea o digita tu número">
      <div class="nova-gate-actions">
        <button id="novaGateScan" class="secondary" type="button">▣ Escanear gafete</button>
        <button id="novaGateContinue" class="primary" type="button">Continuar</button>
      </div>
      <small>Cualquier número no vacío permite continuar y queda asociado a la sesión actual.</small>
    </section>`;
  document.body.appendChild(overlay);

  const input = $('novaGateEmployee');
  const complete = async value => {
    if (!saveEmployeeNumber(value)) return novaToast('Digita o escanea tu número de empleado.', 'error');
    await speakWelcome();
    overlay.remove();
    syncAuthenticatedUI();
  };

  $('novaGateContinue').onclick = () => complete(input.value);
  $('novaGateScan').onclick = () => scanEmployee(input, { onDone:complete });
}

function employeeTaggedNote(raw='') {
  const emp = employeeNumber();
  const note = String(raw || '').trim();
  if (!emp) return note;
  const tag = `Empleado ${emp}`;
  if (note.toLowerCase().includes(tag.toLowerCase())) return note;
  return note ? `${tag} · ${note}` : tag;
}

document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  if (target.closest('#logout')) clearEmployeeNumber();
  if (target.closest('#saveMove') && sellerActive()) {
    const input = $('moveNote');
    if (input) input.value = employeeTaggedNote(input.value);
  }
}, true);

const tutorials = [
  ['Acceso del vendedor','10',['Clave 10','Escanear gafete','Bienvenido a Nova'],'El acceso vendedor es libre: el gafete identifica quién opera durante la sesión.',['Escribe 10 en Clave.','Escanea tu gafete o digita cualquier número de empleado.','Nova reproduce “Bienvenido a Nova”.','El número queda asociado a cada entrada y salida.']],
  ['Acceso administrador','99',['Clave 99','PIN privado','Ajustes'],'El administrador conserva su PIN privado y las funciones sensibles.',['Escribe 99.','Digita tu PIN privado.','Administra departamentos, ubicaciones, tutorial e historial.']],
  ['Pantalla de Inicio','⌂',['Entradas','Salidas','Buscar'],'Inicio concentra las tareas más frecuentes.',['Recibir mercancía agrega existencias.','Sacar de bodega descuenta existencias.','Buscar consulta SKU, UPC o marbete.','Inventario físico abre los conteos.']],
  ['Recibir mercancía','+',['SKU / UPC','Cantidad','Ubicación'],'Registra entradas y coloca mercancía en una ubicación.',['Escanea o digita el producto.','Confirma producto y cantidad.','Selecciona o escanea ubicación.','Agrega una nota opcional.','Nova agrega automáticamente el número de empleado.']],
  ['Sacar de bodega','−',['Producto','Existencia','Salida'],'Registra una salida con control de stock disponible.',['Escanea o digita el producto.','Revisa el stock actual.','Selecciona ubicación si aplica.','Indica cantidad y guarda.']],
  ['Buscar producto o marbete','⌕',['UPC','SKU','Marbete'],'Una sola búsqueda acepta códigos de producto y ubicación.',['Pulsa Escanear código o digita el valor.','Con SKU/UPC verás stock y ubicaciones.','Con marbete verás productos asociados.']],
  ['Inventario','▦',['Descripción','Stock','Filtros'],'Consulta el catálogo del departamento y filtra existencias.',['Busca por SKU, UPC, descripción, marca, talla o color.','Filtra con stock, agotados o stock bajo.','El administrador puede editar datos básicos del producto.']],
  ['Inventario físico','✓',['Nuevo conteo','Escanear','Diferencia'],'Compara lo contado físicamente contra el sistema.',['Crea o abre un conteo.','Escanea productos y captura cantidades.','Pausa o reanuda cuando lo necesites.','El administrador cierra el conteo y registra ajustes.']],
  ['Ubicaciones y marbetes','⌖',['Bodega','Rack','Marbete'],'Relaciona productos con cajas, racks, cajones, muebles o piso.',['En Ajustes abre Ubicaciones.','Crea el código y define el tipo.','Agrega una descripción opcional.','Asigna SKU/UPC a la ubicación.','En entradas puedes escanear el marbete directamente.']],
  ['Importar Excel / CSV','⇧',['Archivo','Columnas','Importar'],'Carga o actualiza catálogos en masa.',['Selecciona un Excel o CSV.','Revisa el mapeo de columnas.','Comprueba la vista previa.','Elige catálogo o catálogo + inventario físico.','Ejecuta y revisa el resumen.']],
  ['Historial y auditoría','☷',['Fecha','Empleado','Exportar'],'Rastrea qué ocurrió, cuándo y con qué empleado.',['Filtra por fecha y tipo.','Busca el número de empleado dentro de Nota.','Filtra SKU/UPC o ubicación.','Exporta a CSV o Excel.']],
  ['Departamentos','◇',['Crear','Activar','Cambiar'],'Separa catálogos y movimientos por departamento.',['Crea departamentos desde Ajustes.','Activa o desactiva departamentos.','Usa el selector superior para cambiar el departamento activo.']],
  ['Cerrar sesión','↗',['Salir','Borrar gafete','Nuevo operador'],'Salir elimina la identificación del vendedor de la sesión.',['Pulsa Salir.','Nova borra el número de empleado del navegador.','El siguiente vendedor deberá identificarse otra vez.']]
].map(([title,icon,labels,text,steps]) => ({title,icon,labels,text,steps}));

function tutorialVisual(item, index) {
  const n = String(index + 1).padStart(2,'0');
  return `<svg class="nova-tutorial-svg" viewBox="0 0 520 310" role="img" aria-label="Ejemplo visual: ${htmlEsc(item.title)}">
    <defs><linearGradient id="g${index}" x1="0" x2="1"><stop stop-color="#172d3d"/><stop offset="1" stop-color="#0f7184"/></linearGradient><filter id="s${index}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-opacity=".14"/></filter></defs>
    <rect width="520" height="310" rx="30" fill="#eef4f6"/><circle cx="460" cy="55" r="88" fill="#d8eef2" opacity=".7"/>
    <rect x="44" y="30" width="432" height="250" rx="24" fill="white" filter="url(#s${index})"/><rect x="44" y="30" width="432" height="58" rx="24" fill="url(#g${index})"/><rect x="44" y="64" width="432" height="24" fill="url(#g${index})"/>
    <text x="70" y="66" fill="white" font-size="20" font-family="system-ui" font-weight="800">NOVA</text><text x="443" y="66" fill="#aee7ef" font-size="12" text-anchor="end" font-family="system-ui" font-weight="700">${n}</text>
    <rect x="70" y="112" width="148" height="105" rx="18" fill="#e8f5f7"/><circle cx="144" cy="150" r="25" fill="#0f7184"/><text x="144" y="158" fill="white" font-size="20" text-anchor="middle" font-family="system-ui" font-weight="900">${htmlEsc(item.icon)}</text><text x="144" y="196" fill="#172d3d" font-size="13" text-anchor="middle" font-family="system-ui" font-weight="800">${htmlEsc(item.labels[0])}</text>
    <rect x="244" y="112" width="202" height="28" rx="10" fill="#f0f4f5"/><text x="260" y="131" fill="#526570" font-size="12" font-family="system-ui" font-weight="700">${htmlEsc(item.labels[1])}</text><rect x="244" y="151" width="202" height="28" rx="10" fill="#f0f4f5"/><text x="260" y="170" fill="#526570" font-size="12" font-family="system-ui" font-weight="700">${htmlEsc(item.labels[2])}</text>
    <rect x="244" y="194" width="128" height="34" rx="12" fill="#172d3d"/><text x="308" y="216" fill="white" font-size="12" text-anchor="middle" font-family="system-ui" font-weight="800">Continuar</text><rect x="70" y="240" width="376" height="10" rx="5" fill="#e6ecef"/><rect x="70" y="240" width="${150 + (index % 5) * 43}" height="10" rx="5" fill="#1ba1b5"/>
  </svg>`;
}

function tutorialHtml() {
  return `<div class="nova-tutorial-head"><div><div class="eyebrow">NOVA · CENTRO DE AYUDA</div><h2>Tutorial completo</h2><p class="muted">Guía visual de todas las funciones actuales de la aplicación.</p></div><div class="nova-tutorial-count"><b>${tutorials.length}</b><span>funciones</span></div></div>
  <div class="nova-tutorial-index">${tutorials.map((t,i)=>`<button type="button" data-tutorial-jump="${i}">${String(i+1).padStart(2,'0')} · ${htmlEsc(t.title)}</button>`).join('')}</div>
  <div class="nova-tutorial-list">${tutorials.map((t,i)=>`<article class="nova-tutorial-card" id="novaTutorial${i}"><div class="nova-tutorial-image">${tutorialVisual(t,i)}</div><div class="nova-tutorial-copy"><div class="nova-step-number">PASO ${String(i+1).padStart(2,'0')}</div><h3>${htmlEsc(t.title)}</h3><p>${htmlEsc(t.text)}</p><ol>${t.steps.map(s=>`<li>${htmlEsc(s)}</li>`).join('')}</ol></div></article>`).join('')}</div>`;
}

function showTutorial() {
  const box = $('adminBody');
  if (!box) return;
  document.querySelectorAll('.tabbtn').forEach(b => b.classList.remove('active'));
  $('novaTutorialTab')?.classList.add('active');
  box.classList.remove('tab-enter');
  void box.offsetWidth;
  box.classList.add('tab-enter','nova-tutorial-container');
  box.innerHTML = tutorialHtml();
  document.querySelectorAll('[data-tutorial-jump]').forEach(btn => {
    btn.onclick = () => $(`novaTutorial${btn.dataset.tutorialJump}`)?.scrollIntoView({behavior:'smooth',block:'start'});
  });
}

function injectTutorialTab() {
  const row = document.querySelector('.tabs-row');
  if (!row || $('novaTutorialTab')) return;
  const btn = document.createElement('button');
  btn.id = 'novaTutorialTab';
  btn.type = 'button';
  btn.className = 'tabbtn nova-tutorial-tab';
  btn.textContent = '▣ Tutorial Nova';
  btn.onclick = showTutorial;
  row.appendChild(btn);
}

function syncAuthenticatedUI() {
  if (document.title !== 'Nova · Control de Inventario') document.title = 'Nova · Control de Inventario';
  setText(document.querySelector('.topbar .eyebrow'), 'NOVA · CONTROL DE INVENTARIO');

  const emp = employeeNumber();
  const access = document.querySelector('.access-label');
  if (access && sellerActive() && emp && !access.querySelector('.nova-employee-chip')) {
    const chip = document.createElement('span');
    chip.className = 'nova-employee-chip';
    chip.textContent = `Emp. ${emp}`;
    access.appendChild(chip);
  }

  if (sellerActive()) {
    const tip = document.querySelector('.tip-card');
    if (tip && emp && tip.dataset.novaEmployee !== emp) {
      tip.dataset.novaEmployee = emp;
      tip.innerHTML = `<b>Sesión identificada</b><span>Gafete <strong>${htmlEsc(emp)}</strong>. Nova agregará tu número automáticamente a cada entrada y salida.</span>`;
    }
    const note = $('moveNote');
    if (note) {
      const label = note.previousElementSibling;
      setText(label?.tagName === 'LABEL' ? label : null, 'Nota adicional (opcional)');
      note.required = false;
      note.placeholder = 'Ej. mercancía de devolución';
      setText(document.querySelector('.note-help'), emp ? `Tu número de empleado (${emp}) se registrará automáticamente.` : 'Tu número de empleado se registrará automáticamente.');
    }
  }

  const hUser = $('hUser');
  if (hUser) {
    hUser.placeholder = 'Número de empleado o nota';
    const label = hUser.closest('label');
    if (label?.childNodes?.[0]?.nodeType === Node.TEXT_NODE && label.childNodes[0].textContent !== 'Empleado / nota') label.childNodes[0].textContent = 'Empleado / nota';
  }

  injectTutorialTab();
  ensureIdentityGate();
}

function applyEnhancements() {
  syncLogin();
  syncAuthenticatedUI();
}

function mutationIsRelevant(records) {
  return records.some(record => [...record.addedNodes].some(node => {
    if (!(node instanceof Element)) return false;
    if (node.id === 'app' || node.matches('.login-shell,.app-shell,.topbar,.tabs-row,#adminBody,#moveNote')) return true;
    return !!node.querySelector?.('.login-shell,.app-shell,.topbar,.tabs-row,#adminBody,#moveNote');
  }));
}

const observer = new MutationObserver(records => {
  if (!mutationIsRelevant(records)) return;
  requestAnimationFrame(applyEnhancements);
});
observer.observe(document.getElementById('app') || document.body, { childList:true, subtree:true });

document.addEventListener('DOMContentLoaded', applyEnhancements, { once:true });
applyEnhancements();
