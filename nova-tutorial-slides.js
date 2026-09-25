const NOVA_TUTORIAL_VERSION = '3.6.0';
const $ = id => document.getElementById(id);
const esc = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const slides = [
  {
    icon:'N',
    title:'Bienvenido a Nova',
    subtitle:'Tu asistente operativo de inventario',
    visual:['NOVA EN LÍNEA','Entradas · Salidas · Búsqueda · Conteos','Todo desde el mismo teléfono'],
    steps:['Elige la operación que necesitas.','Nova te muestra qué hacer en cada pantalla.','Las acciones importantes quedan registradas en el sistema.'],
    tip:'Piensa en Nova como un asistente: tú decides la operación y Nova te guía paso a paso.',
    narration:'Bienvenido al tutorial de Nova. Nova es tu asistente operativo para inventario. Desde aquí puedes recibir mercancía, registrar salidas, buscar productos, hacer conteos y consultar la operación. Vamos a verlo de forma rápida y práctica.'
  },
  {
    icon:'10', title:'Acceso del vendedor', subtitle:'Clave 10 más gafete o número de empleado',
    visual:['CLAVE 10','Escanea el gafete','Empleado identificado'],
    steps:['Escribe 10 en Clave.','Escanea el gafete o escribe el número de empleado.','Al entrar escucharás “Bienvenido a Nova”.'],
    tip:'No necesitas dar de alta previamente cada vendedor. El número identifica la sesión actual.',
    narration:'Para entrar como vendedor, escribe la clave diez. Después escanea el gafete o escribe el número de empleado. Nova usará ese número para identificar la sesión y asociarlo automáticamente a las entradas y salidas.'
  },
  {
    icon:'99', title:'Acceso administrador', subtitle:'Funciones sensibles y configuración',
    visual:['CLAVE 99','PIN privado','Ajustes · Historial · Importación'],
    steps:['Escribe 99.','Ingresa el PIN privado de administrador.','Desde este acceso puedes configurar y auditar la operación.'],
    tip:'El PIN administrativo permanece privado; el tutorial nunca lo muestra.',
    narration:'El administrador entra con la clave noventa y nueve y su PIN privado. Este acceso permite revisar historial, importar catálogos, administrar departamentos y ubicaciones, además de las funciones normales de inventario.'
  },
  {
    icon:'⌂', title:'Inicio', subtitle:'¿Qué vamos a hacer hoy?',
    visual:['Recibir mercancía','Sacar de bodega','Buscar · Inventario físico'],
    steps:['Toca la tarea que quieres realizar.','Revisa el resumen de operación cuando esté disponible.','Puedes volver a Inicio en cualquier momento.'],
    tip:'Las tareas más usadas están al frente para reducir pasos durante la operación.',
    narration:'En Inicio encuentras las tareas principales. Puedes recibir mercancía, sacar productos de bodega, buscar un artículo o comenzar un inventario físico. Nova cambia su mensaje según la tarea que elijas.'
  },
  {
    icon:'＋', title:'Recibir mercancía', subtitle:'Agregar existencias de forma rápida',
    visual:['Escanear UPC o SKU','Cantidad 1','Ubicación opcional · Registrar entrada'],
    steps:['Escanea o escribe el UPC o SKU.','Confirma la cantidad que está entrando.','Si aplica, escanea el marbete de ubicación y registra la entrada.'],
    tip:'Después de guardar, verifica el mensaje de confirmación y el stock resultante.',
    narration:'Para recibir mercancía, escanea el UPC o SKU del producto. Confirma la cantidad. Si quieres indicar dónde quedará físicamente, selecciona o escanea una ubicación. Finalmente registra la entrada y Nova actualizará el stock.'
  },
  {
    icon:'−', title:'Sacar de bodega', subtitle:'Registrar salidas con control de existencia',
    visual:['Producto encontrado','Stock disponible','Cantidad · Registrar salida'],
    steps:['Escanea el producto que vas a retirar.','Comprueba la existencia mostrada en pantalla.','Indica la cantidad y registra la salida.'],
    tip:'Si la cantidad supera el stock disponible, Nova te avisará antes de guardar.',
    narration:'Para una salida, escanea el producto y revisa primero el stock disponible. Escribe la cantidad que retirarás y confirma. Nova evitará que registres una salida mayor a la existencia disponible.'
  },
  {
    icon:'⌕', title:'Buscar', subtitle:'SKU, UPC o marbete en una sola búsqueda',
    visual:['Escanear código','Producto + stock','Ubicaciones encontradas'],
    steps:['Escanea o escribe el código.','Si es un producto, verás stock y ubicaciones.','Si es un marbete, verás los productos asociados.'],
    tip:'Úsalo para responder rápido “¿cuánto hay?” y “¿dónde está?”.',
    narration:'La búsqueda acepta UPC, SKU y marbetes. Si buscas un producto, Nova muestra sus existencias y ubicaciones. Si escaneas un marbete, puedes consultar qué productos están asociados a esa ubicación.'
  },
  {
    icon:'▦', title:'Inventario', subtitle:'Consulta rápida del catálogo actual',
    visual:['Buscar descripción o SKU','Con stock · Agotados · Stock bajo','Existencia actual'],
    steps:['Escribe parte del SKU, UPC, descripción, marca, talla o color.','Usa los filtros de stock.','Abre el producto que necesitas consultar.'],
    tip:'El filtro de stock bajo ayuda a detectar mercancía que requiere atención.',
    narration:'En Inventario puedes consultar el catálogo del departamento. Busca por código o descripción y utiliza los filtros para ver productos con stock, agotados o con existencia baja.'
  },
  {
    icon:'✓', title:'Inventario físico', subtitle:'Contar y detectar diferencias',
    visual:['Nuevo conteo','Escanear producto','Sistema vs físico · Diferencia'],
    steps:['Crea un conteo o abre uno pendiente.','Escanea productos e indica lo contado físicamente.','Pausa cuando lo necesites y cierra al terminar.'],
    tip:'El cierre permite revisar diferencias antes de que el inventario quede ajustado.',
    narration:'El inventario físico compara lo que existe en el sistema contra lo que realmente cuentas. Crea un conteo, escanea cada producto y captura la cantidad física. Puedes pausarlo y continuar después. Al cerrar, revisa las diferencias.'
  },
  {
    icon:'⌖', title:'Ubicaciones y marbetes', subtitle:'Saber dónde está cada producto',
    visual:['BODEGA · RACK · CAJA','Código de marbete','Producto asociado'],
    steps:['En Ajustes abre Ubicaciones.','Crea o escanea el código físico de la ubicación.','Asocia productos y, si quieres, una cantidad ubicada.'],
    tip:'Un marbete puede representar una caja, cajón, rack, mueble o zona de piso.',
    narration:'Las ubicaciones ayudan a encontrar la mercancía físicamente. Puedes crear códigos para cajas, cajones, muebles, racks o zonas de bodega y asociar productos a cada marbete.'
  },
  {
    icon:'⇧', title:'Importar Excel o CSV', subtitle:'Actualizar el catálogo en masa',
    visual:['Seleccionar archivo','Revisar columnas','Vista previa · Importar'],
    steps:['Selecciona el archivo.','Confirma que cada columna esté correctamente asignada.','Revisa la vista previa y elige el tipo de importación.'],
    tip:'“Actualizar catálogo” no cambia stock; “inventario físico” sí ajusta existencias.',
    narration:'Para cargar muchos productos, usa Importar Excel o CSV. Primero revisa cómo Nova relacionó las columnas. Después verifica la vista previa. Puedes actualizar solamente el catálogo o realizar también un ajuste de inventario físico.'
  },
  {
    icon:'☷', title:'Historial y auditoría', subtitle:'Reconstruir qué ocurrió',
    visual:['Fecha · Tipo','Empleado o nota','SKU · Ubicación · Exportar'],
    steps:['Selecciona el rango de fechas.','Filtra por movimiento, empleado, código o ubicación.','Exporta a CSV o Excel cuando necesites evidencia.'],
    tip:'El número del empleado queda asociado automáticamente a las entradas y salidas de vendedor.',
    narration:'Historial sirve para auditar la operación. Puedes filtrar por fechas, tipo de movimiento, empleado, SKU, UPC o ubicación. Cuando lo necesites, exporta el resultado a CSV o Excel.'
  },
  {
    icon:'◇', title:'Departamentos', subtitle:'Separar la operación correctamente',
    visual:['Belleza','Calzado · Ropa · Otro','Departamento activo'],
    steps:['Crea departamentos desde Ajustes.','Activa o desactiva los que estén en operación.','Usa el selector superior para cambiar de departamento.'],
    tip:'El catálogo y los movimientos se consultan dentro del departamento activo.',
    narration:'Los departamentos mantienen separada la operación. El administrador puede crearlos, activarlos o desactivarlos. Antes de trabajar, confirma siempre qué departamento aparece en la parte superior.'
  },
  {
    icon:'↗', title:'Cerrar sesión', subtitle:'Dejar Nova lista para el siguiente operador',
    visual:['Salir','Sesión finalizada','Nueva identificación'],
    steps:['Pulsa Salir al terminar tu turno o cambiar de operador.','Nova cierra la sesión actual.','El siguiente vendedor deberá identificarse con su propio número.'],
    tip:'Cerrar sesión evita que movimientos posteriores queden asociados al operador anterior.',
    narration:'Cuando termines, pulsa Salir. En una sesión de vendedor, Nova elimina la identificación actual para que el siguiente operador ingrese con su propio gafete o número de empleado.'
  }
];

