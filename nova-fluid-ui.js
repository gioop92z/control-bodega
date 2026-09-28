const NOVA_FLUID_VERSION='4.0.0';
const reducedMotion=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const VIEW_ORDER=['home','search','inventory','history','admin'];
let transitionBusy=false;
let decorateQueued=false;
let touchState=null;
let hintShown=false;

function visibleView(){
  const active=document.querySelector('.bottom-nav [data-view].active')?.dataset.view;
  if(active)return active;
  if(document.getElementById('manualMove'))return 'move';
  if(document.getElementById('manualSearch'))return 'search';
  if(document.getElementById('invList'))return 'inventory';
  if(document.getElementById('countArea'))return 'count';
  if(document.getElementById('importBody'))return 'import';
  if(document.getElementById('historyList'))return 'history';
  if(document.getElementById('adminBody'))return 'admin';
  return 'home';
}

function mainViews(){
  return VIEW_ORDER.filter(v=>document.querySelector(`.bottom-nav [data-view="${v}"]`));
}

function targetView(button){
  if(button.dataset.view)return button.dataset.view;
  if(button.dataset.go)return button.dataset.go;
  if(button.dataset.act)return 'move';
  return visibleView();
}

function directionFor(from,to){
  const order=[...VIEW_ORDER,'move','count','import'];
  const a=order.indexOf(from),b=order.indexOf(to);
  if(a<0||b<0)return 'same';
  if(b>a)return 'forward';
  if(b<a)return 'back';
  return 'same';
}

function navigationButtonFromEvent(event){
  const el=event.target instanceof Element?event.target.closest('.action-grid [data-act],.action-grid [data-go],.quick-row [data-go],.page-title #backHome'):null;
  if(!el||typeof el.onclick!=='function')return null;
  return el;
}

function cleanupTransition(){
  transitionBusy=false;
  delete document.documentElement.dataset.novaDirection;
  document.documentElement.classList.remove('nova-is-transitioning');
}

function perform(handler,from,to,button=null){
  if(typeof handler!=='function')return;
  document.documentElement.dataset.novaDirection=directionFor(from,to);
  document.documentElement.classList.add('nova-is-transitioning');
  transitionBusy=true;
  window.scrollTo({top:0,behavior:'auto'});
  if(!reducedMotion()&&typeof document.startViewTransition==='function'){
    try{
      const transition=document.startViewTransition(()=>handler.call(button||null));
      transition.finished.then(cleanupTransition,cleanupTransition);
      return;
    }catch{}
  }
  try{handler.call(button||null);}finally{setTimeout(cleanupTransition,80)}
}

document.addEventListener('click',event=>{
  if(transitionBusy)return;
  const button=navigationButtonFromEvent(event);
  if(!button)return;
  const handler=button.onclick;
  const from=visibleView();
  const to=button.id==='backHome'?'home':targetView(button);
  if(reducedMotion()||typeof document.startViewTransition!=='function')return;
  event.preventDefault();
  event.stopImmediatePropagation();
  perform(handler,from,to,button);
},true);

function navigateMain(step){
  if(transitionBusy)return;
  const views=mainViews();
  const current=visibleView();
  const index=views.indexOf(current);
  if(index<0)return;
  const next=views[index+step];
  if(!next)return;
  const button=document.querySelector(`.bottom-nav [data-view="${next}"]`);
  if(!button||typeof button.onclick!=='function')return;
  perform(button.onclick,current,next,button);
}

function isGestureBlocked(target){
  if(!(target instanceof Element))return true;
  return Boolean(target.closest('input,textarea,select,button,.table-scroll,.tabs-row,.nova-fluid-rail,.scanner-box,.modal,.nova-slide-container'));
}

function updateSwipeVisual(dx){
  const p=Math.max(-1,Math.min(1,dx/180));
  document.documentElement.style.setProperty('--nova-swipe',String(p));
  document.documentElement.classList.add('nova-swipe-live');
}

function resetSwipeVisual(){
  document.documentElement.style.removeProperty('--nova-swipe');
  document.documentElement.classList.remove('nova-swipe-live');
}

document.addEventListener('touchstart',event=>{
  if(event.touches.length!==1||transitionBusy||isGestureBlocked(event.target))return;
  const t=event.touches[0];
  touchState={x:t.clientX,y:t.clientY,time:performance.now(),moved:false};
},{passive:true});

document.addEventListener('touchmove',event=>{
  if(!touchState||event.touches.length!==1)return;
  const t=event.touches[0];
  const dx=t.clientX-touchState.x,dy=t.clientY-touchState.y;
  if(Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)*1.15){
    touchState.moved=true;
    updateSwipeVisual(dx);
  }
},{passive:true});

document.addEventListener('touchend',event=>{
  if(!touchState)return;
  const t=event.changedTouches?.[0];
  if(!t){touchState=null;resetSwipeVisual();return;}
  const dx=t.clientX-touchState.x,dy=t.clientY-touchState.y;
  const dt=Math.max(1,performance.now()-touchState.time);
  const velocity=Math.abs(dx)/dt;
  const qualifies=Math.abs(dx)>64&&Math.abs(dx)>Math.abs(dy)*1.25&&(Math.abs(dx)>95||velocity>.45);
  touchState=null;
  resetSwipeVisual();
  if(qualifies)navigateMain(dx<0?1:-1);
},{passive:true});

let wheelLock=0;
window.addEventListener('wheel',event=>{
  if(transitionBusy||Math.abs(event.deltaX)<55||Math.abs(event.deltaX)<Math.abs(event.deltaY)*1.2)return;
  const now=Date.now();
  if(now-wheelLock<700)return;
  wheelLock=now;
  navigateMain(event.deltaX>0?1:-1);
},{passive:true});

