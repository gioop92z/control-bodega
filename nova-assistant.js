const ASSISTANT_VERSION = '3.5.0';
const root = () => document.getElementById('app');
const byId = id => document.getElementById(id);
const text = sel => document.querySelector(sel)?.textContent?.trim() || '';
const isAdmin = () => /Administrador|acceso\s*99/i.test(text('.access-label'));
const isSeller = () => /Vendedor general|acceso\s*10/i.test(text('.access-label'));
const employee = () => text('.nova-employee-chip').replace(/^Emp\.\s*/i,'').trim();
let queued = false;
let lastSpoken = '';
let lastSpokenAt = 0;

const HOME_PHRASES = [
  ['¿Qué vamos a hacer hoy?','Nova está lista para entradas, salidas, búsquedas y conteos.'],
  ['Sistema listo. ¿Por dónde empezamos?','Toda la operación está disponible desde este panel.'],
  ['Nova está en línea.','Elige una tarea y te acompañaré durante el proceso.']
];

function sessionHomePhrase(){
  let i = Number(sessionStorage.getItem('nova.homePhrase'));
  if (!Number.isInteger(i) || i < 0 || i >= HOME_PHRASES.length) {
    i = Math.floor(Math.random()*HOME_PHRASES.length);
    sessionStorage.setItem('nova.homePhrase',String(i));
  }
  return HOME_PHRASES[i];
}

function context(){
  if (!document.querySelector('.app-shell')) return null;
  if (document.querySelector('.nova-tutorial-container')) return {
    key:'tutorial', title:'Aquí tienes la guía completa de Nova.', body:'Puedes consultar cualquier función antes de utilizarla en operación.', state:'MODO GUÍA'
  };
  if (byId('historyList')) return {
    key:'history', title:'Aquí está todo lo que ha ocurrido.', body:'Filtra por fecha, empleado, producto o ubicación para reconstruir cualquier movimiento.', state:'AUDITORÍA'
  };
  if (byId('importBody')) return {
    key:'import', title:'Prepararé el catálogo.', body:'Carga el archivo, revisa las columnas y Nova te ayudará a validar la importación antes de aplicarla.', state:'IMPORTACIÓN'
  };
  if (byId('adminBody')) return {
    key:'admin', title:'¿Qué deseas configurar?', body:'Departamentos, ubicaciones y herramientas administrativas están disponibles aquí.', state:'ADMINISTRACIÓN'
  };
  if (byId('countArea')) {
    const active = !!document.querySelector('.count-head');
    return active ? {
      key:'count-active', title:'Conteo en progreso.', body:'Escanea cada producto. Iré registrando el avance para que puedas continuar sin perder el control.', state:'CONTEO ACTIVO'
    } : {
      key:'count', title:'¿Iniciamos un conteo?', body:'Crea uno nuevo o continúa un conteo abierto. Nova conservará el avance de la operación.', state:'INVENTARIO FÍSICO'
    };
  }
  if (byId('invList')) return {
    key:'inventory', title:'Aquí tienes el estado actual del inventario.', body:'Busca por SKU, UPC, descripción, marca, talla o color y filtra las existencias que requieren atención.', state:'INVENTARIO'
  };
  if (byId('manualSearch')) {
    const found = !!document.querySelector('.content .product-head') || /Ubicación/i.test(text('.content .card .tiny'));
    return found ? {
      key:'search-found', title:'Lo encontré.', body:'Aquí tienes las existencias y la ubicación disponible para este código.', state:'RESULTADO LISTO', tone:'success'
    } : {
      key:'search', title:'¿Qué estamos buscando?', body:'Escanea un SKU, UPC o marbete y yo me encargo del resto.', state:'BÚSQUEDA'
    };
  }
  if (byId('manualMove')) {
    const h = text('.page-title h1');
    if (/Recibir/i.test(h)) return {
      key:'entry', title:'Vamos a recibir mercancía.', body:'Escanea el primer producto, confirma la cantidad y selecciona su ubicación.', state:'RECEPCIÓN'
    };
    return {
      key:'exit', title:'Vamos a preparar una salida.', body:'Escanea el producto que necesitas retirar y verifica sus existencias antes de confirmar.', state:'SALIDA'
    };
  }
  if (document.querySelector('.action-grid')) {
    const [title,body] = sessionHomePhrase();
    if (isAdmin()) return {key:'home-admin',title:'Bienvenido, administrador. ¿Qué vamos a hacer hoy?',body:'La operación está lista. Puedes trabajar inventario o revisar herramientas administrativas.',state:'SISTEMA LISTO'};
    const emp = employee();
    return {key:'home',title,body:emp?`${body} Sesión identificada con el empleado ${emp}.`:body,state:'OPERACIÓN EN LÍNEA'};
  }
  return {key:'generic',title:'Nova está lista.',body:'Continúa con la operación. Te avisaré si algo requiere atención.',state:'EN LÍNEA'};
}