let current = 0;
let autoPlay = false;
let speaking = false;
let speechToken = 0;

function stopSpeech(){
  speechToken++;
  speaking = false;
  try { speechSynthesis.cancel(); } catch {}
  syncVoiceButton();
}

function speakSlide({auto=false}={}){
  const slide = slides[current];
  if (!slide || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
  stopSpeech();
  const token = speechToken;
  const utterance = new SpeechSynthesisUtterance(slide.narration);
  utterance.lang = 'es-MX';
  utterance.rate = .94;
  utterance.pitch = 1;
  utterance.volume = 1;
  const voices = speechSynthesis.getVoices?.() || [];
  utterance.voice = voices.find(v=>/^es-MX$/i.test(v.lang)) || voices.find(v=>/^es/i.test(v.lang)) || null;
  speaking = true;
  syncVoiceButton();
  const done = () => {
    if (token !== speechToken) return;
    speaking = false;
    syncVoiceButton();
    if (autoPlay && auto && current < slides.length - 1) {
      setTimeout(()=>{ if(autoPlay){ current++; renderSlide(); speakSlide({auto:true}); } }, 650);
    } else if (autoPlay && auto && current === slides.length - 1) {
      autoPlay = false;
      syncAutoButton();
    }
  };
  utterance.onend = done;
  utterance.onerror = done;
  try { speechSynthesis.speak(utterance); } catch { done(); }
}

function visualHtml(slide){
  return `<div class="nova-demo-phone">
    <div class="nova-demo-top"><div class="nova-demo-mark">N</div><div><b>NOVA</b><small>ASISTENTE OPERATIVO</small></div><span>● EN LÍNEA</span></div>
    <div class="nova-demo-screen">
      <div class="nova-demo-icon">${esc(slide.icon)}</div>
      <strong>${esc(slide.visual[0])}</strong>
      <div class="nova-demo-field">${esc(slide.visual[1])}</div>
      <div class="nova-demo-field secondary">${esc(slide.visual[2])}</div>
      <div class="nova-demo-action">Continuar</div>
    </div>
  </div>`;
}

function renderSlide(){
  const host = $('novaSlideStage');
  if (!host) return;
  const s = slides[current];
  const pct = Math.round((current + 1) / slides.length * 100);
  host.innerHTML = `
    <div class="nova-slide-progress"><i style="width:${pct}%"></i></div>
    <div class="nova-slide-meta"><span>DIAPOSITIVA ${String(current+1).padStart(2,'0')} / ${slides.length}</span><b>${pct}%</b></div>
    <section class="nova-slide-card">
      <div class="nova-slide-visual">${visualHtml(s)}</div>
      <div class="nova-slide-copy">
        <div class="eyebrow">NOVA · ENTRENAMIENTO PRÁCTICO</div>
        <h2>${esc(s.title)}</h2>
        <p class="nova-slide-subtitle">${esc(s.subtitle)}</p>
        <div class="nova-slide-do"><b>Haz esto</b>${s.steps.map((step,i)=>`<div><span>${i+1}</span><p>${esc(step)}</p></div>`).join('')}</div>
        <div class="nova-slide-tip"><span>◆</span><p><b>Consejo Nova</b>${esc(s.tip)}</p></div>
      </div>
    </section>
    <div class="nova-slide-dots" aria-label="Progreso del tutorial">${slides.map((_,i)=>`<button type="button" data-nova-slide="${i}" class="${i===current?'active':''}" aria-label="Ir a diapositiva ${i+1}"></button>`).join('')}</div>`;

  document.querySelectorAll('[data-nova-slide]').forEach(btn => btn.onclick = () => {
    autoPlay = false; syncAutoButton(); stopSpeech(); current = Number(btn.dataset.novaSlide); renderSlide();
  });
  syncNav();
}

function syncNav(){
  const prev = $('novaTutorialPrev'), next = $('novaTutorialNext');
  if (prev) prev.disabled = current === 0;
  if (next) next.textContent = current === slides.length - 1 ? 'Finalizar' : 'Siguiente →';
}
function syncVoiceButton(){
  const b = $('novaTutorialSpeak');
  if (b) b.textContent = speaking ? '■ Detener voz' : '🔊 Escuchar explicación';
}
function syncAutoButton(){
  const b = $('novaTutorialAuto');
  if (b) b.textContent = autoPlay ? '⏸ Pausar recorrido' : '▶ Reproducir recorrido';
}

function openTutorial(){
  const box = $('adminBody');
  if (!box) return;
  stopSpeech(); autoPlay = false; current = 0;
  document.querySelectorAll('.tabbtn').forEach(b=>b.classList.remove('active'));
  $('novaTutorialTab')?.classList.add('active');
  box.classList.remove('tab-enter'); void box.offsetWidth; box.classList.add('tab-enter','nova-slide-container');
  box.innerHTML = `
    <div class="nova-slide-header">
      <div><div class="eyebrow">NOVA · TUTORIAL INTERACTIVO</div><h2>Aprende Nova paso a paso</h2><p>Una función por diapositiva. Puedes escuchar a Nova o avanzar a tu ritmo.</p></div>
      <div class="nova-slide-version">v${NOVA_TUTORIAL_VERSION}</div>
    </div>
    <div class="nova-tutorial-controls-top">
      <button id="novaTutorialSpeak" type="button" class="secondary">🔊 Escuchar explicación</button>
      <button id="novaTutorialAuto" type="button" class="secondary">▶ Reproducir recorrido</button>
    </div>
    <div id="novaSlideStage"></div>
    <div class="nova-tutorial-nav">
      <button id="novaTutorialPrev" type="button" class="secondary">← Anterior</button>
      <button id="novaTutorialNext" type="button" class="primary">Siguiente →</button>
    </div>`;
  renderSlide();
  $('novaTutorialSpeak').onclick = () => speaking ? stopSpeech() : speakSlide();
  $('novaTutorialAuto').onclick = () => {
    if (autoPlay) { autoPlay=false; stopSpeech(); syncAutoButton(); return; }
    autoPlay=true; syncAutoButton(); speakSlide({auto:true});
  };
  $('novaTutorialPrev').onclick = () => {
    if (current <= 0) return; autoPlay=false; syncAutoButton(); stopSpeech(); current--; renderSlide();
  };
  $('novaTutorialNext').onclick = () => {
    if (current >= slides.length-1) {
      stopSpeech(); autoPlay=false; syncAutoButton();
      $('novaSlideStage').innerHTML = `<section class="nova-tutorial-finish"><div class="nova-finish-core">N</div><div class="eyebrow">TUTORIAL COMPLETADO</div><h2>Nova está lista para trabajar.</h2><p>Ya conoces el flujo completo. Puedes volver cuando necesites repasar una función.</p><button id="novaTutorialRestart" class="primary" type="button">Repetir tutorial</button></section>`;
      document.querySelector('.nova-tutorial-nav').style.display='none';
      $('novaTutorialRestart').onclick=openTutorial;
      return;
    }
    autoPlay=false; syncAutoButton(); stopSpeech(); current++; renderSlide();
  };
}

function syncTutorialTab(){
  const row = document.querySelector('.tabs-row');
  if (!row) { if (!$('adminBody')) stopSpeech(); return; }

  // La antigua Guía contiene instrucciones obsoletas. Tutorial Nova es ahora la única ayuda.
  row.querySelector('[data-atab="onboarding"]')?.remove();

  let btn = $('novaTutorialTab');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'novaTutorialTab';
    btn.type = 'button';
    btn.className = 'tabbtn nova-tutorial-tab';
    row.appendChild(btn);
  }
  btn.textContent = '▶ Tutorial Nova';
  btn.onclick = openTutorial;

  row.querySelectorAll('[data-atab]').forEach(tab => {
    if (tab.dataset.novaTutorialWired === '1') return;
    tab.dataset.novaTutorialWired = '1';
    tab.addEventListener('click',()=>{ stopSpeech(); autoPlay=false; btn.classList.remove('active'); });
  });
}

let queued=false;
const observer = new MutationObserver(()=>{
  if (queued) return; queued=true;
  requestAnimationFrame(()=>{queued=false;syncTutorialTab();});
});
observer.observe(document.getElementById('app') || document.body,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',syncTutorialTab,{once:true});
syncTutorialTab();

console.info(`Nova Tutorial ${NOVA_TUTORIAL_VERSION} activo`);
