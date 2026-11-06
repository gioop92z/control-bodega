import test from 'node:test';
import assert from 'node:assert/strict';
import {ContinuousReceive,receiptCsv,withNetworkDeadline,isExpiredAuthError,SupabaseReceiptApi} from '../continuous-receive.mjs';
import {durableMemory,receiptLocks,receivingDb} from './helpers/receiving-db.mjs';

const SKU='0012345678',UPC='0200000000001';
async function until(predicate){for(let i=0;i<1000&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,1));assert.ok(predicate(),'condition timed out');}
async function setup(t,{shared,storage=durableMemory(),locks=receiptLocks(),userId='user1',actor='Empleado 123',...options}={}){
  const data=shared||receivingDb();
  const events=[];
  const settings={api:data.api(userId),storage,locks,userId,deptId:'dept1',actor,onConfirmed:row=>events.push(row.id),...options};
  const queue=new ContinuousReceive(settings);t.after(()=>queue.dispose());await queue.start();
  return {...data,queue,settings,storage,events};
}
async function location(queue,code='402-001'){queue.scan(code);await until(()=>!queue.selecting);assert.ok(queue.state.active);}

for(const size of [100,500,1000])test(`${size} physical reads commit ${size} separate units without confirmation or finalization`,async t=>{
  const h=await setup(t);await location(h.queue);
  for(let i=0;i<size;i++)h.queue.scan(i%2?SKU:UPC);
  assert.equal(h.queue.rows.length,size);assert.equal(h.events.length,0);
  await h.queue.flush();
  assert.equal(h.queue.report().totalPieces,size);assert.equal(h.db.products[0].stock,10+size);
  assert.equal(h.db.assignments[0].cantidad,size);assert.equal(h.db.movements.length,size);
  assert.equal(new Set(h.db.requests.map(row=>row.p_id)).size,size);assert.equal(h.events.length,size);
  assert.ok(h.queue.rows.every(row=>row.status==='confirmed'&&row.quantity===1));
});

test('confirmed scans build a product from a zero baseline, one unit at a time',async t=>{
  const h=await setup(t);
  h.db.products[0].stock=0;
  await location(h.queue);
  for(let i=0;i<3;i++)h.queue.scan(SKU);
  assert.equal(h.db.products[0].stock,0);
  await h.queue.flush();
  assert.equal(h.db.products[0].stock,3);
  assert.equal(h.db.assignments[0].cantidad,3);
  assert.equal(h.queue.report().totalPieces,3);
  assert.equal(h.db.movements.length,3);
});

test('repeated SKU frames count five units; a repeated technical event ID counts once',async t=>{
  const h=await setup(t);await location(h.queue);
  for(let i=0;i<5;i++)h.queue.scan(SKU);
  const id=crypto.randomUUID();h.queue.scan(SKU,{eventId:id});h.queue.scan(SKU,{eventId:id});
  await h.queue.flush();assert.equal(h.db.movements.length,6);assert.equal(h.queue.report().totalPieces,6);
});

test('only a different marbete asks for confirmation; cancellation keeps the old location',async t=>{
  const h=await setup(t);await location(h.queue);h.queue.scan(SKU);
  h.queue.scan('402-002');assert.equal(h.queue.state.active.code,'ZAP-402-001');
  assert.equal(h.db.marbetes.some(row=>row.codigo==='ZAP-402-002'),false);
  assert.throws(()=>h.queue.scan(SKU),/Confirma/);h.queue.confirmSwitch(false);h.queue.scan(SKU);
  await h.queue.flush();assert.equal(h.queue.report().visitPieces,2);
  h.queue.scan('402-002');h.queue.confirmSwitch(true);await until(()=>!h.queue.selecting);
  assert.equal(h.queue.report().visitPieces,0);h.queue.scan(UPC);await h.queue.flush();
  assert.equal(h.queue.report().totalPieces,3);assert.equal(h.queue.report().visitPieces,1);
  assert.deepEqual(h.db.assignments.map(row=>row.cantidad),[2,1]);
  h.queue.scan('ZAP-402-002');assert.equal(h.queue.state.pendingSwitch,null);
});

