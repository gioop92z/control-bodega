const VANTIS_VERSION='1.0.0';
const BRAND='VANTIS';
const PROJECT_REF='dkqovohxkxlcccvagpij';
const API=`https://${PROJECT_REF}.supabase.co/rest/v1`;
const KEY='sb_publishable_iz06RtaObND0dWOpuX2vKg_wZVbrZCv';
const MAIN_ORDER=['home','search','inventory','history','admin'];
let transitionBusy=false;
let touchState=null;
let decorateQueued=false;
let lastMetricDept='';

const reducedMotion=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function replaceBrandText(root=document.body){
  if(!root)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const nodes=[];
  while(walker.nextNode())nodes.push(walker.currentNode);
  for(const node of nodes){
    const parent=node.parentElement;
    if(!parent||parent.closest('script,style'))continue;
    const next=node.nodeValue
      .replace(/\bNOVA\b/g,BRAND)
      .replace(/\bNova\b/g,BRAND)
      .replace(/\bnova\b/g,'Vantis');
    if(next!==node.nodeValue)node.nodeValue=next;
  }
}

function patchTutorialVoice(){
  try{
    const synth=window.speechSynthesis;
    if(!synth||synth.__vantisPatched)return;
    const previous=synth.speak.bind(synth);
    synth.speak=(utterance)=>{
      try{
        if(utterance&&typeof utterance.text==='string'){
          utterance.text=utterance.text.replace(/\bNova\b/gi,BRAND);
        }
      }catch{}
      return previous(utterance);
    };
    synth.__vantisPatched=true;
  }catch{}
}

function tuneLogin(){
  const card=document.querySelector('.login-card');
  if(!card)return;
  const mark=card.querySelector('.brandmark span');
  if(mark)mark.textContent='V';
  const eyebrow=card.querySelector('.eyebrow');
  if(eyebrow)eyebrow.textContent=`${BRAND} · INVENTORY OPERATIONS`;
  const h1=card.querySelector('h1');
  if(h1)h1.textContent='Acceso operativo';
  const intro=card.querySelector('h1 + .muted');
  if(intro)intro.textContent='Inventario, movimientos y conteos con trazabilidad en tiempo real.';
  const tiny=card.querySelector('.tiny.center');
  if(tiny)tiny.textContent='Acceso seguro · Operación separada por departamento';
}

function tuneHeader(){
  const top=document.querySelector('.topbar');
  if(!top)return;
  const eyebrow=top.querySelector('.eyebrow');
  if(eyebrow)eyebrow.textContent=`${BRAND} · OPERACIÓN DE INVENTARIO`;
}

function tuneHome(){
  const hero=document.querySelector('.content > .hero');
  if(!hero)return;
  const title=hero.querySelector('h1');
  const copy=hero.querySelector('p.muted');
  if(title)title.textContent='Centro de operaciones';
  if(copy)copy.textContent='Inventario, movimientos y conteos en una sola vista.';
  const today=[...document.querySelectorAll('.section-head h3')].find(x=>x.textContent.trim()==='Hoy');
  if(today)today.textContent='Actividad operativa';
  ensureMetrics(hero);
}

function currentDeptId(){
  return document.getElementById('deptSelect')?.value||localStorage.getItem('inv.dept')||'';
}

function authHeaders(extra={}){
  let token='';
  try{
    const direct=localStorage.getItem(`sb-${PROJECT_REF}-auth-token`);
    if(direct){
      const parsed=JSON.parse(direct);
      token=parsed?.access_token||parsed?.currentSession?.access_token||'';
    }
    if(!token){
      const key=Object.keys(localStorage).find(k=>k.includes(PROJECT_REF)&&k.includes('auth-token'));
      if(key){const parsed=JSON.parse(localStorage.getItem(key)||'{}');token=parsed?.access_token||parsed?.currentSession?.access_token||'';}
    }
  }catch{}
  return {apikey:KEY,...(token?{Authorization:`Bearer ${token}`}:{Authorization:`Bearer ${KEY}`}),...extra};
}

async function fetchJson(path,options={}){
  const r=await fetch(`${API}/${path}`,{...options,headers:{...authHeaders(),...(options.headers||{})}});
  if(!r.ok)throw new Error(`REST ${r.status}`);
  return r.json();
}

