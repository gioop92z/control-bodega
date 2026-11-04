import test from 'node:test';
import assert from 'node:assert/strict';
import {listLocalSkuAudit,listServerSkuAudit,auditFromMovement,captureMethodLabel} from '../receiving-audit.mjs';
import {durableMemory,receiptLocks,receivingDb} from './helpers/receiving-db.mjs';
import {ContinuousReceive,receiptCsv} from '../continuous-receive.mjs';

const sku='0012345678',upc='0200000000001';
const makeRow=(id,method,operator='Vendedora 441')=>({
  id,sessionId:'sesion-1',kind:'receive',code:upc,product:{sku},
  capturedAt:'2026-11-04T18:00:00.000Z',status:'confirmed',location:'ZAP-402-001',
  captureMethod:method,operator, evidenceStatus:method==='camera'?'local':'none'
});

test('audit lists each real receipt by SKU/UPC, with method, operator and same-device scope',async()=>{
  const store=durableMemory();
  const base='vantis.continuous.v1/user-a/dept-a/'+encodeURIComponent('Vendedora 441')+'/row/sesion-1/';
  store.setItem(base+'a',JSON.stringify(makeRow('a','camera')));
  store.setItem(base+'b',JSON.stringify(makeRow('b','manual')));
  store.setItem(base+'c',JSON.stringify(makeRow('c','scanner')));
  store.setItem(base+'d',JSON.stringify({...makeRow('d','camera'),kind:'undo'}));
  store.setItem('vantis.continuous.v1/user-a/dept-b/someone/row/sesion-1/other',JSON.stringify(makeRow('other','manual')));
  store.setItem('vantis.continuous.v1/user-b/dept-a/someone/row/sesion-1/other',JSON.stringify(makeRow('other2','manual')));
  const rows=await listLocalSkuAudit('dept-a','user-a',sku,{codes:[upc],storage:store});
  assert.equal(rows.length,3);
  assert.deepEqual(new Set(rows.map(x=>x.metodo)),new Set(['camera','manual','scanner']));
  assert.ok(rows.every(x=>x.operador==='Vendedora 441'));
  assert.ok(rows.every(x=>x.sesion==='sesion-1'&&x.marbete==='ZAP-402-001'));
  assert.equal(captureMethodLabel('manual'),'Manual');
});

test('earlier receipts without source remain unknown, never falsely manual',async()=>{
  const store=durableMemory();
  store.setItem('vantis.continuous.v1/u/d/Empleado%20421/row/sesion/old',
    JSON.stringify({...makeRow('old',undefined,'') ,captureMethod:undefined,operator:''}));
  const [row]=await listLocalSkuAudit('d','u',sku,{codes:[upc],storage:store});
  assert.equal(row.metodo,'unknown');
  assert.equal(row.operador,'Empleado 421');
});

test('new movements persist camera/manual/scanner plus photo status across reload and CSV',async t=>{
  const storage=durableMemory(),locks=receiptLocks(),fixture=receivingDb();
  const opts={api:fixture.api('user-a'),storage,locks,userId:'user-a',deptId:'dept1',actor:'Vendedora 441'};
  const queue=new ContinuousReceive(opts);t.after(()=>queue.dispose());await queue.start();
  queue.scan('402-001');for(let i=0;i<40&&!queue.state.active;i++)await new Promise(r=>setTimeout(r,2));
  assert.ok(queue.state.active);
  const camera=queue.scan(sku,{source:'camera'});
  const manual=queue.scan(sku,{source:'manual'});
  const reader=queue.scan(sku,{source:'scanner'});
  assert.equal(queue.rows.find(x=>x.id===camera.id).evidenceStatus,'pending');
  assert.equal(queue.markEvidence(camera.id,'local'),true);
  await queue.flush();
  assert.equal(fixture.db.movements.length,3);
  assert.deepEqual(fixture.db.requests.map(x=>x.p_operador),[
    'Vendedora 441 | ORIGEN=camera','Vendedora 441 | ORIGEN=manual','Vendedora 441 | ORIGEN=scanner'
  ]);

  const order=queue.rows.map(r=>r.captureMethod);
  assert.deepEqual(order,['camera','manual','scanner']);
  assert.ok(queue.rows.every(x=>x.operator==='Vendedora 441'));
  assert.match(receiptCsv(queue.report()),/Método/);
  assert.match(receiptCsv(queue.report()),/camera/);
  await queue.dispose();
  const recovered=new ContinuousReceive(opts);t.after(()=>recovered.dispose());await recovered.start();
  assert.deepEqual(recovered.rows.map(x=>x.captureMethod),order);
  assert.equal(recovered.rows[0].evidenceStatus,'local');
});

test('confirmed movement note recovers operator and source on other devices',async()=>{
  const calls=[],movement={
    id:'a1',sku,nota:'RECEPCIÓN CONTINUA COMPATIBLE · Sesión 11111111-1111-4111-8111-111111111111 · Vendedora 441 | ORIGEN=manual',
    tipo:'ENTRADA',marbete_codigo:'ZAP-402-001',created_at:'2026-11-04T18:00:00Z'
  };
  const query={
    select(...args){calls.push(['select',...args]);return this;},
    eq(...args){calls.push(['eq',...args]);return this;},
    order(...args){calls.push(['order',...args]);return this;},
    limit(value){calls.push(['limit',value]);return Promise.resolve({data:[movement],error:null});}
  };
  const sb={from(table){assert.equal(table,'movimientos');return query;}};
  const [row]=await listServerSkuAudit(sb,'dept1',sku);
  assert.equal(row.metodo,'manual');
  assert.equal(row.operador,'Vendedora 441');
  assert.equal(row.servidor,true);
  assert.equal(row.marbete,'ZAP-402-001');
  assert.ok(calls.some(x=>x[0]==='eq'&&x[1]==='departamento_id'&&x[2]==='dept1'));
  assert.ok(calls.some(x=>x[0]==='eq'&&x[1]==='sku'&&x[2]===sku));
});
test('legacy note without method is unknown, unrelated stock movements do not masquerade as receipts',()=>{
  assert.equal(auditFromMovement({id:'old',nota:'RECEPCIÓN CONTINUA · Sesión xyz · Empleado 123',sku})?.metodo,'unknown');
  assert.equal(auditFromMovement({id:'not-receipt',nota:'IMPORTACIÓN DE CATÁLOGO',sku}),null);
});