test('SKU may be scanned before marbete; pending pieces attach to the first later marbete',async t=>{
  const h=await setup(t);
  h.queue.scan(SKU);h.queue.scan('UNKNOWN');h.queue.scan(SKU);
  assert.equal(h.queue.report().awaitingLocation,3);
  assert.equal(h.db.movements.length,0);
  h.queue.scan('402-001');await until(()=>!h.queue.selecting);
  await h.queue.flush();
  assert.equal(h.queue.report().awaitingLocation,0);
  assert.equal(h.queue.report().totalPieces,3);
  assert.equal(h.db.products.some(row=>row.sku==='UNKNOWN'),true);
  assert.equal(h.db.products.find(row=>row.sku==='UNKNOWN').stock,1);
  assert.equal(h.db.movements.length,3);
  assert.ok(h.queue.rows.every(row=>row.location==='ZAP-402-001'));
});
test('SKU first can be explicitly registered as general stock without location',async t=>{
  const h=await setup(t);
  h.queue.scan('NUEVO-777');h.queue.scan('NUEVO-777');
  assert.equal(h.queue.report().awaitingLocation,2);
  h.queue.approveWithoutLocation();await h.queue.flush();
  assert.equal(h.queue.report().totalPieces,2);
  assert.equal(h.db.products.find(row=>row.sku==='NUEVO-777').stock,2);
  assert.equal(h.db.movements.length,2);
  assert.equal(h.db.movements[0].marbete_codigo,null);
});
test('same unknown SKU receives every physical piece and maintains a single provisional identity',async t=>{
  const h=await setup(t);await location(h.queue);
  for(let i=0;i<7;i++)h.queue.scan('NUEVO-MENSUAL-32');
  await h.queue.flush();
  const products=h.db.products.filter(row=>row.sku==='NUEVO-MENSUAL-32');
  assert.equal(products.length,1);
  assert.equal(products[0].stock,7);
  assert.equal(h.queue.report().totalPieces,7);
  // The monthly catalog enriches this same SKU, not an additional product/stock.
  const initialId=products[0].id;
  products[0].descripcion='Zapato infantil nuevo';
  products[0].precio=199;
  assert.equal(h.db.products.find(row=>row.id===initialId).stock,7);
  assert.equal(h.db.products.filter(row=>row.sku==='NUEVO-MENSUAL-32').length,1);
});
test('SKU-first unlocated reads cannot be hidden by finalizing the session',async t=>{
  const h=await setup(t);h.queue.scan('SIN-UBICACION-2026');
  assert.equal(h.queue.report().awaitingLocation,1);
  assert.throws(()=>h.queue.finish(),/sin ubicación/i);
  h.queue.approveWithoutLocation();await h.queue.flush();
  assert.equal(h.queue.report().totalPieces,1);
  assert.doesNotThrow(()=>h.queue.finish());
});
test('unknown SKU is retained if the server does not allow catalog creation',async t=>{
  const h=await setup(t);await location(h.queue);
  h.db.failCreate=true;h.queue.scan('UNKNOWN-PENDING');await h.queue.flush();
  assert.equal(h.queue.report().pending,1);
  assert.equal(h.queue.report().totalPieces,0);
  assert.equal(h.db.movements.length,0);
  assert.match(h.queue.rows[0].error,/pendiente/i);
});

test('lost committed response stays pending until an idempotent retry confirms the same movement',async t=>{
  const h=await setup(t);await location(h.queue);h.db.lostResponse=true;h.queue.scan(SKU);await h.queue.flush();
  assert.equal(h.db.products[0].stock,11);assert.equal(h.queue.report().totalPieces,0);
  assert.equal(h.queue.rows[0].status,'uncertain');assert.equal(h.events.length,0);
  await h.queue.reconnect();assert.equal(h.queue.report().totalPieces,1);
  assert.equal(h.db.products[0].stock,11);assert.equal(h.db.movements.length,1);
  assert.equal(h.db.requests[0].p_id,h.db.requests[1].p_id);
});

