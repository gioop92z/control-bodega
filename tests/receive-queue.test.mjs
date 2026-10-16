import test from 'node:test';
import assert from 'node:assert/strict';
import {ReceiveQueue} from '../receive-queue.mjs';
import {supportDb,memoryStorage,testLocks} from './helpers/support-db.mjs';

const SKU='0012345678',UPC='0200000000001';
function harness(overrides={}) {
  const {sb,db}=supportDb(overrides);
  const storage=memoryStorage();
  const options={sb,deptId:'dept1',userId:'staff1',actor:'Empleado 123',storage,locks:testLocks(),online:()=>true,uuid:()=>crypto.randomUUID()};
  return {db,sb,storage,options,queue:new ReceiveQueue(options)};
}
const scan=code=>[{code,quantity:1}];

test('receiving is open without a location, and a valid marbete is optional',async()=>{
  const h=harness();
  h.queue.capture(scan(SKU));
  assert.equal(h.queue.state.rows[0].location,'');
  assert.equal(h.queue.state.rows[0].quantity,1);
  await assert.rejects(h.queue.selectMarbete('NO-EXISTE'),/no es un marbete/i);
  // A failed marbete scan never discards or relocates the first piece.
  assert.equal(h.queue.state.rows[0].location,'');
  h.queue.useWithoutLocation();
  await h.queue.selectMarbete('ZAP-459-001');
  h.queue.capture(scan(SKU));
  assert.equal(h.queue.state.rows[1].location,'ZAP-459-001');
  assert.equal(h.db.movements.length,0);
});

test('one hundred rapid physical scans are durable immediately without one hundred RPCs',async()=>{
  const h=harness();await h.queue.selectMarbete('ZAP-459-001');
  for(let i=0;i<100;i++)h.queue.capture(scan(SKU));
  assert.equal(h.queue.state.rows.length,1);
  assert.equal(h.queue.state.rows[0].quantity,100);
  assert.equal(JSON.parse(h.storage.getItem(h.queue.key)).rows[0].quantity,100);
  assert.equal(h.db.movements.length,0);
  await h.queue.prepare();
  assert.equal(h.queue.confirmation.pieces,100);
  assert.equal(h.queue.confirmation.locations,1);
});

test('the same SKU in two different marbetes remains two distinct stock groups',async()=>{
  const h=harness();await h.queue.selectMarbete('ZAP-459-001');
  h.queue.capture(scan(SKU));await h.queue.selectMarbete('ZAP-459-002');
  h.queue.capture(scan(SKU));await h.queue.prepare();
  assert.equal(h.queue.state.rows.length,2);
  assert.deepEqual(h.queue.state.rows.map(x=>x.location).sort(),['ZAP-459-001','ZAP-459-002']);
  assert.equal(h.queue.confirmation.pieces,2);
});

test('SKU and UPC coalesce only within the same marbete',async()=>{
  const h=harness();await h.queue.selectMarbete('ZAP-459-001');
  h.queue.capture(scan(SKU));h.queue.capture(scan(UPC));
  await h.queue.settle();
  assert.equal(h.queue.state.rows.length,1);
  assert.equal(h.queue.state.rows[0].quantity,2);
});

test('unknown article blocks final confirmation without losing valid scanned pieces',async()=>{
  const h=harness();await h.queue.selectMarbete('ZAP-459-001');
  h.queue.capture(scan('UNKNOWN'));h.queue.capture(scan(SKU));
  await assert.rejects(h.queue.prepare(),/requieren revisión/);
  assert.equal(h.queue.state.rows.length,2);
  assert.equal(h.queue.accepting,true);
  h.queue.remove(h.queue.state.rows.find(x=>x.code==='UNKNOWN').id);
  await h.queue.prepare();
  assert.equal(h.queue.confirmation.pieces,1);
});

test('reload restores the physical marbete and draft, but requires location revalidation',async()=>{
  const h=harness();await h.queue.selectMarbete('ZAP-459-001');h.queue.capture(scan(SKU));
  const recovered=new ReceiveQueue(h.options);
  assert.equal(recovered.state.activeMarbete,'ZAP-459-001');
  assert.equal(recovered.state.rows.length,1);
  assert.throws(()=>recovered.capture(scan(SKU)),/validación del marbete/);
  await recovered.validateActive();recovered.capture(scan(SKU));
  assert.equal(recovered.state.rows[0].quantity,2);
});

test('finalized receipt records one atomic ENTRADA per SKU/location and never before confirmation',async()=>{
  const h=harness();
  h.sb.rpc=(name,payload)=>({
    abortSignal(){return this;},
    then(resolve){
      assert.equal(name,'mover_stock_v2');
      h.db.rpcCalls.push(structuredClone(payload));
      const product=h.db.products.find(x=>x.id===payload.p_producto);
      product.stock+=payload.p_cantidad;
      const existing=h.db.assignments.find(x=>x.sku===product.sku&&x.marbete_codigo===payload.p_marbete);
      if(existing)existing.cantidad=(existing.cantidad||0)+payload.p_cantidad;
      else h.db.assignments.push({sku:product.sku,marbete_codigo:payload.p_marbete,cantidad:payload.p_cantidad});
      h.db.movements.push({id:payload.p_id,tipo:'ENTRADA',sku:product.sku,cantidad:payload.p_cantidad,departamento_id:product.departamento_id,marbete_codigo:payload.p_marbete,stock_resultante:product.stock});
      return Promise.resolve({data:{stock_resultante:product.stock},error:null}).then(resolve);
    }
  });
  await h.queue.selectMarbete('ZAP-459-001');
  for(let i=0;i<5;i++)h.queue.capture(scan(SKU));
  assert.equal(h.db.rpcCalls.length,0);
  await h.queue.prepare();assert.equal(h.db.rpcCalls.length,0);
  await Promise.all([h.queue.submit(),h.queue.submit()]);
  assert.equal(h.db.rpcCalls.length,1);
  assert.equal(h.db.products[0].stock,15);
  assert.equal(h.db.assignments[0].cantidad,5);
  assert.equal(h.queue.state.rows[0].status,'done');
});

