import test from 'node:test';
import assert from 'node:assert/strict';
import {LegacyReceiptApi} from '../legacy-receipt-api.mjs';
import {SupabaseReceiptApi} from '../continuous-receive.mjs';

function server({modern=false,lost=false}={}){
  const db={
    departments:[{id:'dept1',activo:true}],
    products:[{id:'item1',sku:'SKU-001',departamento_id:'dept1',activo:true,stock:10}],
    labels:[{codigo:'ZAP-402-001',departamento_id:'dept1',activo:true,zona:'BODEGA'}],
    assignments:[],movements:[],writes:0
  };
  function table(name){return {departamentos:db.departments,productos:db.products,marbetes:db.labels,
    producto_marbetes:db.assignments,movimientos:db.movements}[name];}
  function query(name,operation='select',input){
    const filters={};
    const q={
      select(){return q;},eq(k,v){filters[k]=v;return q;},maybeSingle(){return q;},
      upsert(row){return query(name,'upsert',row);},insert(row){return query(name,'insert',row);},
      async abortSignal(){
        if(operation==='select'){
          const found=table(name).find(row=>Object.entries(filters).every(([key,val])=>row[key]===val))||null;
          return {data:found,error:null};
        }
        if(operation==='upsert'){
          const old=db.assignments.find(row=>row.sku===input.sku&&row.marbete_codigo===input.marbete_codigo);
          if(!old)db.assignments.push({...input});
        }else table(name).push(input);
        return {data:null,error:null};
      }
    };return q;
  }
  const sb={
    from(name){return query(name);},
    rpc(name,args){
      return {async abortSignal(){
        if(name==='vantis_recepcion_estado_v1')
          return modern
            ?{data:{version:1,atomic:true,idempotent:true},error:null}
            :{data:null,error:{code:'PGRST202',message:'Missing RPC'}};
        if(name!=='mover_stock_v2')throw Error('unexpected RPC '+name);
        db.writes++;
        const product=db.products.find(row=>row.id===args.p_producto);
        assert.ok(product);
        assert.equal(args.p_cantidad,1);
        product.stock++;
        const assignment=db.assignments.find(row=>row.sku===product.sku&&row.marbete_codigo===args.p_marbete);
        assert.ok(assignment);
        assignment.cantidad=(assignment.cantidad||0)+1;
        db.movements.push({id:args.p_id,tipo:'ENTRADA',sku:product.sku,cantidad:1,
          departamento_id:'dept1',marbete_codigo:args.p_marbete,
          stock_resultante:product.stock,user_id:'user1',created_at:new Date().toISOString()});
        if(lost){lost=false;throw Error('Network response was lost');}
        return {data:{stock_resultante:product.stock},error:null};
      }};
    }
  };
  return {db,sb};
}
const payload=Object.freeze({p_id:'00000000-0000-4000-8000-000000000111',
  p_sesion:'00000000-0000-4000-8000-000000000222',p_departamento:'dept1',
  p_producto:'item1',p_marbete:'ZAP-402-001',p_operador:'Empleado 123',
  p_leida_en:'2026-10-19T19:00:00.000Z',p_reversa:null});
const opts={allowWrite:true,sku:'SKU-001',userId:'user1'};

test('legacy capability is distinctly non-atomic and never lies about idempotency',async()=>{
  const {sb,db}=server();const api=new SupabaseReceiptApi(sb,'dept1');
  const caps=await api.capabilities();
  assert.deepEqual(caps,{version:1,mode:'legacy',atomic:false,idempotent:false,guarded:true});
  assert.equal(api.mode,'legacy');assert.equal(db.writes,0);
  const m=await api.activate('ZAP-402-001');
  assert.equal(m.codigo,'ZAP-402-001');
});

test('new migration remains preferred when it is installed',async()=>{
  const {sb}=server({modern:true});const api=new SupabaseReceiptApi(sb,'dept1');
  assert.deepEqual(await api.capabilities(),{version:1,atomic:true,idempotent:true});
  assert.equal(api.mode,'modern');
});

test('legacy first send increments one unit and a retry only reads its receipt',async()=>{
  const {sb,db}=server();const api=new LegacyReceiptApi(sb,'dept1');
  const reply=await api.receive(payload,opts);
  assert.equal(reply.id,payload.p_id);assert.equal(reply.kind,'receive');
  assert.equal(reply.stock_resultante,11);assert.equal(db.products[0].stock,11);
  assert.equal(db.assignments[0].cantidad,1);assert.equal(db.writes,1);
  const retry=await api.receive(payload,{...opts,allowWrite:false});
  assert.deepEqual(retry,reply);assert.equal(db.writes,1);
});

test('a committed response lost over network can be reconciled without a second write',async()=>{
  const {sb,db}=server({lost:true});const api=new LegacyReceiptApi(sb,'dept1');
  await assert.rejects(()=>api.receive(payload,opts),/Network response was lost/);
  assert.equal(db.writes,1);assert.equal(db.products[0].stock,11);
  const verified=await api.receive(payload,{...opts,allowWrite:false});
  assert.equal(verified.stock_resultante,11);assert.equal(db.writes,1);
});

test('an uncertain request is never blindly resent and cannot invent a receipt',async()=>{
  const {sb,db}=server();const api=new LegacyReceiptApi(sb,'dept1');
  await assert.rejects(()=>api.receive(payload,{...opts,allowWrite:false}),/No se encontró el recibo/);
  assert.equal(db.writes,0);
});

test('conflicting movement identifiers and automated undo fail closed',async()=>{
  const {sb,db}=server();const api=new LegacyReceiptApi(sb,'dept1');
  db.movements.push({id:payload.p_id,tipo:'SALIDA',sku:'SKU-001',cantidad:1,
    departamento_id:'dept1',marbete_codigo:'ZAP-402-001',
    stock_resultante:9,user_id:'user1',created_at:new Date().toISOString()});
  await assert.rejects(()=>api.receive(payload,opts),/no coincide/);
  await assert.rejects(()=>api.receive({...payload,p_reversa:payload.p_id},opts),/incompatible/);
  assert.equal(db.writes,0);
});
