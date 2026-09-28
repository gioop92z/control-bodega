const NOVA_FLUID_VERSION='3.9.0';
const reducedMotion=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let transitionBusy=false;
let decorateQueued=false;

const VIEW_ORDER={home:0,move:1,search:2,inventory:3,count:3,import:4,history:4,admin:5};

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

function targetView(button){
  if(button.dataset.view)return button.dataset.view;
  if(button.dataset.go)return button.dataset.go;
  if(button.dataset.act)return 'move';
  return visibleView();
}

function directionFor(from,to){
  const a=VIEW_ORDER[from]??0,b=VIEW_ORDER[to]??a;
  if(b>a)return 'forward';
  if(b<a)return 'back';
  return 'same';
}

function navigationButtonFromEvent(event){
  const el=event.target instanceof Element?event.target.closest('.bottom-nav [data-view],.action-grid [data-act],.action-grid [data-go],.quick-row [data-go]'):null;
  if(!el||typeof el.onclick!=='function')return null;
  return el;
}

function cleanupTransition(){
  transitionBusy=false;
  delete document.documentElement.dataset.novaDirection;
}

document.addEventListener('click',event=>{
  if(transitionBusy||reducedMotion()||typeof document.startViewTransition!=='function')return;
  if(event.defaultPrevented||event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const button=navigationButtonFromEvent(event);
  if(!button)return;

  const handler=button.onclick;
  const from=visibleView();
  const to=targetView(button);
  document.documentElement.dataset.novaDirection=directionFor(from,to);
  event.preventDefault();
  event.stopImmediatePropagation();
  transitionBusy=true;

  try{
    const transition=document.startViewTransition(()=>handler.call(button));
    transition.finished.then(cleanupTransition,cleanupTransition);
  }catch{
    cleanupTransition();
    handler.call(button);
  }
},true);

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
  label.innerHTML='<span>Acciones rápidas</span><span>Desliza para explorar →</span>';
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
  grid.addEventListener('scroll',()=>{
    cancelAnimationFrame(raf);
    raf=requestAnimationFrame(sync);
  },{passive:true});
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

function decorate(){
  decorateQueued=false;
  decorateActionRail();
  centerActiveTab();
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