function assistantElement(){
  return document.getElementById('novaAssistant');
}

function renderAssistant(force=false){
  const c = context();
  const content = document.querySelector('.app-shell .content');
  if (!c || !content) return;
  let panel = assistantElement();
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'novaAssistant';
    panel.className = 'nova-assistant';
    panel.setAttribute('aria-live','polite');
    panel.innerHTML = `<div class="nova-core" aria-hidden="true"><span>N</span></div><div class="nova-assistant-copy"><div class="nova-assistant-kicker"><i></i>NOVA · ASISTENTE OPERATIVO</div><h3></h3><p></p></div><div class="nova-assistant-state"></div>`;
    content.prepend(panel);
    force = true;
  }
  if (!force && panel.dataset.context === c.key) return;
  panel.dataset.context = c.key;
  panel.className = `nova-assistant ${c.tone||''}`.trim();
  panel.querySelector('h3').textContent = c.title;
  panel.querySelector('p').textContent = c.body;
  panel.querySelector('.nova-assistant-state').textContent = c.state;
  panel.classList.remove('nova-swap');
  void panel.offsetWidth;
  panel.classList.add('nova-swap');
}

function say(message){
  const now = Date.now();
  if (!message || (message === lastSpoken && now-lastSpokenAt < 5000)) return;
  lastSpoken = message; lastSpokenAt = now;
  try {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(message);
    u.lang = 'es-MX'; u.rate = .96; u.pitch = 1; u.volume = 1;
    const voices = speechSynthesis.getVoices?.() || [];
    u.voice = voices.find(v=>/^es-MX$/i.test(v.lang)) || voices.find(v=>/^es/i.test(v.lang)) || null;
    speechSynthesis.speak(u);
  } catch {}
}

function setAssistant(title,body,state='NOVA',tone='',thinking=false){
  renderAssistant();
  const panel = assistantElement();
  if (!panel) return;
  panel.dataset.context = `event-${Date.now()}`;
  panel.className = `nova-assistant ${tone} ${thinking?'thinking':''}`.trim();
  panel.querySelector('h3').textContent = title;
  panel.querySelector('p').textContent = body;
  panel.querySelector('.nova-assistant-state').textContent = state;
}

function currentMoveType(){
  return /Recibir/i.test(text('.page-title h1')) ? 'entrada' : 'salida';
}

function handleClick(event){
  const el = event.target instanceof Element ? event.target : null;
  if (!el) return;
  if (el.closest('#scanMove')) setAssistant('Cámara lista.','Coloca el UPC o SKU dentro del área de lectura.','ESCANEANDO','',true);
  if (el.closest('#scanSearch')) setAssistant('Estoy lista para buscar.','Escanea el código y consultaré producto, existencias y ubicación.','ESCANEANDO','',true);
  if (el.closest('#saveMove')) {
    const type = currentMoveType();
    setAssistant(`Registrando ${type}…`,'Estoy validando producto, cantidad y existencias antes de confirmar.','PROCESANDO','',true);
  }
  if (el.closest('#newCount')) {
    setAssistant('Iniciemos el conteo.','Asigna un nombre y después escanea el primer producto. Yo iré registrando el avance.','NUEVO CONTEO');
    say('Iniciemos el conteo. Yo iré registrando cada producto.');
  }
  if (el.closest('#pauseCount')) setAssistant('Conteo en pausa.','Tu progreso permanece guardado. Puedes retomarlo cuando estés listo.','PAUSADO','attention');
  if (el.closest('#closeCount')) setAssistant('Revisando el cierre.','Confirmaré las diferencias antes de finalizar el conteo.','VALIDANDO','',true);
  if (el.closest('#runImport')) setAssistant('Procesando el archivo.','Estoy actualizando la información por bloques para mantener la operación estable.','IMPORTANDO','',true);
  if (el.closest('#hSearch')) setAssistant('Consultando historial…','Aplicaré los filtros seleccionados y prepararé la auditoría.','CONSULTANDO','',true);
}