test('offline reads survive closing and restoring the session, then synchronize without a new scan',async t=>{
  let online=true;const h=await setup(t,{online:()=>online});await location(h.queue);
  online=false;h.db.networkError=true;h.queue.scan(SKU);h.queue.scan(SKU);await h.queue.flush();
  assert.equal(h.queue.pending,2);assert.equal(h.db.movements.length,0);await h.queue.dispose();
  const restored=new ContinuousReceive(h.settings);t.after(()=>restored.dispose());await restored.start();
  assert.equal(restored.rows.length,2);assert.equal(restored.backend,'offline');
  online=true;h.db.networkError=false;await restored.reconnect();assert.equal(restored.report().totalPieces,2);
  assert.equal(h.db.movements.length,2);
});

test('a recovered sending row reuses the exact durable payload after a crash',async t=>{
  const h=await setup(t);await location(h.queue);h.queue.scan(SKU);await h.queue.flush();
  const row=h.queue.rows[0];row.status='sending';delete row.receipt;h.queue.saveRow(row);await h.queue.dispose();
  const restored=new ContinuousReceive(h.settings);t.after(()=>restored.dispose());await restored.start();await restored.flush();
  assert.equal(restored.rows[0].status,'confirmed');assert.equal(h.db.movements.length,1);assert.equal(h.db.products[0].stock,11);
});

test('two operators receive simultaneously without overwriting product or location counts',async t=>{
  const shared=receivingDb(),a=await setup(t,{shared,actor:'Empleado A'}),b=await setup(t,{shared,actor:'Empleado B',userId:'user2'});
  await Promise.all([location(a.queue),location(b.queue)]);
  for(let i=0;i<100;i++){a.queue.scan(SKU);b.queue.scan(UPC);}
  await Promise.all([a.queue.flush(),b.queue.flush()]);
  assert.equal(shared.db.products[0].stock,210);assert.equal(shared.db.assignments[0].cantidad,200);
  assert.equal(shared.db.movements.length,200);assert.equal(a.queue.report().totalPieces,100);assert.equal(b.queue.report().totalPieces,100);
});

test('an exclusive browser lease blocks a second tab before it can alter metadata',async t=>{
  const storage=durableMemory(),locks=receiptLocks(),shared=receivingDb();
  const a=await setup(t,{storage,locks,shared});await location(a.queue);
  const b=await setup(t,{storage,locks,shared});assert.equal(b.queue.owned,false);assert.throws(()=>b.queue.scan(SKU),/otra pestaña/);
  const restored=a.queue.journal.readSession();assert.equal(restored.id,a.queue.state.id);assert.equal(restored.active.code,'ZAP-402-001');
});

test('undo adds an auditable compensating movement and cannot subtract the same original twice',async t=>{
  const h=await setup(t);await location(h.queue);h.queue.scan(SKU);await h.queue.flush();
  const original=h.queue.rows[0];h.queue.undoLast();assert.throws(()=>h.queue.undoLast(),/No hay/);await h.queue.flush();
  assert.equal(h.queue.rows[1].reverses,original.id);assert.equal(h.db.movements.length,2);
  assert.equal(h.db.products[0].stock,10);assert.equal(h.db.assignments[0].cantidad,0);assert.equal(h.queue.report().totalPieces,0);
  assert.equal(h.queue.report().confirmed,2);
});

test('finalization reports confirmed/pending/failed without adding inventory again',async t=>{
  const h=await setup(t);await location(h.queue);h.queue.scan(SKU);h.queue.scan('UNKNOWN');await h.queue.flush();
  const before=h.db.movements.length,report=h.queue.finish();assert.equal(h.db.movements.length,before);
  assert.equal(report.totalPieces,2);assert.equal(report.failed,0);assert.equal(report.confirmed,2);assert.ok(report.endedAt);
  assert.throws(()=>h.queue.scan(SKU));const csv=receiptCsv(report);assert.match(csv,/UNKNOWN/);assert.match(csv,/Empleado 123/);
  h.queue.resume();h.queue.scan(SKU);await h.queue.flush();assert.equal(h.db.movements.length,3);
});

test('storage failure stops capture before a network write; missing server never claims readiness',async t=>{
  const h=await setup(t);await location(h.queue);h.storage.setItem=()=>{throw Error('QuotaExceededError');};
  assert.throws(()=>h.queue.scan(SKU),/proteger/);assert.equal(h.db.movements.length,0);assert.equal(h.queue.rows.length,0);
  const shared=receivingDb();shared.db.capabilityError={code:'PGRST202',message:'RPC not installed'};
  const blocked=await setup(t,{shared});assert.equal(blocked.queue.backend,'missing');assert.equal(blocked.queue.canScan,false);
  assert.throws(()=>blocked.queue.scan('402-001'),/migración/);
});

