import test from 'node:test';
import assert from 'node:assert/strict';
import {ContinuousReceive} from '../continuous-receive.mjs';
import {durableMemory,receiptLocks,receivingDb} from './helpers/receiving-db.mjs';

async function setup(t,online=()=>true) {
  const fixture=receivingDb();
  const queue=new ContinuousReceive({
    api:fixture.api('user1'),storage:durableMemory(),locks:receiptLocks(),
    userId:'user1',deptId:'dept1',actor:'Empleado de prueba',online
  });
  t.after(()=>queue.dispose());
  await queue.start();
  return {...fixture,queue};
}
async function until(predicate,ms=20000) {
  const end=Date.now()+ms;
  while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(predicate(),'validation did not finish');
}

test('10,000 sequential physical SKU reads at 100 marbetes confirm exactly 10,000 pieces',async t=>{
  const {queue,db}=await setup(t);
  for(let section=1;section<=100;section++){
    const code='402-'+String(section).padStart(3,'0');
    assert.equal(queue.scan(code).type,'location');
    for(let piece=0;piece<100;piece++){
      assert.equal(queue.scan(piece%2?'0200000000001':'0012345678').type,'piece');
    }
    await until(()=>queue.state.pendingLabels.length===0);
    await queue.flush();
    assert.equal(queue.report().totalPieces,section*100,'all confirmed up to current marbete');
  }
  assert.equal(queue.rows.length,10000);
  assert.equal(queue.report().totalPieces,10000);
  assert.equal(queue.report().pending,0);
  assert.equal(db.products[0].stock,10010,'exactly 10000 added to simulated baseline');
  assert.equal(db.movements.length,10000);
  assert.equal(new Set(db.requests.map(row=>row.p_id)).size,10000);
  assert.equal(db.assignments.length,100);
  assert.ok(db.assignments.every(row=>row.cantidad===100));
  assert.equal(queue.state.active.code,'ZAP-402-100');
});

test('offline backlog pauses safely before Safari storage can overflow',async t=>{
  let online=true;
  const {queue,db}=await setup(t,()=>online);
  queue.scan('402-001');
  await until(()=>queue.state.pendingLabels.length===0);
  online=false;
  for(let piece=0;piece<1200;piece++)queue.scan('0012345678');
  assert.equal(queue.report().pending,1200);
  assert.throws(()=>queue.scan('0012345678'),/1,200 lecturas sin confirmar/);
  assert.equal(db.movements.length,0);
  assert.equal(queue.rows.length,1200);
  assert.equal(queue.report().confirmed,0);
});
