import {parseSupportText} from './support-batch.mjs?v=3.8.0';

// USB/Bluetooth HID readers act as keyboards. Accept Enter, Tab and rapid
// reads without a suffix; keep normal editing controls available to people.
export function wireExitInput({input, active, onCode, onList, onError}) {
  let timer = null, previous = '', lastAt = 0, rapid = false;
  const editable = node => node instanceof Element && !!node.closest('input,textarea,select,[contenteditable="true"]');
  function reset() { clearTimeout(timer); timer = null; previous = ''; lastAt = 0; rapid = false; }
  function flush() {
    const code = input.value.trim(); reset();
    if (!code || !active()) return;
    input.value = '';
    try { onCode(code); } catch (error) { onError(error); }
  }
  function changed(event) {
    if (event.isComposing || !active()) return;
    const value = input.value, now = performance.now();
    if (!value) { reset(); return; }
    if (!previous) { rapid = value.length >= 4; }
    else if (value.length > previous.length && now - lastAt < 55) rapid = true;
    else if (now - lastAt > 100) rapid = false;
    previous = value; lastAt = now; clearTimeout(timer);
    if (rapid && value.length >= 4) timer = setTimeout(flush, 150);
  }
  function key(event) {
    if (!active() || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey && rapid && input.value.trim())) {
      if (input.value.trim()) { event.preventDefault(); flush(); }
    }
  }
  function redirect(event) {
    if (!active() || event.ctrlKey || event.metaKey || event.altKey || editable(event.target) || event.key.length !== 1 || /\s/.test(event.key)) return;
    event.preventDefault(); input.focus({preventScroll:true}); input.value += event.key;
    changed({isComposing:false});
  }
  function paste(event) {
    if (!active() || (editable(event.target) && event.target !== input)) return;
    const text = event.clipboardData?.getData('text/plain'); if (!text) return;
    event.preventDefault(); reset(); input.value = '';
    try {
      if (/[\r\n\t,;]/.test(text)) {
        const parsed = parseSupportText(text);
        if (parsed.errors.length) throw Error(parsed.errors[0]);
        onList(parsed.entries, parsed.fingerprint);
      } else onCode(text.trim());
    } catch (error) { onError(error); }
    input.focus({preventScroll:true});
  }
  input.addEventListener('input', changed);
  input.addEventListener('keydown', key);
  document.addEventListener('keydown', redirect, true);
  document.addEventListener('paste', paste, true);
  input.focus({preventScroll:true});
  return {flush, focus(){if (active()) input.focus({preventScroll:true});}, destroy(){reset(); input.removeEventListener('input',changed); input.removeEventListener('keydown',key); document.removeEventListener('keydown',redirect,true); document.removeEventListener('paste',paste,true);}};
}