test('incomplete storage acknowledgement never increments confirmed counters',async t=>{
  const h=await setup(t);await location(h.queue);h.db.wrongReply=true;h.queue.scan(SKU);await h.queue.flush();
  assert.equal(h.queue.report().totalPieces,0);assert.equal(h.queue.pending,1);assert.equal(h.events.length,0);assert.equal(h.queue.backend,'invalid');
});

test('network timeout releases a hanging request instead of blocking receiving indefinitely',async()=>{
  await assert.rejects(withNetworkDeadline(()=>new Promise(()=>{}),'Confirmación de pieza',12),error=>
    error.code==='VANTIS_TIMEOUT' && /protegida/.test(error.message));
});

test('pending detail survives finish/resume and keeps its same UUID for safe retry',async t=>{
  let online=true;
  const h=await setup(t,{online:()=>online});await location(h.queue);
  online=false;h.db.networkError=true;
  const saved=h.queue.scan('0012345678');
  const pending=h.queue.pendingDetails();
  assert.equal(pending.length,1);
  assert.equal(pending[0].id,saved.id);
  assert.equal(pending[0].sku,'0012345678');
  assert.match(pending[0].marbete,/402-001/);
  assert.equal(pending[0].canSync,true);
  const finish=h.queue.finish();
  assert.equal(finish.totalPieces,0);
  assert.equal(finish.pending,1);
  assert.throws(()=>h.queue.newSession(),/sincroniza/i);
  h.queue.resume();
  online=true;h.db.networkError=false;
  await h.queue.reconnect();
  assert.equal(h.queue.pendingDetails().length,0);
  assert.equal(h.queue.report().totalPieces,1);
  assert.equal(h.db.requests[0].p_id,saved.id);
});


test('SKU without marbete stays local without catalog or stock writes until approval',async t=>{
  const h=await setup(t);
  h.queue.scan('PENDIENTE-SIN-MARBETE-2026');
  await h.queue.flush();
  assert.equal(h.queue.report().awaitingLocation,1);
  assert.equal(h.db.movements.length,0);
  assert.equal(h.db.products.some(row=>row.sku==='PENDIENTE-SIN-MARBETE-2026'),false);
  assert.equal(h.queue.rows[0].status,'queued');
  assert.equal(h.queue.rows[0].payload,null);
  assert.equal(h.queue.canApproveWithoutLocation,true);
  h.queue.approveWithoutLocation();
  await h.queue.flush();
  assert.equal(h.queue.rows[0].status,'confirmed');
  assert.equal(h.queue.rows[0].location,null);
  assert.equal(h.queue.rows[0].unlocatedApproved,true);
  assert.equal(h.db.movements.length,1);
  assert.equal(h.db.movements[0].marbete_codigo,null);
  assert.equal(h.db.products.find(row=>row.sku==='PENDIENTE-SIN-MARBETE-2026').stock,1);
});

test('approve without marbete remains available during server session recovery',async t=>{
  const h=await setup(t);
  h.queue.scan(SKU);
  h.queue.backend='checking';
  assert.equal(h.queue.canScan,false);
  assert.equal(h.queue.canApproveWithoutLocation,true);
  assert.equal(h.queue.approveWithoutLocation(),1);
  assert.equal(h.queue.rows[0].unlocatedApproved,true);
  assert.equal(h.db.movements.length,0);
  h.queue.backend='ready';
  await h.queue.flush();
  assert.equal(h.queue.report().totalPieces,1);
});

test('a local receipt session error is not mislabeled an expired Auth token',()=>{
  assert.equal(isExpiredAuthError(Error('Sesión local incompatible.')),false);
  assert.equal(isExpiredAuthError(Error('La sesión se cerró antes de terminar.')),false);
  assert.equal(isExpiredAuthError(Error('El servidor tarda en responder a esta sesión.')),false);
  assert.equal(isExpiredAuthError({code:'42501',message:'Sin acceso al departamento'}),false);
  assert.equal(isExpiredAuthError({code:'PGRST301',message:'JWT expired'}),true);
  assert.equal(isExpiredAuthError(Error('Invalid refresh token')),true);
});

