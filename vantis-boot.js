/* Original VANTIS startup signature. No audio, video or external dependencies. */
const bootKey='vantis.boot.5.9.0';
const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function startVantisBoot(){
  if(reduced)return;
  try{if(sessionStorage.getItem(bootKey))return;}catch{}
  const shell=document.querySelector('.app-shell');
  if(!shell||document.documentElement.classList.contains('vantis-session-pending'))return;
  try{sessionStorage.setItem(bootKey,'1');}catch{}
  const overlay=document.createElement('div');
  overlay.className='vantis-boot';
  overlay.setAttribute('role','status');
  overlay.setAttribute('aria-label','Iniciando VANTIS');
  overlay.innerHTML='<div class="vantis-boot-center"><div class="vantis-boot-signal" aria-hidden="true"><i></i><i></i><i></i></div><div class="vantis-boot-name">VANTIS</div><div class="vantis-boot-caption">OPERACIÓN INTELIGENTE</div><div class="vantis-boot-line"></div></div><button type="button" class="vantis-boot-skip">Omitir</button>';
  document.body.appendChild(overlay);
  let closed=false;
  const close=()=>{
    if(closed)return;
    closed=true;
    clearTimeout(timeout);
    overlay.classList.add('vantis-boot-exit');
    overlay.addEventListener('transitionend',()=>overlay.remove(),{once:true});
    setTimeout(()=>overlay.remove(),500);
  };
  const timeout=setTimeout(close,1900);
  overlay.querySelector('.vantis-boot-skip').onclick=close;
}
let pending=false;
function bootCheck(){
  if(pending)return;
  pending=true;
  requestAnimationFrame(()=>{pending=false;startVantisBoot();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootCheck,{once:true});
else bootCheck();
new MutationObserver((_,observer)=>{
  try{if(sessionStorage.getItem(bootKey)){observer.disconnect();return;}}catch{}
  bootCheck();
}).observe(document.getElementById('app')||document.body,{childList:true,subtree:false});
