const NOVA_ADMIN_ACCESS = '99';

function speakNovaAdminWelcome() {
  return new Promise(resolve => {
    try {
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return resolve();

      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance('Bienvenido a Nova');
      utterance.lang = 'es-MX';
      utterance.rate = 0.96;
      utterance.pitch = 1;
      utterance.volume = 1;

      const voices = speechSynthesis.getVoices?.() || [];
      utterance.voice = voices.find(v => /^es-MX$/i.test(v.lang)) || voices.find(v => /^es/i.test(v.lang)) || null;

      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        resolve();
      };

      utterance.onend = done;
      utterance.onerror = done;
      speechSynthesis.speak(utterance);
      setTimeout(done, 1600);
    } catch {
      resolve();
    }
  });
}

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'loginForm') return;

  const clave = document.getElementById('clave')?.value.trim() || '';
  const pin = document.getElementById('pin')?.value.trim() || '';
  if (clave !== NOVA_ADMIN_ACCESS || !pin) return;

  const handler = form.onsubmit;
  if (typeof handler !== 'function') return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const submitter = event.submitter || form.querySelector('button[type="submit"]');
  if (submitter) {
    submitter.disabled = true;
    submitter.textContent = 'Entrando…';
  }

  await speakNovaAdminWelcome();
  await handler.call(form, { preventDefault(){}, submitter });
}, true);