async function fetchCount(path){
  const r=await fetch(`${API}/${path}`,{headers:authHeaders({Prefer:'count=exact',Range:'0-0'})});
  if(!r.ok)throw new Error(`COUNT ${r.status}`);
  const range=r.headers.get('content-range')||'';
  const total=Number(range.split('/')[1]);
  return Number.isFinite(total)?total:0;
}

function metricHtml(label,value='—',sub='',tone=''){
  return `<div class="vantis-metric" ${tone?`data-tone="${tone}"`:''}><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`;
}

function ensureMetrics(hero){
  let box=document.getElementById('vantisOverview');
  if(!box){
    box=document.createElement('section');
    box.id='vantisOverview';
    box.className='vantis-overview vantis-overview-loading';
    box.innerHTML=metricHtml('Productos','…','Catálogo activo')+metricHtml('Stock bajo','…','Requiere atención')+metricHtml('Movimientos hoy','…','Entradas y salidas')+metricHtml('Último conteo','…','Sincronizando');
    hero.after(box);
  }
  const dept=currentDeptId();
  if(!dept||dept===lastMetricDept)return;
  lastMetricDept=dept;
  loadMetrics(box,dept).catch(()=>{
    if(!document.body.contains(box))return;
    box.classList.remove('vantis-overview-loading');
    box.innerHTML=metricHtml('Productos','—','Catálogo activo')+metricHtml('Stock bajo','—','No disponible')+metricHtml('Movimientos hoy','—','No disponible')+metricHtml('Último conteo','—','No disponible');
  });
}

async function loadMetrics(box,dept){
  const encoded=encodeURIComponent(dept);
  const now=new Date();
  const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()).toISOString();
  const [productTotal,products,todayMoves,lastCounts]=await Promise.all([
    fetchCount(`productos?select=id&departamento_id=eq.${encoded}&activo=eq.true`),
    fetchJson(`productos?select=stock,stock_minimo&departamento_id=eq.${encoded}&activo=eq.true&limit=1000`),
    fetchCount(`movimientos?select=id&departamento_id=eq.${encoded}&created_at=gte.${encodeURIComponent(start)}`),
    fetchJson(`conteos?select=nombre,estado,created_at&departamento_id=eq.${encoded}&order=created_at.desc&limit=1`)
  ]);
  if(!document.body.contains(box)||dept!==currentDeptId())return;
  const low=(products||[]).filter(p=>Number(p.stock)>0&&Number(p.stock)<=Number(p.stock_minimo||0)).length;
  const last=lastCounts?.[0];
  const lastValue=last?String(last.estado||'—'):'—';
  const lastSub=last?`${last.nombre||'Conteo'} · ${new Date(last.created_at).toLocaleDateString('es-MX')}`:'Sin conteos registrados';
  box.classList.remove('vantis-overview-loading');
  box.innerHTML=
    metricHtml('Productos',Number(productTotal).toLocaleString('es-MX'),'Catálogo activo')+
    metricHtml('Stock bajo',Number(low).toLocaleString('es-MX'),'Requiere atención',low?'attention':'good')+
    metricHtml('Movimientos hoy',Number(todayMoves).toLocaleString('es-MX'),'Entradas, salidas y ajustes')+
    metricHtml('Último conteo',lastValue,lastSub,lastValue==='CERRADO'?'good':'');
}

function visibleView(){
  return document.querySelector('.bottom-nav [data-view].active')?.dataset.view||
    (document.getElementById('manualMove')?'move':null)||
    (document.getElementById('countArea')?'count':null)||
    (document.getElementById('importBody')?'import':null)||'home';
}

function mainViews(){return MAIN_ORDER.filter(v=>document.querySelector(`.bottom-nav [data-view="${v}"]`));}
function directionFor(from,to){
  const order=[...MAIN_ORDER,'move','count','import'];
  const a=order.indexOf(from),b=order.indexOf(to);
  return a<0||b<0||a===b?'same':b>a?'forward':'back';
}
function cleanupTransition(){transitionBusy=false;delete document.documentElement.dataset.vantisDirection;}
function perform(handler,from,to,button){
  if(typeof handler!=='function')return;
  transitionBusy=true;
  document.documentElement.dataset.vantisDirection=directionFor(from,to);
  window.scrollTo({top:0,behavior:'auto'});
  if(!reducedMotion()&&typeof document.startViewTransition==='function'){
    try{
      const t=document.startViewTransition(()=>handler.call(button||null));
      t.finished.then(cleanupTransition,cleanupTransition);
      return;
    }catch{}
  }
  try{handler.call(button||null);}finally{setTimeout(cleanupTransition,210)}
}