test('expired JWT can be refreshed in a read-only capability probe without losing rows',async t=>{
  const fixture=receivingDb();
  const api=fixture.api('user1');
  const original=api.capabilities.bind(api);
  let first=true,refreshes=0;
  api.capabilities=async()=>{
    if(first){first=false;throw Object.assign(Error('JWT expired'),{code:'PGRST301'});}
    return original();
  };
  api.recoverAuth=async id=>{assert.equal(id,'user1');refreshes++;return true;};
  const h=await setup(t,{shared:fixture,api});
  assert.equal(h.queue.backend,'ready');
  assert.equal(refreshes,1);
  h.queue.scan(SKU);
  h.queue.approveWithoutLocation();
  await h.queue.flush();
  assert.equal(h.queue.report().totalPieces,1);
  assert.equal(fixture.db.movements.length,1);
});

test('failed JWT refresh leaves the current UUID and scan protected for later retry',async t=>{
  const fixture=receivingDb();
  const api=fixture.api('user1');
  api.capabilities=async()=>{throw Object.assign(Error('JWT expired'),{code:'PGRST301'});};
  api.recoverAuth=async()=>false;
  const h=await setup(t,{shared:fixture,api});
  assert.equal(h.queue.backend,'offline');
  assert.match(h.queue.error,/autoriza|renovar/i);
  const id=h.queue.scan(SKU).id;
  assert.equal(h.queue.rows[0].id,id);
  assert.equal(h.queue.rows[0].status,'queued');
  assert.equal(fixture.db.movements.length,0);
});


test('operator can cancel one staged SKU and preserve an audit record without stock writes',async t=>{
  const h=await setup(t);
  const first=h.queue.scan('CANCELAR-1').id;
  h.queue.scan('CONSERVAR-2');
  assert.equal(h.queue.cancelPending(first),true);
  assert.equal(h.queue.rows.find(row=>row.id===first).status,'cancelled');
  assert.equal(h.queue.report().pending,1);
  assert.equal(h.queue.report().awaitingLocation,1);
  assert.equal(h.queue.pendingDetails().length,1);
  h.queue.approveWithoutLocation();
  await h.queue.flush();
  assert.equal(h.db.movements.length,1);
  assert.equal(h.db.products.some(row=>row.sku==='CANCELAR-1'),false);
  assert.equal(h.db.products.find(row=>row.sku==='CONSERVAR-2').stock,1);
});

test('reset only unsent pieces and keep uncertain movements for reconciliation',async t=>{
  const h=await setup(t);
  h.queue.scan('ERROR-1');h.queue.scan('ERROR-2');
  assert.equal(h.queue.resetUnsent(),2);
  assert.equal(h.queue.report().pending,0);
  assert.equal(h.queue.report().awaitingLocation,0);
  assert.equal(h.queue.pendingDetails().length,0);
  assert.equal(h.db.movements.length,0);
  assert.equal(h.queue.rows.filter(row=>row.status==='cancelled').length,2);
  assert.throws(()=>h.queue.resetUnsent(),/No hay lecturas/);
});

test('a scan already sent or with uncertain response cannot be cancelled',async t=>{
  const h=await setup(t);
  const id=h.queue.scan(SKU).id;
  h.queue.rows[0].attempts=1;
  h.queue.rows[0].status='uncertain';
  assert.throws(()=>h.queue.cancelPending(id),/no se puede cancelar/i);
  assert.equal(h.queue.rows[0].status,'uncertain');
  assert.equal(h.queue.report().pending,1);
});

test('cancelled entries survive journal recovery and are not restored as pending',async t=>{
  const storage=durableMemory(),shared=receivingDb();
  const first=await setup(t,{storage,shared});
  first.queue.scan('CANCELAR-PERSISTENTE');
  first.queue.resetUnsent();
  await first.queue.dispose();
  const second=await setup(t,{storage,shared});
  assert.equal(second.queue.report().pending,0);
  assert.equal(second.queue.rows[0].status,'cancelled');
  assert.equal(second.queue.pendingDetails().length,0);
});
