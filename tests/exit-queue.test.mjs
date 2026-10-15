import test from 'node:test';
import assert from 'node:assert/strict';
import {FastExitQueue} from '../exit-queue.mjs';
import {supportDb,memoryStorage,testLocks} from './helpers/support-db.mjs';

function harness(overrides={}) {
  const {sb,db}=supportDb(overrides), storage=memoryStorage();
  const options={sb,deptId:'dept1',userId:'user',actor:'Empleado 123',storage,locks:testLocks(),online:()=>true,uuid:()=>crypto.randomUUID()};
  return {sb,db,storage,options,queue:new FastExitQueue(options)};
}
const sku='0012345678',scan=code=>[{code,quantity:1}];

test('a scanner read appears and is saved synchronously before any catalog response',async()=>{
  const h=harness({queryDelay:20});h.queue.capture(scan(sku));
  assert.equal(h.queue.state.rows.length,1);assert.equal(h.queue.state.rows[0].quantity,1);
  assert.equal(h.queue.state.rows[0].resolving,true);assert.equal(h.db.calls.length,0);
  assert.equal(JSON.parse(h.storage.getItem(h.queue.key)).rows[0].code,sku);
  await h.queue.settle();assert.equal(h.queue.state.rows[0].product.id,'p1');
});
test('100 consecutive reads sum immediately and share one background lookup',async()=>{
  const h=harness();for(let i=0;i<100;i++)h.queue.capture(scan(sku));
  assert.equal(h.queue.state.rows.length,1);assert.equal(h.queue.state.rows[0].quantity,100);
  assert.equal(h.db.movements.length,0);await h.queue.settle();
  assert.equal(h.db.calls.length,3);assert.equal(h.queue.state.rows[0].quantity,100);
});
test('incoming scans during a delayed lookup retain every piece and merge SKU/UPC aliases',async()=>{
  const h=harness({queryDelay:10});h.queue.capture(scan(sku));const first=h.queue.flush();
  for(let i=0;i<5;i++)h.queue.capture(scan(sku));
  h.queue.capture(scan('0200000000001'));await first;await h.queue.settle();
  assert.equal(h.queue.state.rows.length,1);assert.equal(h.queue.state.rows[0].quantity,7);
  const reads=h.db.calls.length;h.queue.capture(scan('0200000000001'));await h.queue.settle();
  assert.equal(h.queue.state.rows[0].quantity,8);assert.equal(h.db.calls.length,reads);
});
test('lookup outages keep the captured row and later reads continue without a question',async()=>{
  const h=harness({readError:{table:'productos',message:'Network failed'}});
  h.queue.capture(scan(sku));await h.queue.settle();
  assert.equal(h.queue.state.rows[0].quantity,1);assert.equal(h.queue.state.rows[0].queryFailed,true);
  h.queue.capture(scan('0012345679'));assert.equal(h.queue.state.rows.length,2);
  h.db.readError=null;await h.queue.settle();await h.queue.prepare();
  assert.equal(h.queue.confirmation.pieces,2);assert.equal(h.db.movements.length,0);
});
test('unresolved reads survive reload and resolve automatically from the same saved draft',async()=>{
  const h=harness();h.queue.capture(scan(sku));clearTimeout(h.queue.timer);h.queue.timer=null;
  const recovered=new FastExitQueue(h.options);assert.equal(recovered.state.rows[0].quantity,1);
  await recovered.settle();assert.equal(recovered.state.rows[0].product.id,'p1');
});
test('unknown codes remain in the list while subsequent known products are captured',async()=>{
  const h=harness();h.queue.capture(scan('MISSING'));h.queue.capture(scan(sku));
  assert.equal(h.queue.state.rows.length,2);await h.queue.settle();
  await assert.rejects(h.queue.prepare(),/pendientes/);assert.equal(h.queue.accepting,true);
  h.queue.remove(h.queue.state.rows.find(row=>row.code==='MISSING').id);
  await h.queue.prepare();assert.equal(h.queue.confirmation.pieces,1);assert.equal(h.db.rpcCalls.length,0);
});
test('location information never interrupts capture and an insufficient automatic label becomes a total-stock exit',async()=>{
  const h=harness({assignments:[{sku,marbete_codigo:'ZAP-459-001',cantidad:1}]});
  for(let i=0;i<3;i++)h.queue.capture(scan(sku));await h.queue.prepare();
  assert.equal(h.queue.state.rows[0].location,'');assert.equal(h.queue.state.rows[0].locations.length,1);
  assert.equal(h.queue.confirmation.totalOnly,1);assert.equal(h.db.rpcCalls.length,0);
});
test('finalization waits for pending lookups, pauses new capture and records the selected sale type once',async()=>{
  const h=harness({queryDelay:10});h.queue.capture(scan(sku));const preparing=h.queue.prepare();
  assert.throws(()=>h.queue.capture(scan(sku)),/Termina/);await preparing;
  assert.equal(h.db.rpcCalls.length,0);
  await Promise.all([h.queue.submit({acknowledgeTotalOnly:true,reason:'VENTA NOCTURNA'}),h.queue.submit({acknowledgeTotalOnly:true,reason:'VENTA NOCTURNA'})]);
  assert.equal(h.db.rpcCalls.length,1);assert.match(h.db.rpcCalls[0].p_nota,/^VENTA NOCTURNA/);
  assert.equal(h.queue.accepting,true);assert.equal(h.db.products[0].stock,9);
});
test('the next scan starts the next sale automatically with no new-screen or new-batch step',async()=>{
  const h=harness();h.queue.capture(scan(sku));await h.queue.prepare();
  await h.queue.submit({acknowledgeTotalOnly:true});const previous=h.queue.state.id;
  h.queue.capture(scan(sku));assert.notEqual(h.queue.state.id,previous);
  assert.equal(h.queue.state.rows.length,1);assert.equal(h.queue.state.rows[0].quantity,1);
  await h.queue.settle();assert.equal(h.db.rpcCalls.length,1);
});
