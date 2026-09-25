const NOVA_DANGER_VERSION='3.7.1';
const PROJECT='dkqovohxkxlcccvagpij';
const BASE=`https://${PROJECT}.supabase.co/rest/v1`;
const KEY='sb_publishable_iz06RtaObND0dWOpuX2vKg_wZVbrZCv';

function session(){
  try{
    const raw=localStorage.getItem(`sb-${PROJECT}-auth-token`);
    if(!raw)return null;
    const x=JSON.parse(raw);
    return x?.access_token?x:(x?.currentSession||x?.session||null);
  }catch{return null;}
}
function jwtEmail(token){
  try{return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))?.email||''}catch{return ''}
}
function admin(){const s=session();return !!s?.access_token&&jwtEmail(s.access_token).toLowerCase()==='99@bodega.local'}
function h(extra={}){const s=session();if(!s?.access_token)throw Error('Tu sesión expiró. Vuelve a entrar.');return{apikey:KEY,Authorization:`Bearer ${s.access_token}`,...extra}}
async function req(path,opts={}){const r=await fetch(`${BASE}/${path}`,{...opts,headers:h(opts.headers||{})});const text=await r.text();if(!r.ok){let m=text;try{const j=JSON.parse(text);m=j.message||j.details||j.hint||text}catch{}throw Error(m||`Error ${r.status}`)}return r}
async function count(table,filter){const r=await req(`${table}?select=*&${filter}&limit=1`,{headers:{Prefer:'count=exact',Range:'0-0'}});const n=Number((r.headers.get('content-range')||'0/0').split('/')[1]);return Number.isFinite(n)?n:0}
async function erase(table,filter){await req(`${table}?${filter}`,{method:'DELETE',headers:{Prefer:'return=minimal'}})}
function phrase(action,name){return `${action} ${name}`}
async function confirmAction(kind,id,name){
  if(!admin())return alert('Esta acción solo está disponible para el administrador 99.');
  const filter=`departamento_id=eq.${encodeURIComponent(id)}`;
  let products=0,moves=0,locations=0,counts=0;
  try{[products,moves,locations,counts]=await Promise.all([count('productos',filter),count('movimientos',filter),count('marbetes',filter),count('conteos',filter)])}catch(e){return alert(`Nova no pudo revisar el departamento: ${e.message}`)}
  const removeDept=kind==='department';
  const action=removeDept?'ELIMINAR':'BORRAR';
  const required=phrase(action,name);
  const summary=removeDept
    ?`Se eliminará DEFINITIVAMENTE el departamento “${name}”.\n\nProductos: ${products}\nMovimientos: ${moves}\nUbicaciones: ${locations}\nConteos: ${counts}\n\nNova limpiará primero los movimientos vinculados para respetar las relaciones de Supabase.`
    :`Se borrará DEFINITIVAMENTE el catálogo e inventario de “${name}”.\n\nProductos: ${products}\nMovimientos relacionados: ${moves}\nConteos: ${counts}\n\nEl departamento se conservará.`;
  if(!confirm(summary+'\n\nEsta acción no se puede deshacer. ¿Continuar?'))return;
  const typed=prompt(`Escribe exactamente:\n${required}`,'');
  if(typed!==required)return alert('Confirmación incorrecta. No se borró nada.');
  try{
    await erase('movimientos',filter);
    if(removeDept){
      await erase('productos',filter);
      await erase('departamentos',`id=eq.${encodeURIComponent(id)}`);
      const left=await count('departamentos',`id=eq.${encodeURIComponent(id)}`);
      if(left!==0)throw Error('La base de datos bloqueó el borrado. No se eliminó el departamento.');
    }else{
      await erase('productos',filter);
      const left=await count('productos',filter);
      if(left!==0)throw Error('La base de datos bloqueó el borrado del catálogo. No se eliminaron los productos.');
    }
    alert(removeDept?'Departamento eliminado definitivamente.':'Catálogo e inventario eliminados. Ya puedes importar uno nuevo.');
    location.reload();
  }catch(e){alert(`Nova detuvo la operación: ${e.message}`)}
}
function decorate(){
  if(!admin())return;
  document.querySelectorAll('#adminBody .product-row').forEach(row=>{
    if(row.dataset.novaDanger==='1')return;
    const toggle=row.querySelector('[data-toggle-dept]');
    const id=toggle?.dataset.toggleDept;
    const name=row.querySelector('b')?.textContent?.trim();
    if(!id||!name)return;
    row.dataset.novaDanger='1';
    const box=document.createElement('div');box.className='nova-danger-actions';
    const clear=document.createElement('button');clear.type='button';clear.className='nova-delete-catalog';clear.textContent='Borrar catálogo';clear.onclick=()=>confirmAction('catalog',id,name);
    const del=document.createElement('button');del.type='button';del.className='nova-delete-dept';del.textContent='Eliminar departamento';del.onclick=()=>confirmAction('department',id,name);
    if(toggle){toggle.parentNode?.insertBefore(box,toggle);box.append(toggle)}else row.append(box);
    box.append(clear,del);
  });
}
const css=document.createElement('style');css.textContent=`.nova-danger-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.nova-delete-catalog,.nova-delete-dept{border-radius:10px;padding:8px 10px;font-weight:800;font-size:12px;cursor:pointer}.nova-delete-catalog{background:#fff;color:#b42318;border:1px solid #d84a3f}.nova-delete-dept{background:#b42318;color:#fff;border:1px solid #b42318}@media(max-width:650px){.nova-danger-actions{width:100%;justify-content:stretch}.nova-danger-actions button{flex:1}}`;document.head.append(css);
new MutationObserver(decorate).observe(document.documentElement,{childList:true,subtree:true});
setTimeout(decorate,350);
console.info(`Nova Danger Zone ${NOVA_DANGER_VERSION} activa`);
