import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseLiverpoolFamilyUrl,lookupLiverpoolFamily} from '../catalog-hybrid.mjs';

test('acepta solo una ficha PDP del dominio oficial Liverpool',()=>{
 const valid='https://www.liverpool.com.mx/tienda/pdp/zapato-mary-jane-elefante-mila-de-piel-para-ni%C3%B1a/1180031226?skuid=1180031266';
 const p=parseLiverpoolFamilyUrl(valid);
 assert.equal(p.familyCode,'1180031226');
 assert.match(p.url,/\/1180031226$/);
 assert.equal(parseLiverpoolFamilyUrl('https://example.com/tienda/pdp/x/1180031226'),null);
 assert.equal(parseLiverpoolFamilyUrl('1180031226'),null);
 assert.equal(parseLiverpoolFamilyUrl('https://www.liverpool.com.mx/tienda/home'),null);
});
test('obtiene metadatos del modelo sin adjudicar talla ni modificar stock',async()=>{
 Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
 let calls=0;
 globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>({
   code:'1180031266',status:'family',liverpoolCode:'1180031226',
   title:'Zapato Mary Jane Mila de piel para niña',brand:'ELEFANTE',sizeVerified:false,
   imageUrl:'https://ss405.liverpool.com.mx/xl/1180031226.jpg',
   productUrl:'https://www.liverpool.com.mx/tienda/pdp/zapato-mary-jane-elefante-mila-de-piel-para-ni%C3%B1a/1180031226'
 })};};
 const data=await lookupLiverpoolFamily('1180031266','https://www.liverpool.com.mx/tienda/pdp/zapato-mary-jane-elefante-mila-de-piel-para-ni%C3%B1a/1180031226');
 assert.equal(data.status,'family');
 assert.equal(data.code,'1180031266');
 assert.equal(data.liverpoolCode,'1180031226');
 assert.equal(data.sizeVerified,false);
 assert.equal(calls,1);
});
test('bloquea una familia con codigo de respuesta diferente',async()=>{
 Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
 globalThis.fetch=async()=>({ok:true,json:async()=>({code:'1234567890',status:'family',productUrl:'https://www.liverpool.com.mx/tienda/pdp/zapato/1180031226'})});
 const r=await lookupLiverpoolFamily('1180031266','https://www.liverpool.com.mx/tienda/pdp/zapato/1180031226');
 assert.equal(r.status,'unavailable');
});
