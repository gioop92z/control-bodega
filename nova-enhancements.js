import { startScanner, stopScanner } from './scanner.js';

const NOVA_VERSION = '3.4.0';
const EMPLOYEE_KEY = 'nova.employeeNumber';
const WELCOME_KEY = 'nova.welcomeDone';
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
  sessionStorage.removeItem(WELCOME_KEY);
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
      const mx = voices.find(v => /^es-MX$/i.test(v.lang)) || voices.find(v => /^es/i.test(v.lang));
      if (mx) u.voice = mx;
      let finished = false;
      const done = () => { if (finished) return; finished = true; resolve(); };
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
      setTimeout(done, 1600);
    } catch {
      resolve();
    }
  });
}

async function scanEmployee(input, { autoSubmit = false, onDone = null } = {}) {
  try {
    await startScanner(async raw => {
      stopScanner();
      const value = String(raw || '').trim();
      if (!value) return;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (onDone) return onDone(value);
      if (autoSubmit) {
        const form = input.closest('form');
        const submit = form?.querySelector('button[type="submit"]');
        submit?.click();
      }
    }, 'gafete o número de empleado');
  } catch {
    novaToast('No se pudo abrir la cámara. Revisa el permiso del navegador.', 'error');
  }
}

function novaToast(text, type='success') {
  let el = document.getElementById('novaToast');
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

function syncLogin() {
  const form = $('loginForm');
  if (!form || form.dataset.novaEnhanced === '1') return;
  form.dataset.novaEnhanced = '1';

  const clave = $('clave');
  const pin = $('pin');
  const pinLabel = pin?.previousElementSibling;
  const submit = form.querySelector('button[type="submit"]');
  if (!clave || !pin || !submit) return;

  const scanBtn = document.createElement('button');
  scanBtn.type = 'button';
  scanBtn.id = 'scanEmployeeLogin';
  scanBtn.className = 'nova-scan-employee';
  scanBtn.innerHTML = '<span class="nova-scan-icon">▣</span><span><b>Escanear gafete</b><small>Usa la cámara del teléfono</small></span>';
  pin.insertAdjacentElement('afterend', scanBtn);

  const accessHelp = document.createElement('div');
  accessHelp.className = 'nova-login-help';
  accessHelp.innerHTML = '<b>Acceso vendedor libre</b><span>Clave 10 + tu número de empleado. No necesita registro previo.</span>';
  scanBtn.insertAdjacentElement('afterend', accessHelp);

  function mode() {
    const isSeller = clave.value.trim() === SELLER_ACCESS;
    scanBtn.hidden = !isSeller;
    accessHelp.hidden = !isSeller;
    if (pinLabel) pinLabel.textContent = isSeller ? 'Gafete / número de empleado' : 'PIN de administrador';
    pin.type = isSeller ? 'text' : 'password';
    pin.inputMode = isSeller ? 'text' : 'numeric';
    pin.autocomplete = isSeller ? 'off' : 'current-password';
    pin.placeholder = isSeller ? 'Escanea o digita cualquier número' : 'Tu PIN privado';
    if (isSeller) pin.focus({ preventScroll: true });
  }

  clave.addEventListener('input', mode);
  clave.addEventListener('change', mode);
  scanBtn.addEventListener('click', () => scanEmployee(pin, { autoSubmit: true }));
  mode();

  const brand = document.querySelector('.brandmark span');
  if (brand) brand.textContent = 'N';
  const eyebrow = document.querySelector('.login-card .eyebrow');
  if (eyebrow) eyebrow.textContent = `NOVA · Control inteligente · v${NOVA_VERSION}`;
  const title = document.querySelector('.login-card h1');
  if (title) title.textContent = 'Nova';
  const intro = document.querySelector('.login-card > .muted');
  if (intro) intro.textContent = 'Inventario inteligente, trazable y listo para trabajar.';

  const accessCards = document.querySelectorAll('.login-accesses > div');
  if (accessCards[1]) {
    accessCards[1].innerHTML = '<b>Vendedor</b><span>Clave 10 + gafete o número de empleado</span>';
  }
}

// Intercepta únicamente el acceso 10. Cualquier gafete/número no vacío identifica al vendedor,
// mientras la autenticación real sigue usando la cuenta general ya existente.
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

  if (!saveEmployeeNumber(value)) return;
  sessionStorage.removeItem(WELCOME_KEY);

  const originalHandler = form.onsubmit;
  const submitter = event.submitter || form.querySelector('button[type="submit"]');

  if (submitter) {
    submitter.disabled = true;
    submitter.textContent = 'Identificando…';
  }

  await speakWelcome();
  sessionStorage.setItem(WELCOME_KEY, '1');

  if (typeof originalHandler !== 'function') return;

  const visibleEmployee = value;
  pin.value = SHARED_SELLER_PIN;
  try {
    await originalHandler.call(form, {
      preventDefault() {},
      submitter
    });
  } finally {
    if (document.contains(pin)) pin.value = visibleEmployee;
  }
}, true);

