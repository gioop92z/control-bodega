import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupPublicCatalog, publicSearchUrl } from '../catalog-hybrid.mjs';

const mem=new Map();
Object.defineProperty(globalThis,'localStorage',{value:{
  getItem:key=>mem.get(key)||null,
  setItem:(key,val)=>mem.set(key,String(val))
},configurable:true});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const clean=()=>mem.clear();

test('enlace oficial codifica identificadores sin inventar ficha',()=>{
  assert.equal(publicSearchUrl('1201101286'),'https://www.liverpool.com.mx/tienda?s=1201101286');
  assert.match(publicSearchUrl('A&B'),/A%26B/);
});
test('rechaza codigos malformados sin consultar red',async()=>{
  clean();globalThis.fetch=()=>{throw Error('No debe consultar');};
  assert.equal((await lookupPublicCatalog(['../password'])).status,'invalid_code');
});
test('sin conexion no bloquea y no inventa producto',async()=>{
  clean();navigator.onLine=false;
  const r=await lookupPublicCatalog(['1201101286']);
  assert.equal(r.status,'offline');navigator.onLine=true;
});
test('coincidencia publica validada guarda cache y omite segunda llamada',async()=>{
  clean();let count=0;
  globalThis.fetch=async()=>{count++;return {ok:true,json:async()=>({
    status:'verified',code:'1186795015',title:'Tenis Nike para niño',brand:'Nike',
    imageUrl:'https://ss251.liverpool.com.mx/sm/imagen.jpg',
    productUrl:'https://www.liverpool.com.mx/tienda/pdp/tenis-para-nino/1186795015'
  })}};
  const first=await lookupPublicCatalog(['1186795015']);
  const second=await lookupPublicCatalog(['1186795015']);
  assert.equal(first.status,'verified');assert.equal(second.status,'verified');
  assert.equal(count,1);
});
test('rechaza respuestas con identificadores diferentes',async()=>{
  clean();
  globalThis.fetch=async()=>({ok:true,json:async()=>({
    status:'verified',code:'0000000000',title:'Modelo incorrecto',
    imageUrl:'https://ss251.liverpool.com.mx/img.jpg',
    productUrl:'https://www.liverpool.com.mx/tienda/pdp/x/0000000000'})});
  assert.equal((await lookupPublicCatalog(['1234567890'])).status,'unavailable');
});
test('rechaza imagenes de dominios no confiables',async()=>{
  clean();
  globalThis.fetch=async()=>({ok:true,json:async()=>({
    status:'verified',code:'1234567890',title:'Otro',
    imageUrl:'https://example.org/tracker.png',
    productUrl:'https://www.liverpool.com.mx/tienda/pdp/x/1234567890'})});
  assert.equal((await lookupPublicCatalog(['1234567890'])).status,'unavailable');
});
