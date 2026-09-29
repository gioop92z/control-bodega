const VANTIS_MOTION_VERSION='1.2.0';
let vmQueued=false;
let vmPointerFrame=0;

const vmReduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const vmFinePointer=()=>window.matchMedia?.('(hover:hover) and (pointer:fine)').matches;

function vmDecorateCards(root=document){
  root.querySelectorAll('.action-card,.vantis-metric').forEach(card=>{
    if(card.dataset.vmMotion==='1')return;
    card.dataset.vmMotion='1';

    if(vmFinePointer()&&!vmReduced()){
      card.addEventListener('pointermove',e=>{
        const r=card.getBoundingClientRect();
        const px=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
        const py=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));
        const ry=(px-.5)*5.2;
        const rx=(.5-py)*4.2;
        card.style.setProperty('--rx',`${rx.toFixed(2)}deg`);
        card.style.setProperty('--ry',`${ry.toFixed(2)}deg`);
        card.style.setProperty('--card-x',`${(px*100).toFixed(1)}%`);
        card.style.setProperty('--card-y',`${(py*100).toFixed(1)}%`);
        card.classList.add('vm-tilt','vm-lit');
      });
      card.addEventListener('pointerleave',()=>{
        card.classList.remove('vm-tilt','vm-lit');
        card.style.removeProperty('--rx');card.style.removeProperty('--ry');
      });
    }

    card.addEventListener('touchstart',()=>{
      if(vmReduced())return;
      card.classList.add('vm-tilt');
    },{passive:true});
    card.addEventListener('touchend',()=>card.classList.remove('vm-tilt'),{passive:true});
    card.addEventListener('touchcancel',()=>card.classList.remove('vm-tilt'),{passive:true});
  });
}

function vmRipple(e){
  if(vmReduced()||!(e.target instanceof Element))return;
  const el=e.target.closest('.primary,.secondary,.scan-btn,.file-btn,.danger,.ghost,.mini,.tabbtn');
  if(!el)return;
  const r=el.getBoundingClientRect();
  const ripple=document.createElement('span');
  ripple.className='vm-ripple';
  ripple.style.left=`${e.clientX-r.left}px`;
  ripple.style.top=`${e.clientY-r.top}px`;
  el.appendChild(ripple);
  ripple.addEventListener('animationend',()=>ripple.remove(),{once:true});
}

document.addEventListener('pointerdown',vmRipple,{passive:true});

function vmAnimateMetrics(root=document){
  root.querySelectorAll('.vantis-metric').forEach(metric=>{
    const strong=metric.querySelector('strong');
    if(!strong)return;
    const current=strong.textContent||'';
    if(metric.dataset.vmValue===current)return;
    metric.dataset.vmValue=current;
    metric.classList.remove('vm-pop');
    void metric.offsetWidth;
    metric.classList.add('vm-pop');
  });
}

function vmAmbientPointer(e){
  if(vmReduced()||!vmFinePointer())return;
  if(vmPointerFrame)return;
  vmPointerFrame=requestAnimationFrame(()=>{
    vmPointerFrame=0;
    document.documentElement.style.setProperty('--vm-x',`${(e.clientX/window.innerWidth*100).toFixed(1)}%`);
    document.documentElement.style.setProperty('--vm-y',`${(e.clientY/window.innerHeight*100).toFixed(1)}%`);
  });
}
window.addEventListener('pointermove',vmAmbientPointer,{passive:true});

function vmDecorate(){
  vmQueued=false;
  vmDecorateCards(document);
  vmAnimateMetrics(document);
}
function vmSchedule(){
  if(vmQueued)return;
  vmQueued=true;
  requestAnimationFrame(vmDecorate);
}
function vmStart(){
  const app=document.getElementById('app');
  if(app)new MutationObserver(vmSchedule).observe(app,{childList:true,subtree:true,characterData:true});
  vmSchedule();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',vmStart,{once:true});
else vmStart();

console.info(`VANTIS Motion ${VANTIS_MOTION_VERSION} activo`);
