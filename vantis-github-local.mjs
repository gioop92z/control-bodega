import {LocalInventoryApi,LOCAL_DEPARTMENT} from './vantis-github-local-db.mjs?v=5.13.0';
import {ContinuousReceive} from './continuous-receive.mjs?v=5.13.0';
import {mountContinuousReceive} from './continuous-receive-ui.mjs?v=5.13.0';
import {startScanner,stopScanner} from './scanner.js?v=5.13.0';

const $=id=>document.getElementById(id);
const STORAGE_OPERATOR='vantis.github.local.operator';
let api=null,queue=null,unmount=null,lastBackupCount=0;
const filenameStamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
function status(message,error=false){
  const node=$('localBackupStatus');
  node.textContent=message;
  node.classList.toggle('is-error',error);
}
function errorText(error){return error?.message||String(error);}
function download(name,contents,mime){
  const blob=new Blob([contents],{type:mime});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;anchor.download=name;
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
const csvCell=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
const csvLine=row=>row.map(csvCell).join(',');
async function exportInventory(mode){
  if(!api)return;
  const pending=queue?.pending||0;
  if(pending)throw Error('Hay '+pending+' lecturas pendientes. Espera a que todas aparezcan «Guardado» antes del respaldo.');
  status('Preparando respaldo local…');
  const backup=await api.exportBackup();
  const name='VANTIS-local-'+filenameStamp();
  if(mode==='json'){
    download(name+'.json',JSON.stringify(backup),'application/json;charset=utf-8');
  }else{
    const data=backup.items.receipts;
    const lines=[
      ['Folio','Fecha','Empleado','SKU/UPC','Marbete','Tipo','Cantidad','Stock resultante','Sesión'],
      ...data.map(x=>[x.id,x.receipt?.stored_at,x.payload?.p_operador,x.receipt?.sku,
        x.receipt?.marbete_codigo,x.receipt?.kind,x.receipt?.kind==='undo'?-1:1,
        x.receipt?.stock_resultante,x.receipt?.session_id])
    ];
    download(name+'.csv','\uFEFF'+lines.map(csvLine).join('\r\n'),'text/csv;charset=utf-8');
  }
  lastBackupCount=backup.items.receipts.length;
  status('Respaldo descargado: '+lastBackupCount+' movimientos. Guárdalo fuera de este dispositivo.');
}
async function refreshTotals(){
  if(!api)return;
  try{
    const s=await api.summary();
    $('localTotals').textContent=s.receipts.toLocaleString('es-MX')+' movimientos confirmados · '+
      s.units.toLocaleString('es-MX')+' unidades en inventario · '+
      s.labels.toLocaleString('es-MX')+' marbetes';
    if(s.receipts-lastBackupCount>=500)
      status('Ya hay '+(s.receipts-lastBackupCount).toLocaleString('es-MX')+' movimientos desde tu último respaldo. Descarga JSON ahora.');
  }catch(error){status('No se pudo consultar inventario: '+errorText(error),true);}
}
async function mount(employee){
  $('localWelcomeError').hidden=true;
  try{
    api=new LocalInventoryApi();
    await api.capabilities();
    if(!('localStorage' in window)||!navigator.locks?.request)
      throw Error('Se requiere Safari actualizado con IndexedDB, almacenamiento local y Web Locks.');
    // Browser storage persistence is best effort; it does not replace backups.
    try{await navigator.storage?.persist?.();}catch{}
    const actor='Empleado '+employee;
    queue=new ContinuousReceive({
      api,storage:localStorage,userId:'local-device',deptId:LOCAL_DEPARTMENT,actor,
      online:()=>true
    });
    $('localWelcome').hidden=true;
    $('localWorkspace').hidden=false;
    const root=$('localReceiveRoot');
    unmount=mountContinuousReceive(root,queue,{
      startScanner,stopScanner,
      onLegacy:()=>status('La recepción por lote antigua requiere servidor. Usa el lector continuo de esta pantalla.'),
      onEvidence:(id,code,frame)=>{
        Promise.resolve(frame).then(blob=>blob?api.saveEvidence(id,blob):false)
          .then(saved=>queue?.markEvidence(id,saved?'local':'failed'))
          .catch(()=>queue?.markEvidence(id,'failed'));
      }
    });
    // Retain the original responsive UI and refresh secondary totals sparsely.
    const confirmed=queue.onConfirmed;
    queue.onConfirmed=row=>{
      confirmed(row);
      if(queue.report().confirmed%50===0)void refreshTotals();
    };
    await refreshTotals();
    queue.onChange?.();
  }catch(error){
    $('localWorkspace').hidden=true;
    $('localWelcome').hidden=false;
    $('localWelcomeError').textContent='No se pudo abrir el inventario: '+errorText(error);
    $('localWelcomeError').hidden=false;
  }
}
$('localLogin').addEventListener('submit',event=>{
  event.preventDefault();
  const employee=$('localEmployee').value.trim();
  if(!/^\d{4,12}$/.test(employee))return;
  sessionStorage.setItem(STORAGE_OPERATOR,employee);
  void mount(employee);
});
$('localJson').addEventListener('click',()=>void exportInventory('json').catch(e=>status(errorText(e),true)));
$('localCsv').addEventListener('click',()=>void exportInventory('csv').catch(e=>status(errorText(e),true)));
$('localImport').addEventListener('change',async event=>{
  const file=event.target.files?.[0];
  if(!file)return;
  try{
    if(queue?.pending)throw Error('Confirma o revisa las lecturas pendientes antes de importar.');
    const archive=JSON.parse(await file.text());
    if(!confirm('Solo se puede restaurar en una base de datos vacía. ¿Continuar?'))return;
    const restored=await api.restoreBackup(archive);
    status('Restaurados '+restored+' movimientos. Se conservan los folios originales, sin duplicarlos.');
    await refreshTotals();
  }catch(error){status('No se pudo restaurar: '+errorText(error),true);}
  finally{event.target.value='';}
});
$('localExit').addEventListener('click',async()=>{
  if(!queue)return;
  if(queue.pending||queue.state.pendingLabels?.length){
    status('No puedes cambiar de empleado con lecturas o marbetes pendientes. Conserva esta sesión.',true);
    return;
  }
  if(!confirm('¿Terminar la sesión del empleado? El inventario confirmado permanecerá en este dispositivo.'))return;
  unmount?.();unmount=null;
  try{await queue?.dispose();}catch{}
  queue=null;
  sessionStorage.removeItem(STORAGE_OPERATOR);
  $('localReceiveRoot').replaceChildren();
  $('localWorkspace').hidden=true;
  $('localWelcome').hidden=false;
  $('localEmployee').value='';
});
const savedEmployee=sessionStorage.getItem(STORAGE_OPERATOR);
if(savedEmployee&&/^\d{4,12}$/.test(savedEmployee)){
  $('localEmployee').value=savedEmployee;
  void mount(savedEmployee);
}
