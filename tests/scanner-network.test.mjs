import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function scannerHarness() {
  const nodes=new Map(),callbacks={},calls=[];let detected=null,processed=null,stops=0,clock=0;
  const element=id=>({id,disabled:false,textContent:'',onclick:null,addEventListener(name,callback){callbacks[id+':'+name]=callback;},remove(){nodes.delete(id);}});
  const document={getElementById:id=>nodes.get(id)||null,body:{insertAdjacentHTML(where,html){for(const match of html.matchAll(/\bid="([^"]+)"/g))nodes.set(match[1],element(match[1]));}}};
  const Quagga={init(config,callback){callback();},onDetected(callback){detected=callback;},offDetected(){detected=null;},onProcessed(callback){processed=callback;},offProcessed(){processed=null;},start(){},stop(){stops++;},CameraAccess:{getActiveTrack(){return null;}}};
  const source=readFileSync(new URL('../scanner.js',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'').replace(/export /g,'');
  const sandbox={document,Quagga,navigator:{hardwareConcurrency:2},BarcodeFormat:{},DecodeHintType:{},Date:{now:()=>clock},Promise,console};
  vm.runInNewContext(source+'\nglobalThis.api={startScanner,stopScanner};',sandbox);
  const scan=code=>detected?.({codeResult:{code,decodedCodes:[{error:.1}]}});
  return {...sandbox.api,nodes,calls,scan,absent:()=>processed?.({}),advance:ms=>{clock+=ms;},target:{insertAdjacentHTML:document.body.insertAdjacentHTML},repeat:()=>callbacks['scanRepeat:click']?.(),get stops(){return stops;}};
}

test('continuous camera scans keep the camera open, suppress repeated frames, and explicitly count another identical piece',async()=>{
  const h=scannerHarness();await h.startScanner(code=>h.calls.push(code),'SKU',{continuous:true});
  for(let i=0;i<50;i++)h.scan('0012345678');
  assert.deepEqual(h.calls,['0012345678']);assert.equal(h.stops,0);assert.ok(h.nodes.has('scanner'));
  h.repeat();assert.deepEqual(h.calls,['0012345678','0012345678']);
  h.scan('0012345679');h.scan('0012345679');
  assert.deepEqual(h.calls,['0012345678','0012345678','0012345679']);
  h.stopScanner();assert.equal(h.stops,1);assert.equal(h.nodes.has('scanner'),false);
});
test('single-product scanning retains one-shot behavior and can reopen on the same barcode',async()=>{
  const h=scannerHarness();await h.startScanner(code=>h.calls.push(code));h.scan('0012345678');
  assert.equal(h.stops,1);assert.deepEqual(h.calls,['0012345678']);
  await h.startScanner(code=>h.calls.push(code));h.scan('0012345678');assert.equal(h.calls.length,2);
});
test('another identical item is accepted automatically after removing its barcode from the camera',async()=>{
  const h=scannerHarness();let closed=0;
  await h.startScanner(code=>h.calls.push(code),'SKU',{continuous:true,inlineTarget:h.target,onClose:()=>closed++});
  h.scan('0012345678');h.scan('0012345678');h.advance(300);h.absent();
  h.scan('0012345678');h.scan('0012345678');assert.equal(h.calls.length,1);
  h.advance(701);h.absent();h.scan('0012345678');h.scan('0012345678');
  assert.equal(h.calls.length,2);assert.equal(closed,0);h.stopScanner();h.stopScanner();assert.equal(closed,1);
});
test('movement gateway errors and lost responses are never automatically retried',async()=>{
  const source=readFileSync(new URL('../nova-network-guard.js',import.meta.url),'utf8');
  for(const mode of ['gateway','lost']){
    let calls=0;
    const window={fetch:async()=>{calls++;if(mode==='lost')throw Error('Failed to fetch');return new Response('{}',{status:503});}};
    vm.runInNewContext(source,{window,AbortController,DOMException,Request,Response,console:{error(){},warn(){}},setTimeout,clearTimeout});
    const response=await window.fetch('https://example.supabase.co/rest/v1/rpc/mover_stock_v2',{method:'POST',body:'{}'});
    assert.equal(calls,1);assert.equal(response.status,mode==='gateway'?503:504);
  }
});
