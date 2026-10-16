import {BrowserMultiFormatReader} from 'https://esm.sh/@zxing/browser@0.1.5';
import {BarcodeFormat,DecodeHintType} from 'https://esm.sh/@zxing/library@0.21.3';
import Quagga from 'https://esm.sh/@ericblade/quagga2@1.12.1';

let controls = null, active = false, last = '', session = 0, onClose = null, switchTimer = null;
const formats = [
  BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
  BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.ITF,
  BarcodeFormat.CODABAR, BarcodeFormat.RSS_14, BarcodeFormat.QR_CODE
].filter(format => format !== undefined && format !== null);
const hints = new Map([
  [DecodeHintType.POSSIBLE_FORMATS, formats],
  [DecodeHintType.TRY_HARDER, true],
  [DecodeHintType.ALSO_INVERTED, true]
]);

function haltReader() {
  clearTimeout(switchTimer); switchTimer = null;
  try { controls?.stop?.(); } catch {}
  try { Quagga.offDetected?.(); Quagga.offProcessed?.(); } catch {}
  controls = null;
}

export function stopScanner() {
  session++;
  const close = onClose;
  onClose = null;
  haltReader();
  active = false;
  last = '';
  document.getElementById('scanner')?.remove();
  close?.();
}

export async function startScanner(cb, label = 'código', options = {}) {
  if (active) return;
  active = true;
  last = '';
  onClose = options.onClose || null;
  const current = ++session;
  let candidate = '', hits = 0, accepted = 0, lastVisibleAt = Date.now(), switching = false;

  function stillActive() {
    return active && current === session && !!document.getElementById('scanner');
  }
  function status(message) {
    if (!stillActive()) return;
    const node = document.getElementById('scannerStatus');
    if (node) node.textContent = message;
  }
  function absent() {
    if (options.continuous && Date.now() - lastVisibleAt >= 850) {
      last = '';
      candidate = '';
      hits = 0;
    }
  }
  function accept(raw, repeat = false) {
    if (!stillActive()) return;
    const code = String(raw ?? '').trim();
    if (!code) return;
    lastVisibleAt = Date.now();
    if (!repeat && code === last) return;
    if (options.continuous && !repeat) {
      if (code !== candidate) {
        candidate = code;
        hits = 1;
        return;
      }
      if (++hits < 2) return;
    }
    last = code;
    if (!options.continuous) {
      stopScanner();
      try {
        Promise.resolve(cb(code)).catch(error => {
          console.warn('VANTIS scan handler:',error);
        });
      } catch(error) {
        console.warn('VANTIS scan handler:',error);
      }
      return;
    }
    accepted++;
    clearTimeout(switchTimer);switchTimer = null;
    const repeatButton = document.getElementById('scanRepeat');
    if (repeatButton) repeatButton.disabled = false;
    status('✓ ' + accepted + ' lectura(s) · ' + code);
    try {
      Promise.resolve(cb(code)).then(message => {
        if (message) status(message);
      }).catch(error => {
        status(error?.message || 'No se pudo agregar el código.');
      });
    } catch (error) {
      status(error?.message || 'No se pudo agregar el código.');
    }
  }

  (options.inlineTarget || document.body).insertAdjacentHTML('beforeend',
    '<div class="scanner ' + (options.inlineTarget?'scanner-inline':'') + (options.qrEnabled?' scanner-qr':'') + '" id="scanner">' +
      '<div class="scanner-head"><b>Escanear ' + label + '</b>' +
      '<button id="closeScan" class="btn-light" type="button" aria-label="Cerrar cámara">✕</button></div>' +
      '<div id="scannerViewport" style="position:relative;flex:1;overflow:hidden">' +
        '<video id="scanVideo" autoplay muted playsinline></video><div class="guide"></div></div>' +
      '<div class="scanner-note">' +
        '<div id="scannerStatus" role="status" aria-live="polite">Enfoca el QR o el código de barras completo.</div>' +
        (options.continuous ? '<button id="scanRepeat" type="button" class="btn-light" style="margin:10px 0" disabled>+1 del mismo código</button>' : '') +
        '<button id="scanSwitchEngine" type="button" class="btn-light" style="margin:8px">Otro lector</button>' +
      '</div></div>');
  document.getElementById('closeScan').onclick = stopScanner;
  document.getElementById('scanRepeat')?.addEventListener('click',() => accept(last,true));

  async function startZxing() {
    // ZXing handles printed Code 128, EAN and UPC on Safari/iPhone more
    // reliably than a Quagga-only camera, which often shows a picture
    // without ever issuing onDetected.
    const reader = new BrowserMultiFormatReader(hints,{
      delayBetweenScanAttempts: 75,delayBetweenScanSuccess: 200
    });
    const readerControls = await reader.decodeFromConstraints({
      audio:false,
      video:{
        facingMode:{ideal:'environment'},
        width:{ideal:1920},height:{ideal:1080},
        frameRate:{ideal:30,max:30}
      }
    },document.getElementById('scanVideo'),result => {
      if (!stillActive()) return;
      if (result) accept(result.getText());
      else absent();
    });
    if (!stillActive()) { readerControls.stop(); return; }
    controls = readerControls;
    status('Lector activo · centra el código de barras.');
  }

  async function startQuagga() {
    const target = document.getElementById('scannerViewport');
    const readers = [
      'code_128_reader','ean_reader','ean_8_reader','upc_reader',
      'upc_e_reader','code_39_reader','code_93_reader',
      'codabar_reader','i2of5_reader','2of5_reader'
    ];
    await new Promise((resolve,reject) => Quagga.init({
      inputStream:{
        type:'LiveStream',target,
        constraints:{facingMode:'environment',width:{ideal:1920},height:{ideal:1080}},
        area:{top:'5%',right:'2%',left:'2%',bottom:'5%'}
      },
      locator:{patchSize:'medium',halfSample:false},
      numOfWorkers:Math.min(3,navigator.hardwareConcurrency || 2),
      frequency:18,decoder:{readers,multiple:false},locate:true
    },error => error ? reject(error) : resolve()));
    if (!stillActive()) {try {Quagga.stop();} catch{} return;}
    Quagga.onDetected(value => {
      const code = value?.codeResult?.code;
      const errors = (value?.codeResult?.decodedCodes || [])
        .filter(x => typeof x.error === 'number').map(x => x.error);
      const avg = errors.length ? errors.reduce((a,b)=>a+b,0)/errors.length : 0;
      if (code && avg < .5) accept(code);
    });
    Quagga.onProcessed?.(value=>{if (!value?.codeResult?.code) absent();});
    Quagga.start();
    controls = {stop:() => {try {Quagga.stop();}catch{}}};
    status('Lector alternativo solo para barras · para QR toca «Otro lector».');
  }

  let engine = 'ZXing';
  async function switchEngine(next) {
    if (!stillActive() || switching) return;
    switching = true;
    haltReader();
    status('Ajustando lector de códigos…');
    try {
      engine = next;
      if (next === 'ZXing') await startZxing();
      else await startQuagga();
    } catch (error) {
      if (!stillActive()) return;
      // A decoder that cannot open the camera should not break the
      // session when the alternative still works.
      if (next === 'ZXing') {
        try {engine = 'Quagga';await startQuagga();}
        catch {stopScanner();throw error;}
      } else {
        try {engine = 'ZXing';await startZxing();}
        catch {stopScanner();throw error;}
      }
    } finally { switching = false; }
    if (stillActive() && engine === 'ZXing' && !accepted && !options.qrEnabled) {
      switchTimer = setTimeout(() => {
        if (stillActive() && !accepted) {
          void switchEngine('Quagga').catch(()=>{status('No se pudo cambiar de lector.');});
        }
      },9000);
    }
  }
  document.getElementById('scanSwitchEngine').onclick=()=>{
    void switchEngine(engine === 'ZXing' ? 'Quagga' : 'ZXing').catch(error=>status(error?.message || 'Error de cámara.'));
  };
  try {
    await switchEngine('ZXing');
  } catch(error) {
    stopScanner();
    throw error;
  }
}
