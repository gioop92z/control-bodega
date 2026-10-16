import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as locationFunctions from '../product-location.mjs';
import {locationDb} from './helpers/location-db.mjs';

// Exercise the actual app handlers with a minimal DOM. No browser or camera is
// simulated: scanner callbacks are supplied explicitly, as with a USB reader.
function harness(overrides={}) {
  const {sb,db}=locationDb(overrides);
  const nodes=new Map();
  class Element {
    constructor(id=''){this.id=id;this.handlers={};this.childIds=[];this.value='';this.hidden=false;this.disabled=false}
    set innerHTML(value){
      if(this.id==='app'){nodes.clear();nodes.set('app',this)}
      else for(const id of this.childIds)nodes.delete(id);
      this.childIds=[];this.html=value;
      for(const tag of value.matchAll(/<[a-z][^>]*\bid="([^"]+)"[^>]*>/gi)){
        const el=new Element(tag[1]);el.value=(tag[0].match(/\bvalue="([^"]*)"/)||[])[1]||'';
        el.hidden=/\shidden[\s>]/.test(tag[0]);el.disabled=/\sdisabled[\s>]/.test(tag[0]);
        nodes.set(el.id,el);this.childIds.push(el.id);
      }
    }
    get innerHTML(){return this.html||''}
    addEventListener(event,handler){(this.handlers[event]??=[]).push(handler)}
    appendChild(el){nodes.set(el.id,el)}
    remove(){nodes.delete(this.id)}
    focus(){this.focused=true}
    click(){if(this.disabled)return;const e={preventDefault(){},target:this};this.onclick?.(e);for(const h of this.handlers.click||[])h(e)}
  }
  const app=new Element('app');nodes.set('app',app);
  const scanner={calls:0,callback:null,error:null};
  const sandbox={
    ...locationFunctions,createClient:()=>sb,console,AbortController,crypto,
    navigator:{onLine:true,vibrate(){}},localStorage:{getItem(){return null},setItem(){},removeItem(){}},
    document:{getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[],createElement:()=>new Element(),body:new Element()},
    window:{},startScanner:async callback=>{scanner.calls++;if(scanner.error)throw scanner.error;scanner.callback=callback},stopScanner:()=>{scanner.callback=null},
    setTimeout:(callback,ms)=>setTimeout(callback,ms).unref(),clearTimeout
  };
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'').replace(/\nboot\(\);\s*$/,'');
  vm.runInNewContext(source+`\nglobalThis.api={S,doSearch,render,openProductLocation,validateProductMarbete,saveProductLocation,registerProductLocationMarbete,resetSearchContext,get assignment(){return locationAssignment}};`,sandbox);
  const api=sandbox.api;
  Object.assign(api.S,{user:{id:'user'},admin:true,depts:[{id:'dept1',nombre:'Zapatería'}],deptId:'dept1',view:'search'});
  return {api,db,nodes,scanner,sandbox,app};
}

test('unlocated search exposes the prominent action and opens the scanner',async()=>{
  const h=harness();await h.api.doSearch('0012345678');
  assert.match(h.app.innerHTML,/Darle ubicación/);
  assert.equal(h.nodes.get('giveProductLocation').disabled,false);
  h.api.openProductLocation();
  h.api.openProductLocation();
  assert.equal(h.scanner.calls,1);
  assert.equal(h.api.assignment.sku,'0012345678');
  assert.equal(h.nodes.get('productLocationPanel').hidden,false);
});

test('validated confirmation saves once despite a double tap and updates the result',async()=>{
  const h=harness();await h.api.doSearch('0012345678');h.api.openProductLocation();
  const a=h.api.assignment;
  await h.api.validateProductMarbete(a,'459-001');
  assert.ok(h.nodes.get('confirmProductLocation'));
  await Promise.all([h.api.saveProductLocation(a),h.api.saveProductLocation(a)]);
  assert.equal(h.db.assignments.length,1);
  assert.equal(h.db.products[0].stock,2);
  assert.match(h.app.innerHTML,/Ubicación guardada:/);
  assert.match(h.app.innerHTML,/Agregar otra ubicación/);
});

test('a location read failure never shows a false unlocated state or assignment action',async()=>{
  const h=harness({readError:{table:'producto_marbetes',message:'Network failed'}});
  await h.api.doSearch('0012345678');
  assert.equal(h.api.S.searchResult,null);
  assert.doesNotMatch(h.app.innerHTML,/Darle ubicación|Sin ubicación asignada/);
  assert.equal(h.db.assignments.length,0);
});