function handleSubmit(event){
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === 'manualSearch') setAssistant('Estoy buscando…','Consultando producto, existencias y ubicación.','BUSCANDO','',true);
  if (form.id === 'manualMove') setAssistant('Buscando producto…','Estoy verificando el código dentro del departamento actual.','BUSCANDO','',true);
  if (form.id === 'manualCount') setAssistant('Verificando producto…','Buscaré el SKU o UPC antes de agregarlo al conteo.','CONTEO','',true);
}

function inspectFeedback(){
  const success = text('#moveSuccess .success');
  if (success) {
    const type = /Entrada/i.test(success) ? 'Entrada' : 'Salida';
    setAssistant(`${type} registrada.`,'Movimiento confirmado. Podemos continuar con el siguiente producto.','REGISTRADO','success');
    return;
  }
  const toast = document.getElementById('toast');
  if (!toast || toast.dataset.novaSeen === toast.textContent) return;
  toast.dataset.novaSeen = toast.textContent;
  const msg = toast.textContent.trim();
  if (!msg) return;
  if (/Solo hay .* piezas disponibles/i.test(msg)) {
    setAssistant('Atención: existencias insuficientes.','La cantidad solicitada supera el stock disponible. Revisa la cantidad antes de continuar.','REQUIERE ATENCIÓN','attention');
    say('Atención. Las existencias son insuficientes para este movimiento.');
  } else if (/Producto no encontrado|Código no encontrado/i.test(msg)) {
    setAssistant('No encontré ese código.','Verifica el SKU, UPC o marbete e inténtalo nuevamente.','SIN RESULTADOS','error');
  } else if (/Conteo guardado/i.test(msg)) {
    setAssistant('Producto contabilizado.','Registro actualizado. Puedes continuar con el siguiente producto.','CONTEO ACTUALIZADO','success');
  } else if (/Conteo cerrado/i.test(msg)) {
    setAssistant('Conteo finalizado.','El cierre quedó registrado. Revisa las diferencias y ajustes resultantes.','CONTEO CERRADO','success');
    say('Conteo finalizado. Revisemos las diferencias.');
  } else if (/Importación terminada/i.test(msg)) {
    setAssistant('Importación completada.','El catálogo terminó de procesarse. Revisa el resumen antes de continuar.','IMPORTACIÓN LISTA','success');
  } else if (/Sin conexión|conexión/i.test(msg) && /sin|perdi|offline/i.test(msg)) {
    setAssistant('He perdido conexión momentáneamente.','No realizaré cambios hasta que la conexión sea estable nuevamente.','SIN CONEXIÓN','error');
  }
}

function schedule(){
  if (queued) return;
  queued = true;
  requestAnimationFrame(()=>{
    queued = false;
    renderAssistant();
    inspectFeedback();
  });
}

document.addEventListener('click',handleClick,true);
document.addEventListener('submit',handleSubmit,true);
window.addEventListener('offline',()=>setAssistant('He perdido conexión momentáneamente.','Mantendré la operación protegida hasta recuperar internet.','SIN CONEXIÓN','error'));
window.addEventListener('online',()=>{setAssistant('Conexión restablecida.','Nova está nuevamente en línea y lista para continuar.','EN LÍNEA','success'); setTimeout(()=>renderAssistant(true),2200);});

const appObserver = new MutationObserver(schedule);
const start = ()=>{
  const app = root();
  if (app) appObserver.observe(app,{childList:true,subtree:true,characterData:true});
  renderAssistant(true);
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();

const feedbackObserver = new MutationObserver(()=>{inspectFeedback();});
feedbackObserver.observe(document.body,{childList:true,subtree:true});

console.info(`Nova Assistant ${ASSISTANT_VERSION} activo`);