test('unlocated pieces can be finalized; changing the marbete never reassigns them',async()=>{
  const h=harness();
  h.queue.capture(scan(SKU));
  h.queue.capture(scan(SKU));
  await h.queue.selectMarbete('ZAP-459-001');
  h.queue.capture(scan(SKU));
  h.queue.useWithoutLocation();
  h.queue.capture(scan(UPC));
  await h.queue.prepare();
  assert.equal(h.queue.confirmation.pieces,4);
  assert.equal(h.queue.confirmation.locations,1);
  assert.equal(h.queue.state.rows.length,2);
  assert.equal(h.queue.state.rows.find(x=>x.location==='').quantity,3);
  assert.equal(h.queue.state.rows.find(x=>x.location==='ZAP-459-001').quantity,1);
  const h2=harness();
  h2.queue.capture(scan(SKU));
  await h2.queue.prepare();
  assert.equal(h2.queue.confirmation.locations,0);
  assert.equal(h2.queue.confirmation.pieces,1);
});
test('unlocated entry is saved without a fabricated marbete',async()=>{
  const h=harness();
  h.sb.rpc=(name,payload)=>({
    abortSignal(){return this;},then(resolve){
      assert.equal(name,'mover_stock_v2');
      assert.equal(payload.p_tipo,'ENTRADA');
      assert.equal(payload.p_marbete,null);
      h.db.rpcCalls.push(structuredClone(payload));
      return Promise.resolve({data:{stock_resultante:11},error:null}).then(resolve);
    }
  });
  h.queue.capture(scan(SKU));
  await h.queue.prepare();
  await h.queue.submit();
  assert.equal(h.db.rpcCalls.length,1);
  assert.equal(h.queue.state.rows[0].status,'done');
  assert.equal(h.db.assignments.length,0);
});


test('first scan automatically registers a brand-new physical ZAP marbete, then reuses it',async()=>{
  const h=harness();
  const first=await h.queue.selectMarbete('ZAP-402-001');
  assert.equal(first.codigo,'ZAP-402-001');
  assert.equal(first.created,true);
  assert.equal(first.zona,'BODEGA');
  assert.equal(first.departamento_id,'dept1');
  assert.equal(h.queue.state.activeMarbete,'ZAP-402-001');
  assert.equal(h.db.marbetes.filter(x=>x.codigo==='ZAP-402-001').length,1);
  h.queue.capture(scan(SKU));
  assert.equal(h.queue.state.rows[0].location,'ZAP-402-001');
  const next=await h.queue.selectMarbete('zap-402-001');
  assert.equal(next.created,false);
  assert.equal(h.db.marbetes.filter(x=>x.codigo==='ZAP-402-001').length,1);
  await h.queue.prepare();
  assert.equal(h.queue.confirmation.locations,1);
});

test('unknown SKU barcodes cannot be created as accidental locations',async()=>{
  const h=harness();
  await assert.rejects(h.queue.selectMarbete('1200768112'),/marbete reconocible/i);
  assert.equal(h.db.marbetes.length,2);
  assert.equal(h.queue.state.activeMarbete,'');
  h.queue.capture(scan(SKU));
  assert.equal(h.queue.state.rows[0].location,'');
});

test('an invalid or foreign marbete keeps the last selected marbete usable',async()=>{
  const h=harness({marbetes:[
    {codigo:'ZAP-459-001',zona:'BODEGA',activo:true,departamento_id:'dept1'},
    {codigo:'ZAP-405-001',zona:'BODEGA',activo:true,departamento_id:'dept2'}
  ]});
  await h.queue.selectMarbete('ZAP-459-001');
  await assert.rejects(h.queue.selectMarbete('ZAP-405-001'),/otro departamento/i);
  assert.equal(h.queue.state.activeMarbete,'ZAP-459-001');
  assert.equal(h.queue.activeValidated,true);
  h.queue.capture(scan(SKU));
  assert.equal(h.queue.state.rows[0].location,'ZAP-459-001');
  assert.equal(h.db.marbetes.length,2);
});

test('failed marbete write never claims to have registered it',async()=>{
  const h=harness();
  const original=h.sb.from;
  h.sb.from=table=>{
    const query=original(table);
    if(table==='marbetes')query.insert=()=>({
      abortSignal(){return this;},
      then(resolve){return Promise.resolve({data:null,error:{code:'42501',message:'permission denied'}}).then(resolve);}
    });
    return query;
  };
  await assert.rejects(h.queue.selectMarbete('ZAP-402-024'),error=>error.code==='42501' && error.message==='permission denied');
  assert.equal(h.queue.state.activeMarbete,'');
  assert.equal(h.db.marbetes.length,2);
});

test('scanning QR URL auto-registers a new marbete once and can reuse it',async()=>{
  const h=harness();
  const code='ZAP-402-001';
  const qr='https://inventory.example/ubicacion?marbete='+code;
  const first=await h.queue.selectMarbete(qr);
  assert.equal(first.codigo,code);
  assert.equal(first.created,true);
  h.queue.capture(scan(SKU));
  assert.equal(h.queue.state.rows[0].location,code);
  h.queue.useWithoutLocation();
  const second=await h.queue.selectMarbete('{"marbete":"'+code+'"}');
  assert.equal(second.created,false);
  assert.equal(h.db.marbetes.filter(x=>x.codigo===code).length,1);
});
