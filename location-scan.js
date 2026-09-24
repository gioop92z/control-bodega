import { startScanner, stopScanner } from './scanner.js';

const API='https://dkqovohxkxlcccvagpij.supabase.co/rest/v1';
const KEY='sb_publishable_iz06RtaObND0dWOpuX2vKg_wZVbrZCv';
const AUTH_KEY='sb-dkqovohxkxlcccvagpij-auth-token';
const $=id=>document.getElementById(id);
const esc=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function accessToken(){
  try{return JSON.parse(localStorage.getItem(AUTH_KEY)||'null')?.access_token||''}catch{return ''}
}
function requestHeaders(extra={}){
  const token=accessToken();
  return {'apikey':KEY,'Content-Type':'application/json',...(token?{'Authorization':`Bearer ${token}`}:{}) ,...extra};
}
async function rest(path,{method='GET',body,prefer}={}){
  try{
    const headers=requestHeaders(prefer?{'Prefer':prefer}:{});
    const response=await fetch(`${API}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();
    let data=null;
    try{data=text?JSON.parse(text):null}catch{data=text}
    if(!response.ok) return {data:null,error:{message:data?.message||text||`HTTP ${response.status}`,status:response.status}};
    return {data,error:null};
  }catch(error){return {data:null,error}}
}
function eq(v){return encodeURIComponent(String(v??''))}
function dept(){return localStorage.getItem('inv.dept')||''}
function currentSku(){const text=document.querySelector('.product-head .tiny')?.textContent||'';return(text.match(/SKU\s+([^\s·]+)/i)||[])[1]||''}
function isSalida(){return /sacar de bodega/i.test(document.querySelector('.page-title h1')?.textContent||'')}
function setStatus(html,type='success'){const el=$('locationScanStatus');if(!el)return;el.className=type;el.innerHTML=html}
function addOption(m){const select=$('moveLocation');if(!select)return;let opt=[...select.options].find(x=>x.value===m.codigo);if(!opt){opt=new Option(`${m.codigo} · ${m.descripcion||m.zona||'Ubicación'}`,m.codigo);select.add(opt)}select.value=m.codigo;select.dispatchEvent(new Event('change',{bubbles:true}));setStatus(`✓ Marbete seleccionado · <b>${esc(m.zona||'UBICACIÓN')}</b> · ${esc(m.codigo)}${m.descripcion?`<br><span>${esc(m.descripcion)}</span>`:''}`,'success')}

async function validateSalida(m){
  if(!isSalida())return true;
  const sku=currentSku();
  if(!sku)return true;
  const r=await rest(`/producto_marbetes?select=cantidad&sku=eq.${eq(sku)}&marbete_codigo=eq.${eq(m.codigo)}&limit=1`);
  if(r.error){setStatus('No pude validar la ubicación. Intenta otra vez.','error');return false}
  const row=Array.isArray(r.data)?r.data[0]:null;
  if(!row||Number(row.cantidad||0)<=0){setStatus(`Ese producto no está registrado con existencia en el marbete <b>${esc(m.codigo)}</b>.`,'error');return false}
  return true;
}
async function useMarbete(m){if(m.departamento_id&&m.departamento_id!==dept()){setStatus('Ese marbete pertenece a otro departamento.','error');return}if(await validateSalida(m))addOption(m)}
async function createMarbete(code,zona){
  setStatus('Registrando ubicación…','success');
  const r=await rest('/marbetes?select=codigo,zona,descripcion,departamento_id,activo',{method:'POST',prefer:'return=representation',body:{codigo:code,zona,descripcion:null,activo:true,departamento_id:dept(),updated_at:new Date().toISOString()}});
  const row=Array.isArray(r.data)?r.data[0]:r.data;
  if(r.error||!row){setStatus(`El marbete <b>${esc(code)}</b> todavía no está dado de alta. Entra como administrador para clasificarlo como PISO o BODEGA y después cualquier vendedor podrá escanearlo.`,'error');return}
  addOption(row);
  setStatus(`✓ Marbete nuevo registrado · <b>${esc(zona)}</b> · ${esc(code)}<br>Ya quedó seleccionado para este producto.`,'success');
}
function askZone(code){const el=$('locationScanStatus');if(!el)return;el.className='notice';el.innerHTML=`<b>Marbete nuevo: ${esc(code)}</b><br><span>¿Dónde está físicamente?</span><div class="quick-row" style="margin-top:10px"><button type="button" id="zoneBodega" class="secondary">BODEGA</button><button type="button" id="zonePiso" class="secondary">PISO</button></div>`;$('zoneBodega').onclick=()=>createMarbete(code,'BODEGA');$('zonePiso').onclick=()=>createMarbete(code,'PISO')}
async function handleMarbete(raw){
  stopScanner();
  const code=String(raw||'').trim();
  if(!code)return;
  setStatus(`Buscando marbete ${esc(code)}…`,'success');
  const r=await rest(`/marbetes?select=codigo,zona,descripcion,departamento_id,activo&codigo=eq.${eq(code)}&activo=eq.true&limit=1`);
  if(r.error){setStatus('No pude consultar el marbete. Intenta otra vez.','error');return}
  const row=Array.isArray(r.data)?r.data[0]:null;
  if(row)return useMarbete(row);
  if(isSalida()){setStatus(`El marbete <b>${esc(code)}</b> no está registrado. Para una salida primero debe existir como ubicación.`,'error');return}
  askZone(code);
}
function inject(){
  const select=$('moveLocation');
  if(!select||$('locationScanWrap'))return;
  const wrap=document.createElement('div');
  wrap.id='locationScanWrap';
  wrap.innerHTML=`<div style="margin-top:10px"><button type="button" id="scanLocation" class="scan-btn" style="margin:0">📍 Escanear marbete de ubicación</button><form id="manualLocation" class="inline-form" style="margin-top:8px"><input id="manualLocationCode" autocomplete="off" placeholder="O escribe el marbete"><button class="secondary">Usar</button></form><div id="locationScanStatus" style="margin-top:8px"></div><p class="tiny muted">Escanea el marbete de la caja, cajón, mueble o rack donde quedará la mercancía.</p></div>`;
  select.insertAdjacentElement('afterend',wrap);
  $('scanLocation').onclick=()=>startScanner(handleMarbete,'marbete de ubicación').catch(()=>setStatus('No se pudo abrir la cámara. Revisa el permiso del navegador.','error'));
  $('manualLocation').onsubmit=e=>{e.preventDefault();handleMarbete($('manualLocationCode').value)};
}
new MutationObserver(inject).observe(document.documentElement,{childList:true,subtree:true});
inject();
