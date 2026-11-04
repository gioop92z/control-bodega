// VANTIS 5.9 · arranque original, visual y no bloqueante.
(()=>{
  'use strict';
  const key='vantis.intro.seen.5.9';
  const reduced=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;
  let started=false,observer=null;
  function played(){
    try{return sessionStorage.getItem(key)==='1';}catch{return started;}
  }
  function mark(){
    try{sessionStorage.setItem(key,'1');}catch{}
  }
  function ready(){
    return !!document.querySelector('.app-shell') &&
      sessionStorage.getItem('vantis.session.ready')==='1' &&
      !document.documentElement.classList.contains('vantis-session-pending') &&
      !document.querySelector('.vantis-session-gate,.nova-identity-gate,#scanner');
  }
  function boot(){
    if(started||played()){observer?.disconnect();return;}
    if(!ready())return;
    started=true;observer?.disconnect();mark();
    if(reduced()||document.visibilityState==='hidden')return;
    const overlay=document.createElement('div');
    overlay.className='vc-intro';
    overlay.setAttribute('aria-hidden','true');
    overlay.innerHTML='<div class="vc-intro-center"><div class="vc-intro-logo"><b>V</b></div>'+
      '<div class="vc-intro-word">VANTIS</div><div class="vc-intro-sub">Operación inteligente · Liverpool</div>'+
      '<div class="vc-intro-line"><i></i></div></div>';
    document.body.appendChild(overlay);
    // No bloquea input, navegación, cámara ni procesos de recepción.
    const finish=()=>{overlay.classList.add('vc-out');setTimeout(()=>overlay.remove(),500);};
    setTimeout(finish,1450);
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',watch,{once:true});
  }else watch();
  function watch(){
    if(played())return;
    observer=new MutationObserver(boot);
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
    observer.observe(document.body,{childList:true,subtree:true});
    boot();
  }
})();
