import test from 'node:test';
import assert from 'node:assert/strict';
import {SupportBatch, parseSupportText, lookupSupportCodes, lineIssue} from '../support-batch.mjs';
import {supportDb,memoryStorage,testLocks} from './helpers/support-db.mjs';

function harness(overrides={}, shared={}) {
  const {db,sb}=shared.backend || supportDb(overrides), storage=shared.storage || memoryStorage(), locks=shared.locks || testLocks();
  const options={sb,deptId:'dept1',userId:'user1',actor:'Empleado 123',storage,uuid:()=>crypto.randomUUID(),locks,online:()=>true,...shared.options};
  return {db,sb,storage,locks,options,batch:new SupportBatch(options)};
}
const one=[{code:'0012345678',quantity:1}];

test('pasted codes preserve leading zeroes, separators, duplicates and Excel text wrappers',()=>{
  const parsed=parseSupportText('0012345678\n0012345678,0200000000002;0012345679');
  assert.deepEqual(parsed.entries.map(x=>x.code),['0012345678','0012345678','0200000000002','0012345679']);
  assert.equal(parsed.errors.length,0);
  assert.equal(parseSupportText('="0012345678"').entries[0].code,'0012345678');
  assert.equal(parseSupportText('SKU\tCantidad\n="0012345678"\t2').entries[0].code,'0012345678');
});
test('Excel tables detect named SKU and quantity columns without treating prices or orders as codes',()=>{
  const parsed=parseSupportText('Pedido\tSKU\tPrecio\tCantidad\n100\t0012345678\t599.00\t3\n101\t0012345679\t699.00\t2');
  assert.equal(parsed.table,true);assert.equal(parsed.codeColumn,1);assert.equal(parsed.quantityColumn,3);
  assert.deepEqual(parsed.entries,[{code:'0012345678',quantity:3},{code:'0012345679',quantity:2}]);
  assert.equal(parseSupportText('SKU,Descripcion,Cantidad\n0012345678,"TENIS, AZUL",2').entries[0].quantity,2);
});
test('unnamed tabular data permits explicit column mapping and defaults to one piece per row',()=>{
  const parsed=parseSupportText('pedido1\t0012345678\t2\npedido2\t0012345679\t3',{codeColumn:1,quantityColumn:2,hasHeader:false});
  assert.equal(parsed.entries[1].quantity,3);assert.equal(parsed.entries[1].code,'0012345679');
  assert.equal(parseSupportText('0012345678\t599\n0012345679\t699').entries[0].quantity,1);
});
test('invalid rows, scientific notation, fractions, zero and missing quantities are visible errors',()=>{
  for(const value of ['0','-1','1.2','1e2','','1000001']){
    const parsed=parseSupportText('SKU\tCantidad\n0012345678\t'+value);assert.equal(parsed.errors.length,1);
  }
  assert.equal(parseSupportText('1.234E+12').errors.length,1);
  assert.equal(parseSupportText('1234.0').errors.length,1);
  assert.throws(()=>parseSupportText('SKU\tCantidad\n0012345678\t1',{codeColumn:0,quantityColumn:0}),/diferentes/);
  assert.throws(()=>parseSupportText(Array(501).fill('0012345678').join('\n')),/500/);
});
test('a ten-code paste uses two filtered product queries plus one location query',async()=>{
  const h=harness();
  for(let i=3;i<=10;i++)h.db.products.push({...h.db.products[0],id:'p'+i,sku:'00123456'+String(77+i).padStart(2,'0'),upc:'02000000000'+String(i).padStart(2,'0')});
  const results=await lookupSupportCodes(h.sb,h.db.products.map(x=>x.sku),'dept1');
  assert.equal(results.size,10);assert.equal(h.db.calls.length,3);
});
test('lookup is scoped to active products and distinguishes ambiguous UPCs from exact SKUs',async()=>{
  const h=harness();
  h.db.products.push({...h.db.products[0],id:'other',sku:'other',upc:h.db.products[0].upc});
  h.db.products.push({...h.db.products[1],id:'foreign',sku:'foreign',departamento_id:'dept2'});
  const found=await lookupSupportCodes(h.sb,['0200000000001','0012345678','foreign'],'dept1');
  assert.match(found.get('0200000000001').error,/ambiguo/);assert.equal(found.get('0012345678').product.id,'p1');assert.equal(found.get('foreign').product,null);
});
test('location pagination retains all assignments and filters inactive and foreign labels',async()=>{
  const h=harness();
  h.db.marbetes=[];
  for(let i=0;i<505;i++){
    const codigo='ZAP-'+String(i).padStart(4,'0');h.db.marbetes.push({codigo,departamento_id:'dept1',activo:true,zona:'BODEGA'});
    h.db.assignments.push({sku:'0012345678',marbete_codigo:codigo,cantidad:1});
  }
  h.db.marbetes[0].activo=false;h.db.marbetes[1].departamento_id='dept2';
  const found=await lookupSupportCodes(h.sb,['0012345678'],'dept1');
  assert.equal(found.get('0012345678').locations.length,503);assert.ok(h.db.calls.some(x=>x.table==='producto_marbetes'&&x.offset===500));
});
test('equivalent UPCs mapped to different products require an exact SKU',async()=>{
  const h=harness();h.db.products[1].upc='200000000001';
  const found=await lookupSupportCodes(h.sb,['0200000000001'],'dept1');
  assert.equal(found.get('0200000000001').product,null);assert.match(found.get('0200000000001').error,/ambiguo/);
});
test('SKU and UPC scans merge into one row and sum quantities; repeated paste is rejected',async()=>{
  const h=harness();await h.batch.add(one,'first');await h.batch.add([{code:'0200000000001',quantity:2}]);
  assert.equal(h.batch.state.rows.length,1);assert.equal(h.batch.state.rows[0].quantity,3);
  await assert.rejects(h.batch.add(one,'first'),/ya se agregó/);assert.equal(h.batch.state.rows[0].quantity,3);
});
test('rapid queued scans are never discarded and a read failure does not masquerade as missing location',async()=>{
  const h=harness();await Promise.all(Array.from({length:10},()=>h.batch.add(one)));
  assert.equal(h.batch.state.rows[0].quantity,10);assert.equal(h.batch.pending,0);
  h.db.readError={table:'producto_marbetes',message:'Network failed'};
  await assert.rejects(h.batch.add([{code:'0012345679',quantity:1}]),error=>error.message==='Network failed');
  assert.equal(h.batch.state.rows.length,1);
});
test('each row selects and saves a different marbete without changing stock or prior counted quantities',async()=>{
  const h=harness();await h.batch.add([...one,{code:'0012345679',quantity:2}]);
  await h.batch.assign(h.batch.state.rows[0].id,'ZAP-459-001');await h.batch.assign(h.batch.state.rows[1].id,'ZAP-459-002');
  assert.deepEqual(h.batch.state.rows.map(x=>x.location),['ZAP-459-001','ZAP-459-002']);
  assert.equal(h.db.products[0].stock,10);assert.equal(h.db.movements.length,0);assert.ok(h.db.assignments.every(x=>x.cantidad===null));
});
test('wrong-department labels, product barcodes and seller registration cannot be saved',async()=>{
  const h=harness();await h.batch.add(one);const row=h.batch.state.rows[0];
  h.db.marbetes.push({codigo:'OTHER',departamento_id:'dept2',activo:true,zona:'BODEGA'});
  await assert.rejects(h.batch.assign(row.id,'OTHER'),/otro departamento/);
  await assert.rejects(h.batch.assign(row.id,'0200000000001'),/artículo/);
  await assert.rejects(h.batch.assign(row.id,'NEW','BODEGA',false),/administrador/);
  assert.equal(h.db.assignments.length,0);
});
test('review refreshes stock and blocks shortages or unresolved codes before any movement',async()=>{
  const h=harness();await h.batch.add(one);h.db.products[0].stock=0;
  await assert.rejects(h.batch.review(),/pendientes/);assert.match(lineIssue(h.batch.state.rows[0],'dept1'),/insuficiente/);
  assert.equal(h.db.rpcCalls.length,0);
  await h.batch.add([{code:'MISSING',quantity:1}]);await assert.rejects(h.batch.review(),/pendientes/);
});
test('per-location shortages block the row even with sufficient total stock',async()=>{
  const h=harness({assignments:[{sku:'0012345678',marbete_codigo:'ZAP-459-001',cantidad:1}]});
  await h.batch.add([{code:'0012345678',quantity:2}]);await assert.rejects(h.batch.review(),/pendientes/);
  assert.match(lineIssue(h.batch.state.rows[0],'dept1'),/solo tiene 1/);assert.equal(h.db.rpcCalls.length,0);
});
test('one confirmation registers multiple products, preserves counted marbetes, and double clicks never repeat a send',async()=>{
  const h=harness({assignments:[{sku:'0012345678',marbete_codigo:'ZAP-459-001',cantidad:10},{sku:'0012345679',marbete_codigo:'ZAP-459-002',cantidad:10}]});
  await h.batch.add([...one,{code:'0012345679',quantity:3}]);await h.batch.review();
  await Promise.all([h.batch.submit(),h.batch.submit()]);
  assert.equal(h.db.rpcCalls.length,2);assert.equal(h.db.movements.length,2);assert.deepEqual(h.db.products.map(x=>x.stock),[9,7]);
  assert.deepEqual(h.db.assignments.map(x=>x.cantidad),[9,7]);assert.ok(h.batch.state.rows.every(x=>x.status==='done'));
  assert.ok(h.db.rpcCalls.every(x=>x.p_nota.includes(h.batch.state.id)&&x.p_nota.includes('Empleado 123')));
});
test('reference-only locations require explicit acknowledgment, keep reference in note and never invent a counted quantity',async()=>{
  const h=harness();await h.batch.add(one);await h.batch.assign(h.batch.state.rows[0].id,'ZAP-459-001');await h.batch.review();
  await assert.rejects(h.batch.submit(),/Confirma/);assert.equal(h.db.rpcCalls.length,0);
  await h.batch.submit({acknowledgeTotalOnly:true});
  assert.equal(h.db.rpcCalls[0].p_marbete,null);assert.match(h.db.rpcCalls[0].p_nota,/Marbete de referencia: ZAP-459-001/);
  assert.equal(h.db.assignments[0].cantidad,null);assert.equal(h.db.products[0].stock,9);
});
test('lost committed responses are reconciled from history without resending',async()=>{
  const h=harness({rpcError:{message:'Failed to fetch'},commitWithError:true});await h.batch.add(one);await h.batch.review();
  await h.batch.submit({acknowledgeTotalOnly:true});
  assert.equal(h.batch.state.rows[0].status,'done');assert.equal(h.db.rpcCalls.length,1);assert.equal(h.db.products[0].stock,9);
});
test('an acknowledged transaction needs no extra history permission for seller success',async()=>{
  const h=harness({readError:{table:'movimientos',code:'42501',message:'permission denied'}});
  await h.batch.add(one);await h.batch.review();await h.batch.submit({acknowledgeTotalOnly:true});
  assert.equal(h.batch.state.rows[0].status,'done');assert.equal(h.db.rpcCalls.length,1);
  assert.equal(h.db.calls.filter(x=>x.table==='movimientos').length,0);
});
test('unconfirmed requests freeze their row across reload; verification never sends a new movement',async()=>{
  const h=harness({rpcError:{message:'Network response lost'}});await h.batch.add(one);await h.batch.review();
  await assert.rejects(h.batch.submit({acknowledgeTotalOnly:true}),/confirmación|confirm/);
  assert.equal(h.batch.state.rows[0].status,'uncertain');
  const recovered=new SupportBatch(h.options);assert.equal(recovered.state.rows[0].status,'uncertain');
  recovered.edit(recovered.state.rows[0].id,'quantity',2);assert.equal(recovered.state.rows[0].quantity,1);
  await recovered.verify();assert.equal(h.db.rpcCalls.length,1);assert.equal(recovered.state.rows[0].status,'uncertain');
  await assert.rejects(recovered.review(),/pendientes/);assert.throws(()=>recovered.newBatch(),/pendientes/);
});
test('a verified partial batch resumes only remaining draft rows after a server rejection',async()=>{
  const h=harness();await h.batch.add([...one,{code:'0012345679',quantity:1}]);await h.batch.review();
  const original=h.sb.rpc;
  h.sb.rpc=(name,payload)=>payload.p_producto==='p2'?{abortSignal(){return this;},then(resolve){return Promise.resolve({data:null,error:{code:'P0001',message:'Stock insuficiente'}}).then(resolve);}}:original(name,payload);
  await assert.rejects(h.batch.submit({acknowledgeTotalOnly:true}),/rechazada/);
  assert.deepEqual(h.batch.state.rows.map(x=>x.status),['done','draft']);
  h.sb.rpc=original;await h.batch.review();await h.batch.submit({acknowledgeTotalOnly:true});
  assert.equal(h.db.rpcCalls.length,2);assert.deepEqual(h.db.products.map(x=>x.stock),[9,9]);
});
test('offline review, missing persistent storage and stale tabs cannot dispatch stock changes',async()=>{
  const h=harness();await h.batch.add(one);h.batch.online=()=>false;
  await assert.rejects(h.batch.review(),/conexión/);assert.equal(h.db.rpcCalls.length,0);
  h.batch.online=()=>true;await h.batch.review();const second=new SupportBatch(h.options);second.setNote('Cambio en otra pestaña');
  await assert.rejects(h.batch.submit({acknowledgeTotalOnly:true}),/pestaña/);assert.equal(h.db.rpcCalls.length,0);
  h.batch.sync();await h.batch.review();h.storage.setItem=()=>{throw Error('quota');};
  await assert.rejects(h.batch.submit({acknowledgeTotalOnly:true}),/borrador/);assert.equal(h.db.rpcCalls.length,0);
});
test('two tabs cannot submit the same batch, even without backend idempotency',async()=>{
  const h=harness();await h.batch.add(one);const second=new SupportBatch(h.options);
  await h.batch.review();second.sync();await second.review();h.batch.sync();await h.batch.review();
  second.confirmation={rows:1,pieces:1,totalOnly:1};
  const outcomes=await Promise.allSettled([h.batch.submit({acknowledgeTotalOnly:true}),second.submit({acknowledgeTotalOnly:true})]);
  assert.ok(outcomes.some(x=>x.status==='rejected'));assert.equal(h.db.rpcCalls.length,1);assert.equal(h.db.products[0].stock,9);
});
test('drafts are isolated by department and operator and a completed batch can start afresh',async()=>{
  const h=harness();await h.batch.add(one);
  assert.equal(new SupportBatch({...h.options,deptId:'dept2'}).state.rows.length,0);
  assert.equal(new SupportBatch({...h.options,actor:'Empleado 456'}).state.rows.length,0);
  await h.batch.review();await h.batch.submit({acknowledgeTotalOnly:true});const priorId=h.batch.state.id;
  h.batch.newBatch();assert.notEqual(h.batch.state.id,priorId);assert.equal(h.batch.state.rows.length,0);
  await h.batch.add(one);assert.equal(h.batch.state.rows[0].quantity,1);assert.equal(h.db.products[0].stock,9);
});
