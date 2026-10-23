import {test} from 'node:test';
import assert from 'node:assert/strict';
import {liverpoolPreview} from '../catalog-visual.mjs';

function setup(validUrl){
  const memory=new Map();
  Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
  globalThis.localStorage={
    getItem:key=>memory.get(key)||null,
    setItem:(key,value)=>memory.set(key,String(value))
  };
  const calls=[];
  globalThis.Image=class {
    naturalWidth=560;
    naturalHeight=430;
    set src(url){
      calls.push(url);
      queueMicrotask(()=>url===validUrl?this.onload?.():this.onerror?.());
    }
  };
  return calls;
}
test('uses exact SKU from Liverpool CDN without needing the remote catalog search',async()=>{
  const expected='https://ss550.liverpool.com.mx/xl/1191087930.jpg';
  const calls=setup(expected);
  const photo=await liverpoolPreview(['1191087930','198961636205']);
  assert.equal(photo.status,'preview');
  assert.equal(photo.imageUrl,expected);
  assert.equal(photo.code,'1191087930');
  const again=await liverpoolPreview(['1191087930']);
  assert.equal(again.imageUrl,expected);
  assert.equal(calls.length,2);
});
test('no false photo when CDN cannot provide image',async()=>{
  const calls=setup('NEVER');
  const photo=await liverpoolPreview(['1191087930']);
  assert.equal(photo,null);
  assert.equal(calls.length,4);
});
test('blocks malformed codes and cannot interpolate arbitrary CDN URLs',async()=>{
  const calls=setup('NEVER');
  assert.equal(await liverpoolPreview(['../admin','https://example.com/bad']),null);
  assert.equal(calls.length,0);
});
