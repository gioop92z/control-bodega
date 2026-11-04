import { startScanner, stopScanner } from './scanner.js?v=3.8.0';

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