function ensureIdentityGate() {
  if (!sellerActive() || employeeNumber() || document.getElementById('novaIdentityGate')) return;

  const overlay = document.createElement('div');
  overlay.id = 'novaIdentityGate';
  overlay.className = 'nova-identity-gate';
  overlay.innerHTML = `
    <section class="nova-identity-card" role="dialog" aria-modal="true" aria-labelledby="novaIdentityTitle">
      <div class="nova-orbit-logo"><span>N</span></div>
      <div class="eyebrow">NOVA · IDENTIFICACIÓN</div>
      <h2 id="novaIdentityTitle">Identifica tu gafete</h2>
      <p>Esta sesión viene de una versión anterior. Antes de continuar necesitamos saber quién está operando.</p>
      <label>Número de empleado</label>
      <input id="novaGateEmployee" autocomplete="off" placeholder="Escanea o digita tu número">
      <div class="nova-gate-actions">
        <button id="novaGateScan" class="secondary" type="button">▣ Escanear gafete</button>
        <button id="novaGateContinue" class="primary" type="button">Continuar</button>
      </div>
      <small>No validamos una lista de empleados: cualquier número no vacío permite continuar y queda asociado a la sesión.</small>
    </section>`;
  document.body.appendChild(overlay);

  const input = $('novaGateEmployee');
  const complete = async value => {
    if (!saveEmployeeNumber(value)) return novaToast('Digita o escanea tu número de empleado.', 'error');
    await speakWelcome();
    sessionStorage.setItem(WELCOME_KEY, '1');
    overlay.remove();
    syncAuthenticatedUI();
  };

  $('novaGateContinue').onclick = () => complete(input.value);
  $('novaGateScan').onclick = () => scanEmployee(input, { onDone: complete });
}

function employeeTaggedNote(raw='') {
  const emp = employeeNumber();
  const note = String(raw || '').trim();
  if (!emp) return note;
  const tag = `Empleado ${emp}`;
  if (note.toLowerCase().includes(tag.toLowerCase())) return note;
  return note ? `${tag} · ${note}` : tag;
}

// Primera barrera: antes de que app.js procese el botón, inserta el empleado en Nota.
document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (target.closest('#logout')) clearEmployeeNumber();

  if (target.closest('#saveMove') && sellerActive()) {
    const input = $('moveNote');
    if (input) input.value = employeeTaggedNote(input.value);
  }
}, true);

