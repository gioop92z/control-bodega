import {BrowserMultiFormatReader} from 'https://esm.sh/@zxing/browser@0.1.5';
import {BarcodeFormat,DecodeHintType} from 'https://esm.sh/@zxing/library@0.21.3';
import Quagga from 'https://esm.sh/@ericblade/quagga2@1.12.1';
let controls=null,active=false,last='',lastAt=0;
const formats=[BarcodeFormat.EAN_13,BarcodeFormat.EAN_8,BarcodeFormat.UPC_A,BarcodeFormat.UPC_E,BarcodeFormat.CODE_128,BarcodeFormat.CODE_39,BarcodeFormat.CODE_93,BarcodeFormat.ITF,BarcodeFormat.CODABAR,BarcodeFormat.RSS_14].filter(Boolean);
const hints=new Map([[DecodeHintType.POSSIBLE_FORMATS,formats],[DecodeHintType.TRY_HARDER,true],[DecodeHintType.ALSO_INVERTED,true]]);
export function stopScanner(){try{controls?.stop?.()}catch{}try{Quagga.offDetected?.()}catch{}controls=null;active=false;document.getElementById('scanner')?.remove()}
function accept(v,cb){v=String(v||'').trim();if(!v)return;const now=Date.now();if(v===last&&now-lastAt<1800)return;last=v;lastAt=now;stopScanner();cb(v)}
export async function startScanner(cb,label='código'){
 if(active)return;active=true;
 document.body.insertAdjacentHTML('beforeend',`<div class="scanner" id="scanner"><div class="scanner-head"><b>Escanear ${label}</b><button id="closeScan" class="btn-light">✕</button></div><div id="scannerViewport" style="position:relative;flex:1;overflow:hidden"><video id="scanVideo" muted playsinline></video><div class="guide"></div></div><div class="scanner-note">UPC · EAN · CODE-128 · CODE-39 · CODE-93 · ITF · CODABAR</div></div>`);
 document.getElementById('closeScan').onclick=stopScanner;
 try{
  const target=document.getElementById('scannerViewport');
  const readers=['code_128_reader','ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_39_reader','code_93_reader','codabar_reader','i2of5_reader','2of5_reader'];
  try{
   await new Promise((ok,bad)=>Quagga.init({inputStream:{type:'LiveStream',target,constraints:{facingMode:'environment',width:{ideal:1920},height:{ideal:1080}},area:{top:'8%',right:'3%',left:'3%',bottom:'8%'}},locator:{patchSize:'medium',halfSample:false},numOfWorkers:Math.min(4,navigator.hardwareConcurrency||2),frequency:18,decoder:{readers,multiple:false},locate:true},e=>e?bad(e):ok()));
   if(!active)return;
   Quagga.onDetected(d=>{const v=d?.codeResult?.code,es=(d?.codeResult?.decodedCodes||[]).filter(x=>typeof x.error==='number').map(x=>x.error),avg=es.length?es.reduce((a,b)=>a+b,0)/es.length:0;if(v&&avg<.5)accept(v,cb)});
   Quagga.start();controls={stop:()=>{try{Quagga.stop()}catch{}}};
   const t=Quagga.CameraAccess?.getActiveTrack?.();if(t){const c=t.getCapabilities?.()||{},a={};if(c.focusMode?.includes?.('continuous'))a.focusMode='continuous';if(c.zoom)a.zoom=Math.min(c.zoom.max||1.5,Math.max(c.zoom.min||1,1.4));if(Object.keys(a).length)t.applyConstraints({advanced:[a]}).catch(()=>{})}
  }catch{
   const reader=new BrowserMultiFormatReader(hints,{delayBetweenScanAttempts:70,delayBetweenScanSuccess:450});
   controls=await reader.decodeFromConstraints({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}},document.getElementById('scanVideo'),r=>{if(r)accept(r.getText(),cb)});
  }
 }catch(e){stopScanner();throw e}
}
