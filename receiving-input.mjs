// A keyboard scanner's complete frame is the unit of input. There is no
// barcode/time debounce: two separate Enter-terminated identical frames
// represent two physical pieces. CR/LF, repeated keys and idle timers cannot
// emit the same frame twice.
export function wireReceivingInput({input,active,onCode,onError,onActivity=()=>{}}) {
  let timer = null, lastAt = 0, rapid = false, size = 0, blockedFrame = false;
  let firstAt = 0, samples = 0;
  const editable = node => node?.closest?.('input,textarea,select,[contenteditable="true"]');
  const clear = () => {clearTimeout(timer);timer=null;lastAt=0;rapid=false;size=0;firstAt=0;samples=0;};
  const focus = () => {
    if (active() && !editable(document.activeElement)) input.focus({preventScroll:true});
  };
  function flush(forceSource=null) {
    const code = input.value.trim();
    const duration=firstAt?performance.now()-firstAt:0;
    // El lector HID se reconoce por su ráfaga; el pegado y el tecleo lento
    // se registran como captura manual desde el mismo campo.
    const source=forceSource||(samples>=4&&duration>(samples-1)*85?'manual':'scanner');
    clear();input.value = '';
    if (!code) return;
    if (!active()) {onError(Error('Lectura no aceptada. Revisa el estado de recepción antes de continuar.'));return;}
    onActivity();
    try {onCode(code,{source});} catch (error) {onError(error);}
    queueMicrotask(focus);
  }
  function changed(event={}) {
    if (event.isComposing) return;
    const value = input.value, now = performance.now();
    if (!value) {clear();return;}
    rapid = value.length >= 4 && size === 0 || (value.length > size && now-lastAt < 65);
    if(!firstAt)firstAt=now;
    samples++;
    lastAt = now; size = value.length; clearTimeout(timer);
    if (rapid && size >= 4) timer = setTimeout(flush,180);
  }
  function key(event) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.repeat) {if (event.target===input) event.preventDefault();return;}
    // A scanner's suffix must not activate a focused button if capture was paused.
    if(!active()&&!editable(event.target)){
      if(event.key.length===1){blockedFrame=true;event.preventDefault();return;}
      if(blockedFrame&&(event.key==='Enter'||event.key==='Tab')){
        blockedFrame=false;event.preventDefault();event.stopImmediatePropagation();
        onError(Error('Espera a que el lector esté listo y vuelve a escanear la pieza.'));return;
      }
    }
    if (event.key==='Enter' || event.key==='Tab' && !event.shiftKey && input.value) {
      if (event.target===input || !editable(event.target)) {
        if (input.value) {event.preventDefault();event.stopImmediatePropagation();flush();}
      }
      return;
    }
    if (!active() || event.key.length!==1 || editable(event.target)) return;
    event.preventDefault();input.focus({preventScroll:true});input.value+=event.key;changed();
  }
  function paste(event) {
    if (event.target !== input && editable(event.target)) return;
    const text = event.clipboardData?.getData('text/plain'); if (!text) return;
    event.preventDefault();clear();input.value='';
    if (/[\r\n]/.test(text.trim())) {onError(Error('Escanea un código por lectura.'));return;}
    input.value=text;flush('manual');
  }
  function blur() {queueMicrotask(focus);}
  input.addEventListener('input',changed);
  document.addEventListener('keydown',key,true);
  document.addEventListener('paste',paste,true);
  window.addEventListener('focus',focus);
  document.addEventListener('pointerup',blur);
  focus();
  return {flush,focus(){if(active())input.focus({preventScroll:true});},destroy(){
    clear();input.removeEventListener('input',changed);document.removeEventListener('keydown',key,true);
    document.removeEventListener('paste',paste,true);window.removeEventListener('focus',focus);document.removeEventListener('pointerup',blur);
  }};
}
