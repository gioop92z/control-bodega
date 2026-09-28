const LIVERPOOL_BRAND_VERSION='1.1.0';
let lpQueued=false;

function lpLockup(extra=''){
  return `<div class="lp-lockup ${extra}" aria-label="Liverpool"><span class="lp-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="lp-word">Liverpool</span></div>`;
}

function decorateLogin(){
  const card=document.querySelector('.login-card');
  if(!card||card.querySelector('.lp-login-brand'))return;
  const brand=document.createElement('div');
  brand.className='lp-login-brand';
  brand.innerHTML=`${lpLockup()}<div class="lp-vantis"><b>VANTIS</b><span>Operación de inventario</span></div>`;
  card.prepend(brand);

  const eyebrow=card.querySelector('.eyebrow');
  if(eyebrow)eyebrow.textContent='OPERACIÓN DE INVENTARIO · LIVERPOOL';
  const intro=card.querySelector('h1 + .muted');
  if(intro)intro.textContent='Inventario, movimientos y conteos con trazabilidad para la operación de tienda.';
}

function decorateHeader(){
  const top=document.querySelector('.topbar');
  const first=top?.firstElementChild;
  if(!top||!first||first.querySelector('.lp-top-lockup'))return;
  const row=document.createElement('div');
  row.className='lp-top-lockup';
  row.innerHTML=`${lpLockup()}<span class="lp-divider" aria-hidden="true"></span><span class="lp-product">VANTIS<br>Inventory Operations</span>`;
  first.prepend(row);
  const eyebrow=first.querySelector('.eyebrow');
  if(eyebrow)eyebrow.textContent='OPERACIÓN DE INVENTARIO';
}

function familyItem(label,mark,main=false){
  return `<div class="lp-family-item ${main?'lp-main':''}"><i aria-hidden="true">${mark}</i><span>${label}</span></div>`;
}

function ensureFamilyStrip(){
  const content=document.querySelector('.app-shell .content');
  if(!content)return;
  let strip=content.querySelector('.lp-family-strip');
  if(strip)return;

  strip=document.createElement('section');
  strip.className='lp-family-strip';
  strip.setAttribute('aria-label','Ecosistema El Puerto de Liverpool');
  strip.innerHTML=`
    <div class="lp-family-head"><span>Ecosistema comercial</span><strong>El Puerto de Liverpool</strong></div>
    <div class="lp-family-rail">
      ${familyItem('Liverpool','L',true)}
      ${familyItem('Suburbia','S')}
      ${familyItem('Boutiques','B')}
      ${familyItem('G·L·A·M','G')}
      ${familyItem('Galerías','G')}
      ${familyItem('Negocios Financieros','NF')}
    </div>`;

  const hero=content.querySelector('.hero');
  const pageTitle=content.querySelector('.page-title');
  const anchor=hero||pageTitle||content.firstElementChild;
  if(anchor)anchor.before(strip); else content.prepend(strip);
}

function addLiverpoolSignature(){
  const content=document.querySelector('.app-shell .content');
  if(!content||content.querySelector('.lp-operation-signature'))return;
  const sig=document.createElement('div');
  sig.className='lp-operation-signature';
  sig.setAttribute('aria-hidden','true');
  sig.style.cssText='display:none';
  sig.textContent='Interfaz adaptada al flujo operativo Liverpool';
  content.appendChild(sig);
}

function decorate(){
  lpQueued=false;
  decorateLogin();
  decorateHeader();
  ensureFamilyStrip();
  addLiverpoolSignature();
}

function schedule(){
  if(lpQueued)return;
  lpQueued=true;
  requestAnimationFrame(decorate);
}

function start(){
  const app=document.getElementById('app');
  if(app)new MutationObserver(schedule).observe(app,{childList:true,subtree:true});
  schedule();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
else start();

console.info(`VANTIS Liverpool visual ${LIVERPOOL_BRAND_VERSION} activo`);
