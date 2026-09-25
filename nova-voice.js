const NOVA_VOICE_VERSION='3.8.0';

const VOICE_PREFS=['Jorge','Juan','Diego','Carlos','Ángel','Angel','Andrés','Andres','Alvaro','Álvaro','Raúl','Raul'];
const PHRASES={
  'home-admin':'Bienvenido a Nova. Sistemas operativos y listos.',
  'home':'Bienvenido a Nova. Sesión de operación lista.',
  'entry':'Modo recepción activado. Escanea el producto y confirma cantidad y ubicación.',
  'exit':'Modo salida activado. Verifica existencias antes de confirmar.',
  'search':'Búsqueda activa. Escanea un SKU, UPC o marbete.',
  'inventory':'Inventario disponible. Puedes consultar existencias y filtros.',
  'count':'Inventario físico listo. Inicia o continúa un conteo.',
  'count-active':'Conteo en progreso. Continúa escaneando los productos.',
  'history':'Historial abierto. Puedes auditar movimientos y exportar resultados.',
  'admin':'Panel administrativo activo. Aquí puedes gestionar departamentos y ubicaciones.',
  'import':'Importación preparada. Carga el archivo y revisa las columnas antes de continuar.'
};

let unlocked=false;
let lastContext='';
let speakingContext='';
let queued=false;
let greeted=false;

function available(){
  return 'speechSynthesis' in window && typeof SpeechSynthesisUtterance!=='undefined';
}

function pickVoice(){
  const voices=speechSynthesis.getVoices?.()||[];
  const spanish=voices.filter(v=>/^es(?:-|$)/i.test(v.lang));
  const mx=spanish.filter(v=>/^es-MX$/i.test(v.lang));
  const pool=mx.length?mx:spanish;
  for(const pref of VOICE_PREFS){
    const found=pool.find(v=>v.name.toLowerCase().includes(pref.toLowerCase()));
    if(found)return found;
  }
  return pool[0]||voices[0]||null;
}

function speak(message,context='manual'){
  if(!available()||!unlocked||!message)return;
  if(speakingContext===context)return;
  try{
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(message);
    u.lang='es-MX';
    u.rate=0.91;
    u.pitch=0.82;
    u.volume=1;
    const voice=pickVoice();
    if(voice)u.voice=voice;
    speakingContext=context;
    const done=()=>{if(speakingContext===context)speakingContext=''};
    u.onend=done;
    u.onerror=done;
    speechSynthesis.speak(u);
  }catch{}
}

function panel(){return document.getElementById('novaAssistant')}

function announceCurrent(force=false){
  const p=panel();
  if(!p)return;
  const key=p.dataset.context||'';
  if(!key||key==='tutorial'||key==='generic')return;
  if(!force&&key===lastContext)return;
  lastContext=key;
  const phrase=PHRASES[key];
  if(!phrase)return;
  if(!greeted&&(key==='home'||key==='home-admin'))greeted=true;
  speak(phrase,key);
}

function unlockVoice(){
  if(unlocked)return;
  unlocked=true;
  try{
    const voices=speechSynthesis.getVoices?.()||[];
    if(!voices.length)speechSynthesis.getVoices?.();
  }catch{}
  setTimeout(()=>announceCurrent(true),80);
}

function schedule(){
  if(queued)return;
  queued=true;
  requestAnimationFrame(()=>{queued=false;announceCurrent();});
}

function start(){
  if(!available())return;
  document.addEventListener('pointerdown',unlockVoice,{passive:true,capture:true});
  document.addEventListener('keydown',unlockVoice,{passive:true,capture:true});
  const app=document.getElementById('app');
  if(app)new MutationObserver(schedule).observe(app,{childList:true,subtree:true,attributes:true,attributeFilter:['data-context']});
  speechSynthesis.onvoiceschanged=()=>{if(unlocked&&panel())schedule()};
  window.addEventListener('offline',()=>speak('Conexión perdida. Evita registrar cambios hasta recuperar la red.','offline'));
  window.addEventListener('online',()=>speak('Conexión restablecida. Nova vuelve a estar en línea.','online'));
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
else start();

console.info(`Nova Voice ${NOVA_VOICE_VERSION} activa`);