function syncAuthenticatedUI() {
  document.title = 'Nova · Control de Inventario';

  const headerEyebrow = document.querySelector('.topbar .eyebrow');
  if (headerEyebrow) headerEyebrow.textContent = 'NOVA · CONTROL DE INVENTARIO';

  const access = document.querySelector('.access-label');
  const emp = employeeNumber();
  if (access && sellerActive() && emp && !access.querySelector('.nova-employee-chip')) {
    const chip = document.createElement('span');
    chip.className = 'nova-employee-chip';
    chip.textContent = `Emp. ${emp}`;
    access.appendChild(chip);
  }

  if (sellerActive()) {
    const tip = document.querySelector('.tip-card');
    if (tip && emp) {
      tip.innerHTML = `<b>Sesión identificada</b><span>Gafete <strong>${htmlEsc(emp)}</strong>. Nova agregará tu número automáticamente a cada entrada y salida.</span>`;
    }

    const note = $('moveNote');
    if (note) {
      const label = note.previousElementSibling;
      if (label?.tagName === 'LABEL') label.textContent = 'Nota adicional (opcional)';
      note.required = false;
      note.placeholder = 'Ej. mercancía de devolución';
      const help = document.querySelector('.note-help');
      if (help) help.textContent = `Tu número de empleado (${emp}) se registrará automáticamente.`;
    }
  }

  const historyInput = $('hUser');
  if (historyInput) {
    historyInput.placeholder = 'Número de empleado o nota';
    const label = historyInput.closest('label');
    if (label) label.childNodes[0].textContent = 'Empleado / nota';
  }

  injectTutorialTab();
  ensureIdentityGate();
}

const tutorials = [
  {
    title: 'Acceso del vendedor', icon: '10', labels: ['Clave 10', 'Escanear gafete', 'Bienvenido a Nova'],
    text: 'El acceso de vendedor no usa una lista previa. El gafete identifica quién opera durante esa sesión.',
    steps: ['Escribe 10 en Clave.', 'Escanea tu gafete o digita cualquier número de empleado.', 'Nova reproduce “Bienvenido a Nova” y abre la operación.', 'Ese número se adjunta automáticamente a cada entrada y salida.']
  },
  {
    title: 'Acceso administrador', icon: '99', labels: ['Clave 99', 'PIN privado', 'Ajustes'],
    text: 'El administrador mantiene su acceso privado y conserva las funciones sensibles.',
    steps: ['Escribe 99.', 'Digita tu PIN privado.', 'Desde Ajustes administra departamentos, ubicaciones y tutorial.', 'Desde Historial consulta y exporta movimientos.']
  },
  {
    title: 'Pantalla de Inicio', icon: '⌂', labels: ['Entradas', 'Salidas', 'Buscar'],
    text: 'Inicio concentra las tareas operativas más frecuentes para reducir pasos.',
    steps: ['Recibir mercancía agrega existencias.', 'Sacar de bodega descuenta existencias.', 'Buscar consulta SKU, UPC o ubicación.', 'Inventario físico inicia o continúa un conteo.']
  },
  {
    title: 'Recibir mercancía', icon: '+', labels: ['Escanear SKU/UPC', 'Cantidad', 'Ubicación'],
    text: 'Registra entradas y coloca la mercancía en una ubicación cuando corresponda.',
    steps: ['Escanea o digita el SKU/UPC.', 'Confirma el producto.', 'Selecciona o escanea la ubicación.', 'Indica cantidad y una nota opcional.', 'Guarda: Nova añade automáticamente el número de empleado.']
  },
  {
    title: 'Sacar de bodega', icon: '−', labels: ['Producto', 'Existencia', 'Salida'],
    text: 'Registra una salida con control de existencias disponibles.',
    steps: ['Escanea o digita el producto.', 'Nova muestra el stock actual.', 'Selecciona la ubicación de salida si aplica.', 'Indica la cantidad.', 'Guarda y el número de empleado queda dentro de la nota del movimiento.']
  },
  {
    title: 'Buscar producto o marbete', icon: '⌕', labels: ['UPC', 'SKU', 'Marbete'],
    text: 'La misma búsqueda acepta códigos de producto y códigos de ubicación.',
    steps: ['Pulsa Escanear código o escribe el valor.', 'Con SKU/UPC verás descripción, stock y ubicaciones.', 'Con marbete verás los productos asociados a esa ubicación.']
  },
  {
    title: 'Inventario', icon: '▦', labels: ['Descripción', 'Stock', 'Filtros'],
    text: 'Consulta el catálogo completo del departamento y filtra existencias.',
    steps: ['Busca por SKU, UPC, descripción, marca, talla o color.', 'Filtra Todos, Con stock, Agotados o Stock bajo.', 'El administrador puede editar descripción, UPC y stock mínimo.']
  },
  {
    title: 'Inventario físico', icon: '✓', labels: ['Nuevo conteo', 'Escanear', 'Diferencia'],
    text: 'Permite comparar lo contado físicamente contra el sistema.',
    steps: ['Crea o abre un conteo.', 'Escanea cada producto.', 'Suma piezas o reemplaza el total contado.', 'Puedes pausar y reanudar.', 'El administrador cierra el conteo para registrar los ajustes.']
  },
  {
    title: 'Ubicaciones y marbetes', icon: '⌖', labels: ['Bodega', 'Rack', 'Marbete'],
    text: 'Relaciona productos con cajas, racks, cajones, muebles o piso.',
    steps: ['En Ajustes abre Ubicaciones.', 'Crea el código del marbete y define su tipo.', 'Opcionalmente agrega una descripción.', 'Asigna SKU/UPC a la ubicación.', 'Durante entradas también puedes escanear directamente el marbete.']
  },
  {
    title: 'Importar Excel / CSV', icon: '⇧', labels: ['Archivo', 'Columnas', 'Importar'],
    text: 'Carga o actualiza catálogos de forma masiva desde el acceso administrador.',
    steps: ['Selecciona un Excel o CSV.', 'Revisa el mapeo de columnas.', 'Comprueba la vista previa.', 'Elige solo catálogo o catálogo + inventario físico.', 'Ejecuta la importación y revisa el resumen.']
  },
  {
    title: 'Historial y auditoría', icon: '☷', labels: ['Fecha', 'Empleado', 'Exportar'],
    text: 'El historial permite rastrear qué ocurrió, cuándo y con qué empleado.',
    steps: ['Filtra por fechas y tipo.', 'Busca el número de empleado dentro de Nota.', 'Filtra SKU/UPC o ubicación.', 'Exporta el resultado a CSV o Excel.']
  },
  {
    title: 'Departamentos', icon: '◇', labels: ['Crear', 'Activar', 'Cambiar'],
    text: 'Separa catálogos y movimientos por departamento.',
    steps: ['En Ajustes abre Departamentos.', 'Crea un nuevo departamento.', 'Activa o desactiva departamentos.', 'Usa el selector superior para cambiar el departamento activo.']
  },
  {
    title: 'Cerrar sesión', icon: '↗', labels: ['Salir', 'Borrar gafete', 'Nuevo operador'],
    text: 'Cerrar sesión elimina la identificación del vendedor del navegador.',
    steps: ['Pulsa Salir en la parte superior.', 'Nova elimina el número de empleado de esa sesión.', 'El siguiente vendedor deberá volver a escanear o digitar su gafete.']
  }
];

