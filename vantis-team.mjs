import {TeamInventoryApi,openTeamSession,setupTeamAdmin,teamConfigured,TEAM_DEPARTMENT} from './vantis-team-api.mjs';
import {ContinuousReceive} from './continuous-receive.mjs?v=5.13.0';
import {mountContinuousReceive} from './continuous-receive-ui.mjs?v=5.13.0';
import {startScanner,stopScanner} from './scanner.js?v=5.13.0';
import {LocalInventoryApi} from './vantis-github-local-db.mjs?v=5.13.0';

const $=id=>document.getElementById(id);
const SESSION_KEY='vantis.team.session.v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const num=value=>Number(value||0).toLocaleString('es-MX');
let session=null,api=null,queue=null,unmount=null,refreshTimer=null,searchTimer=null;
const alertGlobal=message=>{
  const node=$('teamGlobalError');node.textContent=message;node.hidden=!message;
};
const reportError=error=>alertGlobal(error?.message||String(error));
function putSession(value){sessionStorage.setItem(SESSION_KEY,JSON.stringify(value));}
function getSession(){
  try{return JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');}catch{return null;}
}
function clearSession(){
  sessionStorage.removeItem(SESSION_KEY);session=null;
  clearInterval(refreshTimer);refreshTimer=null;
  unmount?.();unmount=null;queue=null;api=null;
  $('teamApp').hidden=true;
  $('teamLoginSection').hidden=false;
  $('teamPin').value='';
  $('teamEmployee').focus();
}
async function refreshSummary(){
  if(!api)return;
  const s=await api.summary();
  $('teamStats').innerHTML=
    '<div><b>'+num(s.units)+'</b><span>Piezas</span></div>'+
    '<div><b>'+num(s.products)+'</b><span>Artículos</span></div>'+
    '<div><b>'+num(s.labels)+'</b><span>Marbetes</span></div>'+
    '<div><b>'+num(s.receipts)+'</b><span>Movimientos</span></div>';
}
async function refreshHistory(){
  if(!api)return;
  const response=await api.history();
  const rows=response.items||[];
  $('teamHistory').innerHTML=rows.length?rows.map(x=>
    '<div class="team-history-row"><strong>'+esc(x.kind==='undo'?'−1':'+1')+' · '+esc(x.sku)+'</strong>'+
    '<span>'+esc(x.label)+' · Empleado '+esc(x.employee)+'</span>'+
    '<small>'+esc(x.stored_at)+'</small></div>').join(''):'Sin movimientos registrados.';
}
function showSearch(rows){
  $('teamResults').innerHTML=rows.length?rows.map(x=>
    '<article class="team-result"><div><b>'+esc(x.descripcion)+'</b><small>SKU/UPC '+esc(x.sku)+'</small></div>'+
    '<strong>'+num(x.stock)+' piezas</strong>'+
    '<div class="team-locations">'+(x.ubicaciones?.length
      ?x.ubicaciones.map(l=>'<span>'+esc(l.marbete)+' · '+num(l.cantidad)+'</span>').join('')
      :'<span>Sin existencias asignadas</span>')+'</div>'+
    (session?.role==='admin'?'<button type="button" class="team-describe" data-code="'+esc(x.sku)+'" data-description="'+esc(x.descripcion)+'">Editar descripción</button>':'')+
    '</article>').join(''):
    '<p class="team-muted">No se encontraron artículos. Prueba con el SKU, UPC o marbete.</p>';
}
async function search(){
  if(!api)return;
  const q=$('teamSearch').value.trim();
  if(!q){$('teamResults').replaceChildren();$('teamSearchStatus').textContent='';return;}
  $('teamSearchStatus').textContent='Buscando en el inventario central…';
  const result=await api.search(q);
  if(q!==$('teamSearch').value.trim())return;
  showSearch(result.items||[]);
  $('teamSearchStatus').textContent=num(result.items?.length)+' artículos encontrados';
}
async function refreshPeople(){
  if(!api||session.role!=='admin')return;
  const r=await api.people();
  $('teamPeopleList').innerHTML=(r.items||[]).map(p=>
    '<div class="team-person"><div><b>'+esc(p.name)+'</b><small>Gafete '+esc(p.employee)+' · '+esc(p.role)+'</small></div>'+
    '<span>'+ (p.active?'Activo':'Suspendido')+'</span>'+
    (p.employee===session.employee?'':('<button data-employee="'+esc(p.employee)+'" data-role="'+esc(p.role)+'" data-active="'+(p.active?0:1)+'" type="button">'+(p.active?'Suspender':'Reactivar')+'</button>'))+
    '</div>').join('');
}

let importingLocal=false;
function orderedLocalReceipts(backup){
  if(backup?.format!=='vantis-github-local-backup'||backup?.version!==1||
      backup?.department!==TEAM_DEPARTMENT||!Array.isArray(backup.items?.receipts))
    throw Error('El respaldo no corresponde al inventario local de VANTIS Zapatería Infantil.');
  const rows=backup.items.receipts;
  if(rows.length>120000)throw Error('El respaldo contiene demasiados movimientos.');
  const byId=new Map();
  for(const row of rows){
    const id=row?.payload?.p_id;
    if(!id||row?.receipt?.id!==id||byId.has(id)||!row.payload.p_producto||!row.payload.p_marbete)
      throw Error('El respaldo contiene folios repetidos o movimientos incompletos.');
    byId.set(id,row);
  }
  const sorted=[...rows].sort((a,b)=>
    String(a.receipt?.stored_at||'').localeCompare(String(b.receipt?.stored_at||'')));
  const state=new Map(),ordered=[];
  function visit(row){
    const id=row.payload.p_id;
    if(state.get(id)===2)return;
    if(state.get(id)===1)throw Error('El respaldo tiene referencias de reversa circulares.');
    state.set(id,1);
    const previous=byId.get(row.payload.p_reversa);
    if(previous)visit(previous);
    state.set(id,2);ordered.push(row);
  }
  for(const row of sorted)visit(row);
  return ordered;
}
async function migrateLocalBackup(backup){
  if(session?.role!=='admin'||!api||importingLocal)return;
  const rows=orderedLocalReceipts(backup),total=rows.length;
  const status=$('teamImportStatus'),progress=$('teamImportProgress');
  if(!total){status.textContent='No hay movimientos confirmados para importar.';return;}
  if(!confirm('Se copiarán '+num(total)+' movimientos al inventario compartido. No se borrará nada del iPhone. Los folios existentes se omitirán. ¿Continuar?'))return;
  importingLocal=true;
  $('teamImportLocal').disabled=true;
  $('teamImportBackup').disabled=true;
  progress.hidden=false;progress.value=0;
  let imported=0,repeated=0,processed=0;
  try{
    for(let i=0;i<total;i+=5){
      const batch=rows.slice(i,i+5);
      const result=await api.request('/api/import',{method:'POST',body:{items:batch}});
      imported+=Number(result.imported||0);
      repeated+=Number(result.repeated||0);
      processed+=batch.length;
      progress.value=Math.round(processed/total*100);
      status.textContent='Importados '+num(processed)+' de '+num(total)+' movimientos; '+num(repeated)+' ya existían.';
    }
    status.textContent='Migración terminada: '+num(imported)+' movimientos nuevos y '+num(repeated)+' repetidos omitidos. El inventario local sigue intacto.';
    await Promise.all([refreshSummary(),refreshHistory()]);
  }catch(error){
    status.textContent='Importación interrumpida tras '+num(processed)+' movimientos. '+(error?.message||error)+
      ' Puedes repetirla: los folios ya importados no se duplican.';
    throw error;
  }finally{
    importingLocal=false;
    $('teamImportLocal').disabled=false;
    $('teamImportBackup').disabled=false;
  }
}

async function mount(v){
  session=v;api=new TeamInventoryApi(v.token,()=>alertGlobal('Tu sesión necesita renovarse. Conserva esta pestaña y vuelve a iniciar sesión con el mismo gafete.'));
  const profile=await api.request('/api/me');
  if(profile.employee!==v.employee)throw Error('La sesión corresponde a otro empleado.');
  session.role=profile.role;session.name=profile.name;putSession(session);
  $('teamLoginSection').hidden=true;$('teamApp').hidden=false;
  $('teamGreeting').textContent=profile.name+' · '+profile.employee;
  $('teamRole').textContent={admin:'Administrador',scanner:'Escaneo',viewer:'Consulta'}[profile.role];
  $('teamPeopleSection').hidden=profile.role!=='admin';
  $('teamImportSection').hidden=profile.role!=='admin';
  $('teamScanSection').hidden=profile.role==='viewer';
  alertGlobal('');
  if(profile.role!=='viewer'){
    try{await navigator.storage?.persist?.();}catch{}
    const evidence=new LocalInventoryApi();
    queue=new ContinuousReceive({
      api,storage:localStorage,userId:v.employee,deptId:TEAM_DEPARTMENT,
      actor:'Empleado '+v.employee,online:()=>navigator.onLine!==false
    });
    unmount=mountContinuousReceive($('teamReceiveRoot'),queue,{
      startScanner,stopScanner,
      onLegacy:()=>alertGlobal('Usa el lector continuo; las recepciones por lote no están activadas en esta edición.'),
      onEvidence:(id,code,frame)=>{
        Promise.resolve(frame).then(blob=>blob?evidence.saveEvidence(id,blob):false)
          .then(saved=>queue?.markEvidence(id,saved?'local':'failed'))
          .catch(()=>queue?.markEvidence(id,'failed'));
      }
    });
    const notify=queue.onConfirmed;
    queue.onConfirmed=row=>{
      notify(row);
      if(queue.report().confirmed%20===0){void refreshSummary().catch(reportError);void refreshHistory().catch(reportError);}
    };
  }
  await Promise.all([refreshSummary(),refreshHistory(),...(profile.role==='admin'?[refreshPeople()]:[])]);
  refreshTimer=setInterval(()=>{
    if(document.visibilityState!=='visible'||!api)return;
    void refreshSummary().catch(reportError);
    void refreshHistory().catch(reportError);
    if($('teamSearch').value.trim())void search().catch(reportError);
  },20000);
}
$('teamLogin').addEventListener('submit',event=>{
  event.preventDefault();
  const employee=$('teamEmployee').value.trim(),pin=$('teamPin').value;
  $('teamLoginError').hidden=true;
  const button=$('teamLogin button');button.disabled=true;
  void openTeamSession(employee,pin).then(async v=>{
    putSession(v);
    await mount(v);
  }).catch(error=>{
    $('teamLoginError').textContent=error.message;
    $('teamLoginError').hidden=false;
  }).finally(()=>{button.disabled=false;$('teamPin').value='';});
});

$('teamSetupForm').addEventListener('submit',event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const b=Object.fromEntries(new FormData(form));
  const node=$('teamSetupStatus'),button=form.querySelector('button');
  node.textContent='Creando cuenta administradora segura…';button.disabled=true;
  void setupTeamAdmin(b).then(async()=>{
    node.textContent='Cuenta creada. Iniciando sesión…';
    const v=await openTeamSession(b.employee,b.pin);
    putSession(v);await mount(v);
    form.reset();
  }).catch(error=>node.textContent=error.message||String(error))
    .finally(()=>button.disabled=false);
});
$('teamLogout').addEventListener('click',()=>{
  if(importingLocal){
    alertGlobal('La importación aún está en curso. Conserva esta sesión hasta que termine o falle.');
    return;
  }
  if(queue?.pending){
    alertGlobal('Hay '+queue.pending+' lecturas sin confirmar. No cierres sesión hasta que todas se guarden.');
    return;
  }
  clearSession();
});
$('teamSearchForm').addEventListener('submit',event=>{event.preventDefault();void search().catch(reportError);});
$('teamSearch').addEventListener('input',()=>{
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>void search().catch(reportError),350);
});
$('teamResults').addEventListener('click',event=>{
  const b=event.target.closest('button[data-code]');
  if(!b||session.role!=='admin')return;
  const description=prompt('Descripción del SKU '+b.dataset.code,b.dataset.description);
  if(!description)return;
  void api.describe({code:b.dataset.code,description}).then(search).catch(reportError);
});
$('teamAddUser').addEventListener('submit',event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const b=Object.fromEntries(new FormData(form));
  $('teamPeopleStatus').textContent='Creando empleado…';
  void api.addPerson(b).then(async()=>{
    form.reset();$('teamPeopleStatus').textContent='Empleado creado. Entrega su PIN de forma privada.';
    await refreshPeople();
  }).catch(e=>$('teamPeopleStatus').textContent=e.message);
});
$('teamPeopleList').addEventListener('click',event=>{
  const b=event.target.closest('button[data-employee]');
  if(!b||session.role!=='admin')return;
  if(!confirm((b.dataset.active==='0'?'Suspender':'Reactivar')+' empleado '+b.dataset.employee+'?'))return;
  void api.updatePerson({employee:b.dataset.employee,role:b.dataset.role,active:b.dataset.active==='1'})
    .then(refreshPeople).catch(reportError);
});
async function start(){
  if(!teamConfigured()){$('teamUnavailable').hidden=false;return;}
  const saved=getSession();
  if(saved?.token&&saved?.employee){
    try{await mount(saved);return;}
    catch{sessionStorage.removeItem(SESSION_KEY);}
  }
  $('teamLoginSection').hidden=false;
}
void start();
