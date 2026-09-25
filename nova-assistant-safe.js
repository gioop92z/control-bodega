const NOVA_ASSISTANT_VERSION='3.5.1';
const byId=id=>document.getElementById(id);
const text=sel=>document.querySelector(sel)?.textContent?.trim()||'';
const isAdmin=()=>/Administrador|acceso\s*99/i.test(text('.access-label'));
const employee=()=>text('.nova-employee-chip').replace(/^Emp\.\s*/i,'').trim();
let queued=false;

const HOME_PHRASES=[
  ['¿Qué vamos a hacer hoy?','Nova está lista para entradas, salidas, búsquedas y conteos.'],
  ['Sistema listo. ¿Por dónde empezamos?','Toda la operación está disponible desde este panel.'],
  ['Nova está en línea.','Elige una tarea y te acompañaré durante el proceso.']
];

function sessionHomePhrase(){
  let i=Number(sessionStorage.getItem('nova.homePhrase'));
  if(!Number.isInteger(i)||i<0||i>=HOME_PHRASES.length){
    i=Math.floor(Math.random()*HOME_PHRASES.length);
    sessionStorage.setItem('nova.homePhrase',String(i));
  }
  return HOME_PHRASES[i];
}

function context(){
  if(!document.querySelector('.app-shell')) return null;
  if(document.querySelector('.nova-tutorial-container')) return {key:'tutorial',title:'Aquí tienes la guía completa de Nova.',body:'Puedes consultar cualquier función antes de utilizarla en operación.',state:'MODO GUÍA'};
  if(byId('historyList')) return {key:'history',title:'Aquí está todo lo que ha ocurrido.',body:'Filtra por fecha, empleado, producto o ubicación para reconstruir cualquier movimiento.',state:'AUDITORÍA'};
  if(byId('importBody')) return {key:'import',title:'Prepararé el catálogo.',body:'Carga el archivo, revisa las columnas y valida la importación antes de aplicarla.',state:'IMPORTACIÓN'};
  if(byId('adminBody')) return {key:'admin',title:'¿Qué deseas configurar?',body:'Departamentos, ubicaciones y herramientas administrativas están disponibles aquí.',state:'ADMINISTRACIÓN'};
  if(byId('countArea')){
    return document.querySelector('.count-head')
      ? {key:'count-active',title:'Conteo en progreso.',body:'Escanea cada producto. Nova mantendrá visible el contexto de la operación.',state:'CONTEO ACTIVO'}
      : {key:'count',title:'¿Iniciamos un conteo?',body:'Crea uno nuevo o continúa un conteo abierto.',state:'INVENTARIO FÍSICO'};
  }
  if(byId('invList')) return {key:'inventory',title:'Aquí tienes el estado actual del inventario.',body:'Busca por SKU, UPC, descripción, marca, talla o color.',state:'INVENTARIO'};
  if(byId('manualSearch')) return {key:'search',title:'¿Qué estamos buscando?',body:'Escanea un SKU, UPC o marbete y Nova te ayudará a localizarlo.',state:'BÚSQUEDA'};
  if(byId('manualMove')){
    const entry=/Recibir/i.test(text('.page-title h1'));
    return entry
      ? {key:'entry',title:'Vamos a recibir mercancía.',body:'Escanea el producto, confirma la cantidad y selecciona su ubicación.',state:'RECEPCIÓN'}
      : {key:'exit',title:'Vamos a preparar una salida.',body:'Escanea el producto y verifica sus existencias antes de confirmar.',state:'SALIDA'};
  }
  if(document.querySelector('.action-grid')){
    if(isAdmin()) return {key:'home-admin',title:'Bienvenido, administrador. ¿Qué vamos a hacer hoy?',body:'La operación está lista. Puedes trabajar inventario o revisar herramientas administrativas.',state:'SISTEMA LISTO'};
    const [title,body]=sessionHomePhrase();
    const emp=employee();
    return {key:'home',title,body:emp?`${body} Sesión identificada con el empleado ${emp}.`:body,state:'OPERACIÓN EN LÍNEA'};
  }
  return {key:'generic',title:'Nova está lista.',body:'Continúa con la operación. Te avisaré si algo requiere atención.',state:'EN LÍNEA'};
}

function renderAssistant(force=false){
  const c=context();
  const content=document.querySelector('.app-shell .content');
  if(!c||!content) return;
  let panel=byId('novaAssistant');
  if(!panel){
    panel=document.createElement('section');
    panel.id='novaAssistant';
    panel.className='nova-assistant';
    panel.setAttribute('aria-live','polite');
    panel.innerHTML='<div class="nova-core" aria-hidden="true"><span>N</span></div><div class="nova-assistant-copy"><div class="nova-assistant-kicker"><i></i>NOVA · ASISTENTE OPERATIVO</div><h3></h3><p></p></div><div class="nova-assistant-state"></div>';
    content.prepend(panel);
    force=true;
  }
  if(!force&&panel.dataset.context===c.key) return;
  panel.dataset.context=c.key;
  panel.className='nova-assistant';
  panel.querySelector('h3').textContent=c.title;
  panel.querySelector('p').textContent=c.body;
  panel.querySelector('.nova-assistant-state').textContent=c.state;
  panel.classList.remove('nova-swap');
  void panel.offsetWidth;
  panel.classList.add('nova-swap');
}

function schedule(records=[]){
  if(records.length&&records.every(r=>r.target instanceof Element&&r.target.closest?.('#novaAssistant'))) return;
  if(queued) return;
  queued=true;
  requestAnimationFrame(()=>{queued=false;renderAssistant();});
}

function start(){
  const app=byId('app');
  if(!app) return;
  new MutationObserver(schedule).observe(app,{childList:true,subtree:true});
  renderAssistant(true);
}

window.addEventListener('online',()=>renderAssistant(true));
window.addEventListener('offline',()=>{
  renderAssistant();
  const p=byId('novaAssistant');
  if(!p) return;
  p.dataset.context='offline';
  p.classList.add('error');
  p.querySelector('h3').textContent='He perdido conexión momentáneamente.';
  p.querySelector('p').textContent='No se guardarán cambios hasta recuperar internet.';
  p.querySelector('.nova-assistant-state').textContent='SIN CONEXIÓN';
});

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
else start();
console.info(`Nova Assistant ${NOVA_ASSISTANT_VERSION} modo seguro activo`);