function tutorialVisual(item, index) {
  const safeTitle = htmlEsc(item.title);
  const a = htmlEsc(item.labels[0] || '');
  const b = htmlEsc(item.labels[1] || '');
  const c = htmlEsc(item.labels[2] || '');
  const number = String(index + 1).padStart(2, '0');
  return `<svg class="nova-tutorial-svg" viewBox="0 0 520 310" role="img" aria-label="Ejemplo visual: ${safeTitle}">
    <defs>
      <linearGradient id="g${index}" x1="0" x2="1"><stop stop-color="#172d3d"/><stop offset="1" stop-color="#0f7184"/></linearGradient>
      <filter id="s${index}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-opacity=".14"/></filter>
    </defs>
    <rect width="520" height="310" rx="30" fill="#eef4f6"/>
    <circle cx="460" cy="55" r="88" fill="#d8eef2" opacity=".7"/>
    <rect x="44" y="30" width="432" height="250" rx="24" fill="white" filter="url(#s${index})"/>
    <rect x="44" y="30" width="432" height="58" rx="24" fill="url(#g${index})"/>
    <rect x="44" y="64" width="432" height="24" fill="url(#g${index})"/>
    <text x="70" y="66" fill="white" font-size="20" font-family="system-ui" font-weight="800">NOVA</text>
    <text x="443" y="66" fill="#aee7ef" font-size="12" text-anchor="end" font-family="system-ui" font-weight="700">${number}</text>
    <rect x="70" y="112" width="148" height="105" rx="18" fill="#e8f5f7"/>
    <circle cx="144" cy="150" r="25" fill="#0f7184"/>
    <text x="144" y="158" fill="white" font-size="20" text-anchor="middle" font-family="system-ui" font-weight="900">${htmlEsc(item.icon)}</text>
    <text x="144" y="196" fill="#172d3d" font-size="13" text-anchor="middle" font-family="system-ui" font-weight="800">${a}</text>
    <rect x="244" y="112" width="202" height="28" rx="10" fill="#f0f4f5"/>
    <text x="260" y="131" fill="#526570" font-size="12" font-family="system-ui" font-weight="700">${b}</text>
    <rect x="244" y="151" width="202" height="28" rx="10" fill="#f0f4f5"/>
    <text x="260" y="170" fill="#526570" font-size="12" font-family="system-ui" font-weight="700">${c}</text>
    <rect x="244" y="194" width="128" height="34" rx="12" fill="#172d3d"/>
    <text x="308" y="216" fill="white" font-size="12" text-anchor="middle" font-family="system-ui" font-weight="800">Continuar</text>
    <rect x="70" y="240" width="376" height="10" rx="5" fill="#e6ecef"/>
    <rect x="70" y="240" width="${150 + (index % 5) * 43}" height="10" rx="5" fill="#1ba1b5"/>
  </svg>`;
}