function navigationElement(event){
  if(!(event.target instanceof Element))return null;
  return event.target.closest('.action-grid [data-act],.action-grid [data-go],.quick-row [data-go],#backHome');
}
document.addEventListener('click',event=>{
  if(transitionBusy||reducedMotion()||typeof document.startViewTransition!=='function')return;
  const el=navigationElement(event);
  if(!el||typeof el.onclick!=='function')return;
  const from=visibleView();
  const to=el.id==='backHome'?'home':(el.dataset.go||el.dataset.view||(el.dataset.act?'move':from));
  event.preventDefault();event.stopImmediatePropagation();perform(el.onclick,from,to,el);
},true);

function navigateMain(step){
  if(transitionBusy)return;
  const views=mainViews();
  const current=visibleView();
  const i=views.indexOf(current);
  const next=i>=0?views[i+step]:null;
  if(!next)return;
  const button=document.querySelector(`.bottom-nav [data-view="${next}"]`);
  if(button&&typeof button.onclick==='function')perform(button.onclick,current,next,button);
}
function gestureBlocked(target){return !(target instanceof Element)||Boolean(target.closest('button,input,textarea,select,label,.table-scroll,.tabs-row,.scanner-box,.modal,.nova-slide-container,.action-grid,.quick-row'))}
function swipeVisual(dx){
  const p=Math.max(-1,Math.min(1,dx/180));
  document.documentElement.style.setProperty('--vantis-swipe',String(p));
  document.documentElement.style.setProperty('--vantis-swipe-abs',String(Math.abs(p)));
  document.documentElement.classList.add('vantis-swipe-live');
}
function resetSwipe(){
  document.documentElement.style.removeProperty('--vantis-swipe');
  document.documentElement.style.removeProperty('--vantis-swipe-abs');
  document.documentElement.classList.remove('vantis-swipe-live');
}
document.addEventListener('touchstart',event=>{
  if(event.touches.length!==1||transitionBusy||gestureBlocked(event.target))return;
  const t=event.touches[0];touchState={x:t.clientX,y:t.clientY,time:performance.now()};
},{passive:true});
document.addEventListener('touchmove',event=>{
  if(!touchState||event.touches.length!==1)return;
  const t=event.touches[0],dx=t.clientX-touchState.x,dy=t.clientY-touchState.y;
  if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.2)swipeVisual(dx);
},{passive:true});
document.addEventListener('touchend',event=>{
  if(!touchState)return;
  const t=event.changedTouches?.[0];
  if(!t){touchState=null;resetSwipe();return;}
  const dx=t.clientX-touchState.x,dy=t.clientY-touchState.y,dt=Math.max(1,performance.now()-touchState.time),velocity=Math.abs(dx)/dt;
  touchState=null;resetSwipe();
  if(Math.abs(dx)>58&&Math.abs(dx)>Math.abs(dy)*1.25&&(Math.abs(dx)>86||velocity>.42))navigateMain(dx<0?1:-1);
},{passive:true});

function syncPosition(){
  const views=mainViews();
  if(!views.length)return;
  let indicator=document.getElementById('vantisPosition');
  if(!indicator){indicator=document.createElement('div');indicator.id='vantisPosition';indicator.className='vantis-position';document.body.appendChild(indicator);}
  const current=visibleView();
  indicator.innerHTML=views.map(v=>`<i class="${v===current?'active':''}"></i>`).join('');
  indicator.hidden=!document.querySelector('.app-shell')||!views.includes(current);
}

function decorate(){
  decorateQueued=false;
  document.title=`${BRAND} · Operación de Inventario`;
  replaceBrandText(document.body);
  tuneLogin();
  tuneHeader();
  tuneHome();
  syncPosition();
}
function scheduleDecorate(){if(decorateQueued)return;decorateQueued=true;requestAnimationFrame(decorate);}
function start(){
  patchTutorialVoice();
  const app=document.getElementById('app');
  if(app)new MutationObserver(scheduleDecorate).observe(app,{childList:true,subtree:true,characterData:true});
  window.addEventListener('storage',()=>{lastMetricDept='';scheduleDecorate()});
  scheduleDecorate();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
console.info(`${BRAND} Enterprise ${VANTIS_VERSION} activo`);