test('the product barcode cannot be registered accidentally as a furniture label',async()=>{
  const h=harness();await h.api.doSearch('0012345678');h.api.openProductLocation();
  await h.api.validateProductMarbete(h.api.assignment,'2000000000001');
  assert.match(h.api.assignment.error,/código del artículo/);
  assert.equal(h.api.assignment.missing,false);
  assert.equal(h.nodes.has('registerProductMarbete'),false);
});

test('a wrong department barcode cannot reach confirmation',async()=>{
  const h=harness({marbetes:[{codigo:'459-001',zona:'BODEGA',departamento_id:'dept2',activo:true}]});
  await h.api.doSearch('0012345678');h.api.openProductLocation();
  await h.api.validateProductMarbete(h.api.assignment,'459-001');
  assert.match(h.api.assignment.error,/otro departamento/);
  assert.equal(h.nodes.has('confirmProductLocation'),false);
});

test('manual entry remains available after camera permission failure',async()=>{
  const h=harness();h.scanner.error=Error('camera denied');
  await h.api.doSearch('0012345678');h.api.openProductLocation();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(h.api.assignment.error,/escribe el código/);
  assert.equal(h.nodes.get('productMarbeteCode').disabled,false);
});

test('offline confirmation preserves the form and does not write',async()=>{
  const h=harness();await h.api.doSearch('0012345678');h.api.openProductLocation();
  const a=h.api.assignment;await h.api.validateProductMarbete(a,'459-001');
  h.sandbox.navigator.onLine=false;
  await h.api.saveProductLocation(a);
  assert.match(a.error,/Necesitas conexión/);
  assert.equal(h.db.assignments.length,0);
  assert.equal(h.api.assignment,a);
});

test('a late barcode response is ignored after changing department',async()=>{
  const h=harness();await h.api.doSearch('0012345678');h.api.openProductLocation();
  const a=h.api.assignment,pending=h.api.validateProductMarbete(a,'459-001');
  h.api.resetSearchContext();h.api.S.deptId='dept2';
  await pending;
  await h.api.saveProductLocation(a);
  assert.equal(h.db.assignments.length,0);
  assert.equal(h.api.assignment,null);
});

test('the latest search wins when requests overlap',async()=>{
  const h=harness();h.db.products.push({...h.db.products[0],id:'p2',sku:'0099999999',upc:'2000000000002'});
  await Promise.all([h.api.doSearch('0012345678'),h.api.doSearch('0099999999')]);
  assert.equal(h.api.S.searchResult.id,'p2');
  assert.match(h.app.innerHTML,/0099999999/);
});

test('administrator can register an unknown label without leaving the product',async()=>{
  const h=harness();await h.api.doSearch('0012345678');h.api.openProductLocation();
  const a=h.api.assignment;await h.api.validateProductMarbete(a,'405-010');
  assert.ok(h.nodes.get('registerProductMarbete'));
  await h.api.registerProductLocationMarbete(a,'BODEGA');
  assert.equal(a.candidate.codigo,'405-010');
  assert.equal(h.db.assignments.length,0);
  await h.api.saveProductLocation(a);
  assert.equal(h.db.assignments[0].marbete_codigo,'405-010');
});

test('seller can assign a registered label but cannot register a new one in this flow',async()=>{
  const h=harness();h.api.S.admin=false;
  await h.api.doSearch('0012345678');h.api.openProductLocation();
  const a=h.api.assignment;await h.api.validateProductMarbete(a,'405-010');
  assert.equal(h.nodes.has('registerProductMarbete'),false);
  await h.api.validateProductMarbete(a,'459-001');
  await h.api.saveProductLocation(a);
  assert.equal(h.db.assignments.length,1);
});

test('a new QR location is registered by decoded label ID, not its URL',async()=>{
  const h=harness();
  await h.api.doSearch('0012345678');h.api.openProductLocation();
  const a=h.api.assignment;
  const qr='https://inventory.example/marbete?codigo=ZAP-402-001';
  await h.api.validateProductMarbete(a,qr);
  assert.equal(a.code,'ZAP-402-001');
  assert.equal(a.missing,true);
  assert.ok(h.nodes.get('registerProductMarbete'));
  await h.api.registerProductLocationMarbete(a,'BODEGA');
  assert.equal(a.candidate.codigo,'ZAP-402-001');
  await h.api.saveProductLocation(a);
  assert.equal(h.db.marbetes.filter(x=>x.codigo==='ZAP-402-001').length,1);
  assert.equal(h.db.assignments[0].marbete_codigo,'ZAP-402-001');
});
