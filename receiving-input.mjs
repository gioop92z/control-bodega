// A keyboard scanner's complete frame is the unit of input. There is no
// barcode/time debounce: two separate Enter-terminated identical frames
// represent two physical pieces. CR/LF, repeated keys and idle timers cannot
// emit the same frame twice.
export function wireReceivingInput({input,active,onCode,onError,onActivity=()=>{}}) {
  let timer = null, lastAt = 0, rapid = false, size = 0;
  const editable = node => node?.closest?.('input,textarea,select,[contenteditable="true"]');
  const clear = () => {clearTimeout(timer);timer=null;lastAt=0;rapid=false;size=0;};
  const focus = () => {
    if (active() && !editable(document.activeElement)) input.focus({preventScroll:true});
  };
  function flush() {
    const code = input.value.trim(); clear(); input.value = '';
    if (!code) return;
    if (!active()) {onError(Error('Lectura no aceptada. Revisa el estado de recepción antes de continuar.'));return;}
    onActivity();
    try {onCode(code);} catch (error) {onError(error);}
    queueMicrotask(focus);
  }
  function changed(event={}) {
    if (event.isComposing) return;
    const value = input.value, now = performance.now();
    if (!value) {clear();return;}
    rapid = value.length >= 4 && size === 0 || (value.length > size && now-lastAt < 65);
    lastAt = now; size = value.length; clearTimeout(timer);
    if (rapid && size >= 4) timer = setTimeout(flush,180);
  }
  function key(event) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.repeat) {if (event.target===input) event.preventDefault();return;}
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
    if (/[\r\n]/.test(text.trim())) {onError(Error('Escanea una pieza por lectura. Para listas usa Recepción por lote.'));return;}
    input.value=text;flush();
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
