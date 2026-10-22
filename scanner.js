import {BrowserMultiFormatReader} from 'https://esm.sh/@zxing/browser@0.1.5';
import {BarcodeFormat,DecodeHintType} from 'https://esm.sh/@zxing/library@0.21.3';
// The alternate reader is loaded only when ZXing fails or the user requests it.
let quagga=null,quaggaLoading=null;
async function getQuagga(){
  if(quagga)return quagga;
  quaggaLoading ||= import('https://esm.sh/@ericblade/quagga2@1.12.1')
    .then(module=>quagga=module.default||module)
    .catch(error=>{quaggaLoading=null;throw error;});
  return quaggaLoading;
}

let controls = null, active = false, last = '', session = 0, onClose = null, switchTimer = null;
let feedbackTimer = null, scanAudio = null;
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
  try { quagga?.offDetected?.(); quagga?.offProcessed?.(); } catch {}
  controls = null;
}

export function stopScanner() {
  session++;
  const close = onClose;
  onClose = null;
  haltReader();
  clearTimeout(feedbackTimer); feedbackTimer = null;
  try { scanAudio?.close?.(); } catch {} scanAudio = null;
  document.body?.classList?.remove('vantis-scanner-open');
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
  // Initialized directly from the user's camera tap; never opens a second microphone.
  try {
    if (typeof window !== 'undefined') {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (Audio) { scanAudio = new Audio(); void scanAudio.resume?.(); }
    }
  } catch { scanAudio = null; }

  function stillActive() {
    return active && current === session && !!document.getElementById('scanner');
  }
  function status(message) {
    if (!stillActive()) return;
    const node = document.getElementById('scannerStatus');
    if (node) node.textContent = message;
  }
  function flash(code) {
    const overlay = document.getElementById('scanner');
    if (!overlay) return;
    clearTimeout(feedbackTimer);
    overlay.classList?.remove('scanner-failed');
    overlay.classList?.add('scanner-detected');
    const receipt = document.getElementById('scannerReceipt');
    const value = document.getElementById('scannerReceiptCode');
    const counter = document.getElementById('scannerCount');
    if (value) value.textContent = code;
    if (counter) counter.textContent = (accepted + 1) + ' LECTURA' + (accepted ? 'S' : '');
    if (receipt) receipt.hidden = false;
    try { navigator.vibrate?.(22); } catch {}
    try {
      if (scanAudio?.state === 'running') {
        const tone=scanAudio.createOscillator(),gain=scanAudio.createGain();
        tone.type='sine'; tone.frequency.value=1050;
        gain.gain.value=.035; tone.connect(gain); gain.connect(scanAudio.destination);
        tone.start(); gain.gain.exponentialRampToValueAtTime(.001,scanAudio.currentTime+.09);
        tone.stop(scanAudio.currentTime+.1);
      }
    } catch {}
    feedbackTimer=setTimeout(()=>{
      if(!stillActive())return;
      overlay.classList?.remove('scanner-detected');
      if(receipt)receipt.hidden=true;
    },820);
  }
  function signalError(message) {
    status(message);
    const overlay=document.getElementById('scanner');
    overlay?.classList?.remove('scanner-detected');
    overlay?.classList?.add('scanner-failed');
    const receipt=document.getElementById('scannerReceipt');
    if(receipt)receipt.hidden=true;
    clearTimeout(feedbackTimer);
    feedbackTimer=setTimeout(()=>overlay?.classList?.remove('scanner-failed'),850);
  }
  function absent() {
    if (options.continuous && Date.now() - lastVisibleAt >= 850) {
      last = '';
      candidate = '';
      hits = 0;
    }
  }
  function snapshot() {
    // Copiar el fotograma ANTES de cerrar el lector: no se invoca getUserMedia
    // de nuevo, no se interrumpe el flujo y no se toman imágenes en segundo plano.
    try {
      const video=document.getElementById('scanVideo');
      if(!video?.videoWidth||!video.videoHeight||video.readyState<2)return Promise.resolve(null);
      if(!video)return Promise.resolve(null);
      const sourceWidth=video.videoWidth,sourceHeight=video.videoHeight;
      const cropWidth=sourceWidth*.84,cropHeight=sourceHeight*.84;
      const width=Math.min(480,Math.round(cropWidth));
      const canvas=document.createElement('canvas');
      canvas.width=width;canvas.height=Math.max(1,Math.round(width*cropHeight/cropWidth));
      canvas.getContext('2d',{alpha:false}).drawImage(video,
        (sourceWidth-cropWidth)/2,(sourceHeight-cropHeight)/2,cropWidth,cropHeight,
        0,0,canvas.width,canvas.height);
      return new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.48));
    }catch(error){console.warn('VANTIS: fotograma no disponible',error);return Promise.resolve(null);}
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
    flash(code);
    const frame = options.captureEvidence ? snapshot() : null;
    if (!options.continuous) {
      stopScanner();
      try {
        Promise.resolve(cb(code,frame)).catch(error => {
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
    status((options.acknowledgedOnly ? 'Lectura detectada · ' : '✓ ' + accepted + ' lectura(s) · ') + code);
    try {
      Promise.resolve(cb(code,frame)).then(message => {
        if (message) status(message);
      }).catch(error => {
        signalError(error?.message || 'No se pudo agregar el código.');
      });
    } catch (error) {
      signalError(error?.message || 'No se pudo agregar el código.');
    }
  }

  // Always mount at <body>, not inside a transformed/scrollable inventory modal.
  // iOS Safari otherwise clips position:fixed to a tiny camera preview.
  document.body.insertAdjacentHTML('beforeend',
    '<div class="scanner scanner-pro' + (options.qrEnabled?' scanner-qr':'') + '" id="scanner" role="dialog" aria-modal="true" aria-label="Lector VANTIS">' +
      '<div class="scanner-head"><div class="scanner-heading"><span class="scanner-label">VANTIS <i>·</i> LECTOR INTELIGENTE</span><b>Escanear ' + String(label).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])) + '</b></div>' +
      '<button id="closeScan" class="scanner-close" type="button" aria-label="Cerrar cámara">✕</button></div>' +
      '<div id="scannerViewport" class="scanner-viewport">' +
        '<video id="scanVideo" autoplay muted playsinline aria-label="Vista en vivo de la cámara"></video>' +
        '<div class="scanner-shade" aria-hidden="true"></div>' +
        '<div class="scanner-live"><span></span> CÁMARA ACTIVA</div>' +
        '<div class="scanner-target" aria-hidden="true"><span class="scanner-corner tl"></span><span class="scanner-corner tr"></span><span class="scanner-corner bl"></span><span class="scanner-corner br"></span><span class="scanner-laser"></span></div>' +
        '<div class="scanner-hint">Alinea el código dentro de la guía</div>' +
        '<div id="scannerReceipt" class="scanner-receipt" hidden><span class="scanner-tick">✓</span><span><b>CÓDIGO DETECTADO</b><strong id="scannerReceiptCode"></strong><small id="scannerCount">1 LECTURA</small></span></div>' +
      '</div>' +
      '<div class="scanner-note">' +
        '<div id="scannerStatus" role="status" aria-live="polite">Buscando QR o código de barras…</div>' +
        (options.captureEvidence?'<small class="scanner-evidence-note">El registro con cámara conserva un fotograma del código como evidencia interna.</small>':'') +
        '<div class="scanner-actions">' +
        (options.continuous && options.allowRepeat !== false ? '<button id="scanRepeat" type="button" class="scanner-action" disabled>+1 mismo SKU</button>' : '') +
        '<button id="scanSwitchEngine" type="button" class="scanner-action">Cambiar lector</button></div>' +
      '</div></div>');
  document.body.classList?.add('vantis-scanner-open');
  document.getElementById('closeScan').onclick = stopScanner;
  document.getElementById('scanRepeat')?.addEventListener('click',() => accept(last,true));

  async function startZxing() {
    // ZXing handles printed Code 128, EAN and UPC on Safari/iPhone more
    // reliably than a Quagga-only camera, which often shows a picture
    // without ever issuing onDetected.
    const reader = new BrowserMultiFormatReader(hints,{
      delayBetweenScanAttempts: 55,delayBetweenScanSuccess: 125
    });
    const readerControls = await reader.decodeFromConstraints({
      audio:false,
      video:{
        facingMode:{ideal:'environment'},
        width:{ideal:1280},height:{ideal:720},
        frameRate:{ideal:30,max:30}
      }
    },document.getElementById('scanVideo'),result => {
      if (!stillActive()) return;
      if (result) accept(result.getText());
      else absent();
    });
    if (!stillActive()) { readerControls.stop(); return; }
    controls = readerControls;
    status('Lector listo · QR y barras · lectura automática');
  }

  async function startQuagga() {
    const Quagga=await getQuagga();
    if(!stillActive())return;
    const target = document.getElementById('scannerViewport');
    const readers = [
      'code_128_reader','ean_reader','ean_8_reader','upc_reader',
      'upc_e_reader','code_39_reader','code_93_reader',
      'codabar_reader','i2of5_reader','2of5_reader'
    ];
    await new Promise((resolve,reject) => Quagga.init({
      inputStream:{
        type:'LiveStream',target,
        constraints:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}},
        area:{top:'5%',right:'2%',left:'2%',bottom:'5%'}
      },
      locator:{patchSize:'medium',halfSample:false},
      numOfWorkers:Math.min(2,navigator.hardwareConcurrency || 2),
      frequency:15,decoder:{readers,multiple:false},locate:true
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
    status('Lector alternativo · códigos de barras. Para QR usa «Cambiar lector».');
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
