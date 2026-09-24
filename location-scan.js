import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { startScanner, stopScanner } from './scanner.js';

const sb=createClient('https://dkqovohxkxlcccvagpij.supabase.co','sb_publishable_iz06RtaObND0dWOpuX2vKg_wZVbrZCv',{auth:{persistSession:true,autoRefreshToken:true}});
const $=id=>document.getElementById(id);
const esc=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function dept(){return localStorage.getItem('inv.dept')||''}
function currentSku(){
  const text=document.querySelector('.product-head .tiny')?.textContent||'';
  return (text.match(/SKU\s+([^\s·]+)/i)||[])[1]||'';
}
function isSalida(){return /sacar de bodega/i.test(document.querySelector('.page-title h1')?.textContent||'')}
function setStatus(html,type='success'){
  const el=$('locationScanStatus');
  if(!el)return;
  el.className=type;
  el.innerHTML=html;
}
function addOption(m){
  const select=$('moveLocation');
  if(!select)return;
  let opt=[...select.options].find(x=>x.value===m.codigo);
  if(!opt){
    opt=new Option(`${m.codigo} · ${m.descripcion||m.zona||'Ubicación'}`,m.codigo);
    select.add(opt);
  }
  select.value=m.codigo;
  select.dispatchEvent(new Event('change',{bubbles:true}));
  setStatus(`✓ Marbete seleccionado · <b>${esc(m.zona||'UBICACIÓN')}</b> · ${esc(m.codigo)}${m.descripcion?`<br><span>${esc(m.descripcion)}</span>`:''}`,'success');
}
async function validateSalida(m){
  if(!isSalida())return true;
  const sku=currentSku();
  if(!sku)return true;
  const r=await sb.from('producto_marbetes').select('cantidad').eq('sku',sku).eq('marbete_codigo',m.codigo).maybeSingle();
  if(r.error){setStatus('No pude validar la ubicación. Intenta otra vez.','error');return false}
  if(!r.data||Number(r.data.cantidad||0)<=0){
    setStatus(`Ese producto no está registrado con existencia en el marbete <b>${esc(m.codigo)}</b>.`,'error');
    return false;
  }
  return true;
}
async function useMarbete(m){
  if(m.departamento_id&&m.departamento_id!==dept()){
    setStatus('Ese marbete pertenece a otro departamento.','error');
    return;
  }
  if(await validateSalida(m))addOption(m);
}
async function createMarbete(code,zona){
  setStatus('Registrando ubicación…','success');
  const r=await sb.from('marbetes').insert({codigo:code,zona,descripcion:null,activo:true,departamento_id:dept(),updated_at:new Date().toISOString()}).select('codigo,zona,descripcion,departamento_id,activo').single();
  if(r.error){
    setStatus(`El marbete <b>${esc(code)}</b> todavía no está dado de alta. Entra una vez como administrador para clasificarlo como PISO o BODEGA y después cualquier empleado podrá escanearlo.`,'error');
    return;
  }
  addOption(r.data);
  setStatus(`✓ Marbete nuevo registrado · <b>${esc(zona)}</b> · ${esc(code)}<br>Ya quedó seleccionado para este producto.`,'success');
}
function askZone(code){
  const el=$('locationScanStatus');
  if(!el)return;
  el.className='notice';
  el.innerHTML=`<b>Marbete nuevo: ${esc(code)}</b><br><span>¿Dónde está físicamente?</span><div class="quick-row" style="margin-top:10px"><button type="button" id="zoneBodega" class="secondary">BODEGA</button><button type="button" id="zonePiso" class="secondary">PISO</button></div>`;
  $('zoneBodega').onclick=()=>createMarbete(code,'BODEGA');
  $('zonePiso').onclick=()=>createMarbete(code,'PISO');
}
async function handleMarbete(raw){
  stopScanner();
  const code=String(raw||'').trim();
  if(!code)return;
  setStatus(`Buscando marbete ${esc(code)}…`,'success');
  const r=await sb.from('marbetes').select('codigo,zona,descripcion,departamento_id,activo').eq('codigo',code).eq('activo',true).maybeSingle();
  if(r.error){setStatus('No pude consultar el marbete. Intenta otra vez.','error');return}
  if(r.data)return useMarbete(r.data);
  if(isSalida()){
    setStatus(`El marbete <b>${esc(code)}</b> no está registrado. Para una salida primero debe existir como ubicación.`,'error');
    return;
  }
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