function tutorialHtml() {
  return `<div class="nova-tutorial-head">
      <div><div class="eyebrow">NOVA · CENTRO DE AYUDA</div><h2>Tutorial completo</h2><p class="muted">Guía visual de todas las funciones actuales de la aplicación.</p></div>
      <div class="nova-tutorial-count"><b>${tutorials.length}</b><span>funciones</span></div>
    </div>
    <div class="nova-tutorial-index">${tutorials.map((t,i)=>`<button type="button" data-tutorial-jump="${i}">${String(i+1).padStart(2,'0')} · ${htmlEsc(t.title)}</button>`).join('')}</div>
    <div class="nova-tutorial-list">
      ${tutorials.map((t,i)=>`<article class="nova-tutorial-card" id="novaTutorial${i}">
        <div class="nova-tutorial-image">${tutorialVisual(t,i)}</div>
        <div class="nova-tutorial-copy">
          <div class="nova-step-number">PASO ${String(i+1).padStart(2,'0')}</div>
          <h3>${htmlEsc(t.title)}</h3>
          <p>${htmlEsc(t.text)}</p>
          <ol>${t.steps.map(s=>`<li>${htmlEsc(s)}</li>`).join('')}</ol>
        </div>
      </article>`).join('')}
    </div>`;
}

function showTutorial() {
  const box = $('adminBody');
  if (!box) return;
  document.querySelectorAll('.tabbtn').forEach(b => b.classList.remove('active'));
  $('novaTutorialTab')?.classList.add('active');
  box.classList.remove('tab-enter');
  void box.offsetWidth;
  box.classList.add('tab-enter', 'nova-tutorial-container');
  box.innerHTML = tutorialHtml();
  document.querySelectorAll('[data-tutorial-jump]').forEach(btn => {
    btn.onclick = () => document.getElementById(`novaTutorial${btn.dataset.tutorialJump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function injectTutorialTab() {
  const row = document.querySelector('.tabs-row');
  if (!row || $('novaTutorialTab')) return;
  const btn = document.createElement('button');
  btn.id = 'novaTutorialTab';
  btn.type = 'button';
  btn.className = 'tabbtn nova-tutorial-tab';
  btn.innerHTML = '▣ Tutorial Nova';
  btn.onclick = showTutorial;
  row.appendChild(btn);
}

function applyBranding() {
  document.title = 'Nova · Control de Inventario';
  syncLogin();
  syncAuthenticatedUI();
}

const observer = new MutationObserver(() => applyBranding());
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('DOMContentLoaded', applyBranding, { once: true });
applyBranding();
