import test from 'node:test';
import assert from 'node:assert/strict';
import {recordRunProduct,runMembers,modelName,imageFingerprint,fetchRunInventory,nearbyRunSuggestions} from '../catalog-runs.mjs';
const db=new Map();
globalThis.localStorage={getItem:k=>db.get(k)||null,setItem:(k,v)=>db.set(k,String(v))};
const family={status:'candidate',liverpoolCode:'1180031226',
  title:'Zapato Mary Jane Mila de piel para niña',brand:'ELEFANTE',
  imageUrl:'https://ss405.liverpool.com.mx/xl/1180031226.jpg',
  productUrl:'https://www.liverpool.com.mx/tienda/pdp/zapato-mary-jane-mila/1180031226'};
test('runs: six sizes create one suggested group with unchanged variant codes',()=>{
 db.clear();
 for(let i=0;i<6;i++)recordRunProduct('dept',{sku:'118003126'+i,talla:(17+i)+' CM',
   color:'NEGRO',marca:'ELEFANTE',descripcion:'Zapato Mary Jane Mila de piel para niña '+(17+i)+' cm'},family);
 const group=runMembers('dept','1180031260');
 assert.equal(group.ref.familyCode,'1180031226');
 assert.equal(group.probable.length,5);
 assert.deepEqual(group.probable.map(r=>r.talla),['18 CM','19 CM','20 CM','21 CM','22 CM']);
 assert.equal(group.confirmed.length,0);
});
test('run uses authoritative family matches when supported, not image alone',()=>{
 db.clear();
 for(let i=0;i<3;i++)recordRunProduct('dept',{sku:'118003126'+i,talla:(17+i)+' CM',
   color:'NEGRO',marca:'ELEFANTE',descripcion:'Mary Jane Mila talla '+(17+i)},
   {...family,status:'operator_confirmed'});
 assert.equal(runMembers('dept','1180031260').confirmed.length,2);
});
test('same image can only suggest and cannot merge a different known color or brand',()=>{
 db.clear();
 const p={sku:'1180031260',marca:'ELEFANTE',color:'NEGRO',talla:'17 CM',descripcion:'Tenis Niño Modelo Z 17 CM'};
 const q={sku:'1180031261',marca:'ELEFANTE',color:'NEGRO',talla:'18 CM',descripcion:'Tenis Niño Modelo Z 18 CM'};
 const blue={sku:'1180031262',marca:'ELEFANTE',color:'AZUL',talla:'19 CM',descripcion:'Tenis Niño Modelo Z 19 CM'};
 const other={sku:'1180031263',marca:'OTRA MARCA',color:'NEGRO',talla:'20 CM',descripcion:'Tenis Niño Modelo Z 20 CM'};
 const a={...family,status:'candidate',liverpoolCode:'1111111111'};
 const b={...family,status:'candidate',liverpoolCode:'2222222222'};
 recordRunProduct('dept',p,a);recordRunProduct('dept',q,b);
 recordRunProduct('dept',blue,b);recordRunProduct('dept',other,b);
 const group=runMembers('dept',p.sku);
 assert.deepEqual(group.probable.map(r=>r.sku),[q.sku]);
 assert.equal(group.confirmed.length,0);
});
test('run fingerprints images by filename without confusing different pictures',()=>{
 assert.equal(imageFingerprint('https://ss405.liverpool.com.mx/xl/1180031226.jpg'),'1180031226.jpg');
 assert.equal(imageFingerprint('https://ss237.liverpool.com.mx/lg/1180031226.jpg'),'1180031226.jpg');
 assert.notEqual(imageFingerprint('https://ss405.liverpool.com.mx/xl/1180031226.jpg'),imageFingerprint('https://ss405.liverpool.com.mx/xl/1180031227.jpg'));
 assert.equal(imageFingerprint('https://other-domain.example/a/1180031226.jpg'),'');
});
test('inventory query displays only real server quantities',async()=>{
 let calls=0;
 const sb={from(table){assert.equal(table,'productos');return{
  select(){return this;},eq(){return this;},in(_col,values){calls++;return Promise.resolve({data:values.map(sku=>({sku,stock:2,talla:'19 CM'})),error:null});}
 };}};
 const actual=await fetchRunInventory(sb,'dept',['1180031260','1180031261']);
 assert.equal(actual.rows.length,2);assert.equal(calls,1);
 assert.equal(actual.rows[0].stock,2);
});
test('nearby matches use model text but never claim proven family',async()=>{
 const sample=[
 {sku:'1180031261',descripcion:'Zapato Elefante 18 CM Negro',marca:'ELEFANTE',color:'NEGRO'},
 {sku:'1180031262',descripcion:'Zapato Elefante 19 CM Blanco',marca:'ELEFANTE',color:'BLANCO'},
 {sku:'1180031263',descripcion:'Otro Zapato 20 CM Negro',marca:'ELEFANTE',color:'NEGRO'}
 ];
 const sb={from(){return {select(){return this;},eq(){return this;},ilike(){return this;},limit:async()=>({data:sample,error:null})}}};
 const result=await nearbyRunSuggestions(sb,'dept',{sku:'1180031260',descripcion:'Zapato Elefante 17 CM Negro',marca:'ELEFANTE',color:'NEGRO'});
 assert.deepEqual(result.map(x=>x.sku),['1180031261']);
 assert.equal(modelName('Zapato Elefante 17 CM Negro'),modelName('Zapato Elefante 18 CM Negro'));
});

test('identical Liverpool photo suggests a run even when product family is not published',()=>{
 db.clear();
 const url='https://ss405.liverpool.com.mx/xl/1180031226.jpg';
 const p={sku:'1111111111',descripcion:'Producto nuevo 1111111111',color:'NEGRO'};
 const q={sku:'1111111112',descripcion:'Producto nuevo 1111111112',color:'NEGRO'};
 recordRunProduct('dept',p,{status:'preview',imageUrl:url});
 recordRunProduct('dept',q,{status:'preview',imageUrl:url});
 const grouped=runMembers('dept',p.sku);
 assert.deepEqual(grouped.probable.map(x=>x.sku),[q.sku]);
 assert.equal(grouped.confirmed.length,0);
 assert.equal(grouped.ref.familyCode,undefined);
});
test('an unrelated photo does not override a verified family',()=>{
 db.clear();
 const p={sku:'1111111111',descripcion:'Tenis Elefante 17 CM',marca:'ELEFANTE',color:'NEGRO'};
 recordRunProduct('dept',p,{...family,status:'verified'});
 recordRunProduct('dept',p,{status:'preview',imageUrl:'https://ss405.liverpool.com.mx/xl/9999999999.jpg'});
 assert.equal(runMembers('dept',p.sku).ref.familyCode,'1180031226');
 assert.equal(runMembers('dept',p.sku).ref.imageUrl,family.imageUrl);
});
