import test from 'node:test';
import assert from 'node:assert/strict';
import {assignProductLocation,getMarbete,normalizeMarbete,registerMarbete} from '../product-location.mjs';
import {locationDb} from './helpers/location-db.mjs';

const target={productId:'p1',sku:'0012345678',deptId:'dept1',marbeteCode:'459-001'};

test('assigns a SKU without changing stock or recording a stock movement',async()=>{
  const {sb,db}=locationDb();
  const result=await assignProductLocation(sb,target);
  assert.equal(result.assignment.marbete_codigo,'459-001');
  assert.equal(db.products[0].stock,2);
  assert.equal(db.assignments[0].cantidad,null);
  assert.deepEqual([...new Set(db.calls.filter(x=>x.action!=='select').map(x=>x.table))],['producto_marbetes']);
});

test('an existing counted assignment is preserved without a write',async()=>{
  const prior={sku:target.sku,marbete_codigo:'459-001',cantidad:2,updated_at:'original'};
  const {sb,db}=locationDb({assignments:[prior]});
  assert.equal((await assignProductLocation(sb,target)).alreadyAssigned,true);
  assert.deepEqual(db.assignments,[prior]);
  assert.equal(db.calls.filter(x=>x.action!=='select').length,0);
});

test('simultaneous retries create one assignment and preserve other locations',async()=>{
  const prior={sku:target.sku,marbete_codigo:'459-002',cantidad:1};
  const {sb,db}=locationDb({assignments:[prior]});
  await Promise.all(Array.from({length:5},()=>assignProductLocation(sb,target)));
  assert.equal(db.assignments.length,2);
  assert.deepEqual(db.assignments.find(x=>x.marbete_codigo==='459-002'),prior);
});

for(const [name,marbetes,code] of [
  ['unknown label',[],'NOT_REGISTERED'],
  ['inactive label',[{codigo:'459-001',departamento_id:'dept1',activo:false}],'INACTIVE'],
  ['another department',[{codigo:'459-001',departamento_id:'dept2',activo:true}],'WRONG_DEPARTMENT']
])test('rejects '+name+' before writing',async()=>{
  const {sb,db}=locationDb({marbetes});
  await assert.rejects(assignProductLocation(sb,target),e=>e.code===code);
  assert.equal(db.assignments.length,0);
  assert.equal(db.calls.filter(x=>x.action!=='select').length,0);
});

test('rejects a product removed or moved after search',async()=>{
  for(const products of [[],[{id:'p1',sku:target.sku,departamento_id:'dept2',activo:true}],[{id:'p1',sku:target.sku,departamento_id:'dept1',activo:false}]]){
    const {sb,db}=locationDb({products});
    await assert.rejects(assignProductLocation(sb,target),e=>e.code==='INVALID_PRODUCT');
    assert.equal(db.assignments.length,0);
  }
});

test('recovers a lost write response by verifying the saved assignment',async()=>{
  const {sb,db}=locationDb({writeError:{message:'Network response lost'},commitWithError:true});
  assert.equal((await assignProductLocation(sb,target)).assignment.marbete_codigo,'459-001');
  assert.equal(db.assignments.length,1);
});

test('does not claim success when the database denies the write',async()=>{
  const {sb,db}=locationDb({writeError:{code:'42501',message:'permission denied'}});
  await assert.rejects(assignProductLocation(sb,target),e=>e.code==='42501');
  assert.equal(db.assignments.length,0);
});

test('an unavailable verification is reported as unconfirmed, then retry is safe',async()=>{
  const {sb,db}=locationDb({readError:{afterWrite:true,message:'Connection lost'}});
  await assert.rejects(assignProductLocation(sb,target),e=>e.code==='UNCONFIRMED');
  db.readError=null;
  assert.equal((await assignProductLocation(sb,target)).alreadyAssigned,true);
  assert.equal(db.assignments.length,1);
});

test('a failed read is never treated as an unregistered label',async()=>{
  const {sb}=locationDb({readError:{code:'42501',message:'permission denied'}});
  await assert.rejects(getMarbete(sb,'459-001','dept1'),e=>e.code==='42501');
});

test('registers a new label once, then assigns it separately',async()=>{
  const {sb,db}=locationDb();
  const marbete=await registerMarbete(sb,{code:'405-001',deptId:'dept1',zona:'BODEGA'});
  assert.equal(marbete.codigo,'405-001');
  assert.equal(db.assignments.length,0);
  await registerMarbete(sb,{code:'405-001',deptId:'dept1',zona:'PISO'});
  assert.equal(db.marbetes.filter(x=>x.codigo==='405-001').length,1);
  assert.equal(db.marbetes.find(x=>x.codigo==='405-001').zona,'BODEGA');
});

test('registration cannot overwrite a label from another department',async()=>{
  const {sb,db}=locationDb();
  await assert.rejects(registerMarbete(sb,{code:'459-001',deptId:'dept2',zona:'PISO'}),e=>e.code==='WRONG_DEPARTMENT');
  assert.equal(db.marbetes[0].departamento_id,'dept1');
  assert.equal(db.marbetes[0].zona,'BODEGA');
});

test('barcode cleanup preserves leading zeroes and rejects invalid input',()=>{
  assert.equal(normalizeMarbete(' \u200b00459-001\r\n'),'00459-001');
  for(const value of ['',null,'x'.repeat(121),'459\n001'])assert.throws(()=>normalizeMarbete(value));
});
