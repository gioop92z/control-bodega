import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function scannerHarness({zxingFails=false}={}) {
  const nodes=new Map(),callbacks={},calls=[];
  let zxingCallback=null,quaggaDetected=null,quaggaProcessed=null;
  let zxingStops=0,quaggaStops=0,clock=0,engine='',lastHints=null, scheduled=0;
  const element=id=>({
    id,disabled:false,textContent:'',onclick:null,
    addEventListener(name,callback){callbacks[id+':'+name]=callback;},
    remove(){nodes.delete(id);}
  });
  const document={
    getElementById:id=>nodes.get(id)||null,
    body:{insertAdjacentHTML(where,html){
      for(const match of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(match[1],element(match[1]));
    }}
  };
  const Quagga={
    init(config,cb){engine='quagga';cb();},
    onDetected(cb){quaggaDetected=cb;},offDetected(){quaggaDetected=null;},
    onProcessed(cb){quaggaProcessed=cb;},offProcessed(){quaggaProcessed=null;},
    start(){},stop(){quaggaStops++;},CameraAccess:{getActiveTrack(){return null;}}
  };
  class BrowserMultiFormatReader {
    constructor(hints,options) {this.hints=hints;this.options=options;lastHints=hints;}
    async decodeFromConstraints(constraints,id,cb){
      if(zxingFails) throw Error('ZXing unavailable');
      engine='zxing';zxingCallback=cb;
      return {stop(){zxingStops++;zxingCallback=null;}};
    }
  }
  const enums={
    CODE_128:1,CODE_39:2,CODE_93:3,EAN_13:4,EAN_8:5,
    UPC_A:6,UPC_E:7,ITF:8,CODABAR:9,RSS_14:10,QR_CODE:11
  };
  const hintEnums={POSSIBLE_FORMATS:1,TRY_HARDER:2,ALSO_INVERTED:3};
  const source=readFileSync(new URL('../scanner.js',import.meta.url),'utf8')
    .replace(/^import .*;\s*$/gm,'').replace(/export /g,'');
  const sandbox={
    document,Quagga,BrowserMultiFormatReader,BarcodeFormat:enums,
    DecodeHintType:hintEnums,navigator:{hardwareConcurrency:2},
    Date:{now:()=>clock},Promise,console,
    setTimeout:()=>{scheduled++;return 1;},clearTimeout:()=>{}
  };
  vm.runInNewContext(source+'\nglobalThis.api={startScanner,stopScanner};',sandbox);
  const scan=code=>{
    if(engine==='zxing') zxingCallback?.({getText:()=>code});
    else quaggaDetected?.({codeResult:{code,decodedCodes:[{error:.1}]}});
  };
  return {
    ...sandbox.api,nodes,calls,scan,
    absent:()=>{if(engine==='zxing')zxingCallback?.(null);else quaggaProcessed?.({});},
    advance:ms=>{clock+=ms;},target:{insertAdjacentHTML:document.body.insertAdjacentHTML},
    repeat:()=>callbacks['scanRepeat:click']?.(),
    get stops(){return zxingStops+quaggaStops;},
    get engine(){return engine;},
    get scheduled(){return scheduled;},
    get formats(){return lastHints?.get(1)||[];},
    switchReader:()=>nodes.get('scanSwitchEngine')?.onclick?.()
  };
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
  h.advance(901);h.absent();h.scan('0012345678');h.scan('0012345678');
  assert.equal(h.calls.length,2);assert.equal(closed,0);h.stopScanner();h.stopScanner();assert.equal(closed,1);
});
test('starts ZXing on iPhone-style Code128 scans instead of inert Quagga camera',async()=>{
  const h=scannerHarness();
  await h.startScanner(code=>h.calls.push(code),'SKU',{continuous:true});
  assert.equal(h.engine,'zxing');
  h.scan('1200768112');h.scan('1200768112');
  assert.deepEqual(h.calls,['1200768112']);
  h.stopScanner();
});
test('falls back to Quagga when the primary scanner cannot open the camera',async()=>{
  const h=scannerHarness({zxingFails:true});
  await h.startScanner(code=>h.calls.push(code),'marbete');
  assert.equal(h.engine,'quagga');
  h.scan('ZAP-402-001');
  assert.deepEqual(h.calls,['ZAP-402-001']);
  h.stopScanner();
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

test('QR-enabled marbete camera accepts a printed QR alongside Code128 labels',async()=>{
  const h=scannerHarness();
  const scanned=[];
  await h.startScanner(value=>scanned.push(value),'marbete de ubicación',{qrEnabled:true});
  assert.equal(h.engine,'zxing');
  assert.ok(h.formats.includes(11),'QR_CODE enabled');
  assert.ok(h.formats.includes(1),'CODE_128 preserved');
  assert.equal(h.scheduled,0,'QR mode must not auto-fall back to a non-QR decoder');
  h.scan('ZAP-402-001');
  assert.deepEqual(scanned,['ZAP-402-001']);
  assert.equal(h.stops,1);
});
test('QR-enabled scan preserves location URL contents exactly for the parser',async()=>{
  const h=scannerHarness();
  const scanned=[];
  await h.startScanner(value=>scanned.push(value),'ubicación',{qrEnabled:true});
  h.scan('https://example.org/ubicacion?marbete=ZAP-405-010');
  assert.deepEqual(scanned,['https://example.org/ubicacion?marbete=ZAP-405-010']);
});