function nearestCard(grid,cards){
  const center=grid.scrollLeft+grid.clientWidth/2;
  let best=0,distance=Infinity;
  cards.forEach((card,i)=>{
    const c=card.offsetLeft+card.offsetWidth/2;
    const d=Math.abs(c-center);
    if(d<distance){distance=d;best=i;}
  });
  return best;
}

function decorateActionRail(){
  const grid=document.querySelector('.action-grid');
  if(!grid||grid.dataset.novaFluid==='1')return;
  const cards=[...grid.querySelectorAll('.action-card')];
  if(cards.length<2)return;
  grid.dataset.novaFluid='1';
  grid.classList.add('nova-fluid-rail');

  const label=document.createElement('div');
  label.className='nova-rail-label';
  label.innerHTML='<span>Acciones rápidas</span><span>Desliza las tarjetas →</span>';
  grid.before(label);

  const controls=document.createElement('div');
  controls.className='nova-rail-controls';
  controls.innerHTML=`<button type="button" class="nova-rail-prev" aria-label="Acción anterior">‹</button><div class="nova-rail-dots">${cards.map((_,i)=>`<button type="button" data-nova-dot="${i}" aria-label="Ir a acción ${i+1}"></button>`).join('')}</div><button type="button" class="nova-rail-next" aria-label="Siguiente acción">›</button>`;
  grid.after(controls);

  const prev=controls.querySelector('.nova-rail-prev');
  const next=controls.querySelector('.nova-rail-next');
  const dots=[...controls.querySelectorAll('[data-nova-dot]')];
  let index=0,raf=0;
  const sync=()=>{
    index=nearestCard(grid,cards);
    cards.forEach((c,i)=>c.classList.toggle('nova-active-card',i===index));
    dots.forEach((d,i)=>d.classList.toggle('active',i===index));
    prev.disabled=index===0;
    next.disabled=index===cards.length-1;
  };
  const go=i=>{
    const target=Math.max(0,Math.min(cards.length-1,i));
    grid.scrollTo({left:cards[target].offsetLeft-grid.offsetLeft,behavior:reducedMotion()?'auto':'smooth'});
  };
  prev.onclick=()=>go(index-1);
  next.onclick=()=>go(index+1);
  dots.forEach((d,i)=>d.onclick=()=>go(i));
  grid.addEventListener('scroll',()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(sync);},{passive:true});
  window.addEventListener('resize',sync,{passive:true});
  requestAnimationFrame(sync);
}

function centerActiveTab(){
  const active=document.querySelector('.tabs-row .tabbtn.active');
  if(!active)return;
  const row=active.closest('.tabs-row');
  if(!row||row.scrollWidth<=row.clientWidth)return;
  active.scrollIntoView({behavior:reducedMotion()?'auto':'smooth',block:'nearest',inline:'center'});
}

function ensureBackdrop(){
  if(document.getElementById('novaDepthBackdrop'))return;
  const el=document.createElement('div');
  el.id='novaDepthBackdrop';
  el.setAttribute('aria-hidden','true');
  el.innerHTML='<i></i><i></i><i></i>';
  document.body.prepend(el);
}

function showGestureHint(){
  if(hintShown||sessionStorage.getItem('nova.gestureHint'))return;
  const shell=document.querySelector('.app-shell');
  if(!shell)return;
  hintShown=true;
  const hint=document.createElement('div');
  hint.className='nova-gesture-hint';
  hint.innerHTML='<span>‹</span><b>Desliza para recorrer Nova</b><span>›</span>';
  document.body.appendChild(hint);
  setTimeout(()=>hint.classList.add('show'),250);
  setTimeout(()=>{
    hint.classList.remove('show');
    setTimeout(()=>hint.remove(),450);
    sessionStorage.setItem('nova.gestureHint','1');
  },3200);
}

function decorateDepth(){
  const candidates=document.querySelectorAll('.content > .hero,.content > .card,.content > .page-title,.content > .scan-btn,.content > .inline-form,.content > .quick-row,.content > .tip-card,.content > .tabs-row,.content > .action-grid,.content > .nova-rail-label,.content > .nova-rail-controls');
  candidates.forEach((el,i)=>{
    if(el.dataset.novaDepth==='1')return;
    el.dataset.novaDepth='1';
    el.style.setProperty('--nova-depth-index',String(i));
    depthObserver?.observe(el);
  });
}

const depthObserver=('IntersectionObserver'in window)?new IntersectionObserver(entries=>{
  entries.forEach(entry=>entry.target.classList.toggle('nova-depth-visible',entry.isIntersecting));
},{rootMargin:'-6% 0px -8% 0px',threshold:.08}):null;

let scrollRAF=0;
function syncParallax(){
  cancelAnimationFrame(scrollRAF);
  scrollRAF=requestAnimationFrame(()=>{
    const y=Math.min(900,window.scrollY||0);
    document.documentElement.style.setProperty('--nova-scroll',String(y));
  });
}
window.addEventListener('scroll',syncParallax,{passive:true});

function decorate(){
  decorateQueued=false;
  ensureBackdrop();
  decorateActionRail();
  centerActiveTab();
  decorateDepth();
  showGestureHint();
  syncParallax();
}

function scheduleDecorate(){
  if(decorateQueued)return;
  decorateQueued=true;
  requestAnimationFrame(decorate);
}

function start(){
  const app=document.getElementById('app');
  if(app)new MutationObserver(scheduleDecorate).observe(app,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  scheduleDecorate();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
else start();

console.info(`Nova Fluid UI ${NOVA_FLUID_VERSION} activa`);
