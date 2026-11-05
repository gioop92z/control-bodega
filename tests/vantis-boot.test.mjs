import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../vantis-boot.js',import.meta.url),'utf8');
const introKey='vantis.cinema.introShown.v1';

function renderDocument(store,{reduceMotion=false,brokenStorage=false}={}){
  let shown=0,skipped=false,removed=false;
  const overlay={
    id:'vantisCinema',
    className:'',innerHTML:'',
    setAttribute(){},
    classList:{add(){}},
    querySelector(selector){
      if(selector==='canvas')return {getContext:()=>({setTransform(){}})};
      if(selector==='button')return {addEventListener(_type,callback){overlay.skip=callback}};
      return null;
    },
    remove(){removed=true}
  };
  const document={
    readyState:'complete',
    createElement(){return overlay},
    body:{appendChild(){shown++}},
    getElementById(id){
      if(id==='app')return {};
      if(id==='vantisCinema')return shown&&!removed?overlay:null;
      return null;
    }
  };
  const sessionStorage=brokenStorage?{
    getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}
  }:{
    getItem:key=>store.get(key)||null,
    setItem:(key,value)=>store.set(key,String(value))
  };
  const window={
    matchMedia:()=>({matches:reduceMotion}),
    addEventListener(){},removeEventListener(){}
  };
  const sandbox={
    document,window,sessionStorage,performance:{now:()=>100},setTimeout:()=>1,
    requestAnimationFrame:()=>1,cancelAnimationFrame(){},
    devicePixelRatio:1,innerWidth:390,innerHeight:844
  };
  vm.runInNewContext(source,sandbox);
  return {get shown(){return shown},get skipped(){return skipped},skip(){overlay.skip();skipped=true},get removed(){return removed}};
}

test('plays exactly once despite login-triggered page reloads',()=>{
  const store=new Map();
  const opening=renderDocument(store);
  assert.equal(opening.shown,1);
  assert.equal(store.get(introKey),'1');
  assert.equal(renderDocument(store).shown,0,'login reload should not replay');
  assert.equal(renderDocument(store).shown,0,'department/logout reload should not replay');
});

test('a genuinely new app/browser session plays its own opening',()=>{
  assert.equal(renderDocument(new Map()).shown,1);
  assert.equal(renderDocument(new Map()).shown,1);
});

test('skipping the intro still counts as the single play for this session',()=>{
  const store=new Map(),opening=renderDocument(store);
  opening.skip();
  assert.equal(opening.skipped,true);
  assert.equal(renderDocument(store).shown,0);
});

test('reduced-motion setting avoids opening entirely',()=>{
  const store=new Map();
  assert.equal(renderDocument(store,{reduceMotion:true}).shown,0);
  assert.equal(store.has(introKey),false);
});

test('unavailable sessionStorage does not crash the opening sequence',()=>{
  assert.equal(renderDocument(new Map(),{brokenStorage:true}).shown,1);
});
