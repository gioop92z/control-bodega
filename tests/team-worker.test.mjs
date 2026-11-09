// Contract-level Cloudflare Worker tests against actual SQLite semantics.
// Runs in Node 22 with no Cloudflare credentials or production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import worker from '../cloudflare/worker.mjs';

function createD1(){
  const db=new DatabaseSync(':memory:');
  db.exec((awaitableSchema()).replace(/^--.*$/mg,'')); // plain SQLite schema
  function statement(sql,args=[]){
    return {
      sql,args,
      bind(...values){return statement(sql,values);},
      async first(){return db.prepare(sql).get(...args)||null;},
      async all(){return {results:db.prepare(sql).all(...args)};},
      async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:r.changes}};}
    };
  }
  return {prepare(sql){return statement(sql);},async batch(statements){
    db.exec('BEGIN IMMEDIATE');
    try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}
    catch(e){db.exec('ROLLBACK');throw e;}
  },direct:db};
}
// top-level await loaded before tests; keep createD1 synchronous.
const SCHEMA=await readFile(new URL('../cloudflare/schema.sql',import.meta.url),'utf8');
function awaitableSchema(){return SCHEMA;}
const env={
  DB:createD1(),
  ALLOWED_ORIGIN:'https://gioop92z.github.io',
  AUTH_SECRET:'a'.repeat(48),
  VANTIS_SETUP_KEY:'b'.repeat(48)
};
async function api(path,{method='GET',body,token,origin=env.ALLOWED_ORIGIN}={}){
  const h={origin};
  if(token)h.authorization='Bearer '+token;
  if(body)h['content-type']='application/json';
  const req=new Request('https://vantis-team.example'+path,{method,headers:h,body:body?JSON.stringify(body):undefined});
  const response=await worker.fetch(req,env);
  return {status:response.status,data:await response.json().catch(()=>null)};
}
const send=(path,body,token)=>api(path,{method:'POST',body,token});
const empA='16647310',empB='16647311';
let admin,scanner,viewer;
test('bootstrap requires installation key, individual PINs and verified user roles',async()=>{
  let r=await send('/api/bootstrap',{key:'bad',employee:empA,name:'Jefa',pin:'87654321'});
  assert.equal(r.status,403);
  r=await send('/api/bootstrap',{key:env.VANTIS_SETUP_KEY,employee:empA,name:'Jefa',pin:'87654321'});
  assert.equal(r.status,201);
  r=await send('/api/bootstrap',{key:env.VANTIS_SETUP_KEY,employee:empA,name:'Jefa',pin:'87654321'});
  assert.equal(r.status,409);
  r=await send('/api/login',{employee:empA,pin:'incorrect'});
  assert.equal(r.status,401);
  r=await send('/api/login',{employee:empA,pin:'87654321'});
  assert.equal(r.status,200);admin=r.data.token;
  r=await send('/api/people',{employee:empB,name:'Escáner',pin:'12345678',role:'scanner'},admin);
  assert.equal(r.status,201);
  r=await send('/api/people',{employee:'16647312',name:'Gerente',pin:'23456789',role:'viewer'},admin);
  assert.equal(r.status,201);
  scanner=(await send('/api/login',{employee:empB,pin:'12345678'})).data.token;
  viewer=(await send('/api/login',{employee:'16647312',pin:'23456789'})).data.token;
  r=await send('/api/products',{code:'1200768635'},viewer);
  assert.equal(r.status,403,'viewer never writes inventory');
  r=await api('/api/summary',{token:viewer});
  assert.equal(r.status,200);
  r=await api('/api/summary',{origin:'https://attacker.example',token:viewer});
  assert.equal(r.status,403);
  r=await api('/api/summary');
  assert.equal(r.status,401);
});
test('two devices share stock; repeated event ID never increases it twice',async()=>{
  const code='1200768635';
  let r=await send('/api/labels',{code:'ZAP-402-001'},scanner);
  assert.equal(r.status,200);
  r=await send('/api/products',{code},scanner);
  assert.equal(r.status,200);
  const payload={p_id:crypto.randomUUID(),p_sesion:crypto.randomUUID(),
    p_departamento:'ZAPATERIA INFANTIL',p_producto:code,p_marbete:'ZAP-402-001',
    p_operador:'Empleado '+empB,p_leida_en:new Date().toISOString(),p_reversa:null};
  const one=await send('/api/receipts',payload,scanner);
  assert.equal(one.status,200,JSON.stringify(one.data));
  assert.equal(one.data.stock_resultante,1);
  assert.equal(one.data.user_id,empB);
  const twice=await send('/api/receipts',payload,scanner);
  assert.deepEqual(twice.data,one.data);
  const boss=await api('/api/search?q=1200768635',{token:viewer});
  assert.equal(boss.status,200);
  assert.deepEqual(boss.data.items[0].ubicaciones,[{marbete:'ZAP-402-001',cantidad:1}]);
  const changed={...payload,p_producto:'99999999'};
  const collision=await send('/api/receipts',changed,scanner);
  assert.equal(collision.status,409);
  const otherUser=await send('/api/receipts',payload,admin);
  assert.equal(otherUser.status,409,'another user cannot take over an event');
  const undo={...payload,p_id:crypto.randomUUID(),p_reversa:payload.p_id};
  const reversed=await send('/api/receipts',undo,scanner);
  assert.equal(reversed.status,200,JSON.stringify(reversed.data));
  assert.equal(reversed.data.stock_resultante,0);
  const again=await send('/api/receipts',{...undo,p_id:crypto.randomUUID()},scanner);
  assert.equal(again.status,422,'same original cannot be undone twice');
});
test('stress: 10,000 independent reads across 100 marbetes; exact totals and locations',async()=>{
  const code='1200768635',session=crypto.randomUUID();
  let result;
  for(let i=1;i<=100;i++){
    const label='ZAP-402-'+String(i).padStart(3,'0');
    result=await send('/api/labels',{code:label},scanner);
    assert.equal(result.status,200);
    for(let j=0;j<100;j++){
      result=await send('/api/receipts',{
        p_id:crypto.randomUUID(),p_sesion:session,p_departamento:'ZAPATERIA INFANTIL',
        p_producto:code,p_marbete:label,p_operador:'Empleado '+empB,
        p_leida_en:new Date().toISOString(),p_reversa:null
      },scanner);
      assert.equal(result.status,200,JSON.stringify(result.data));
    }
  }
  const s=await api('/api/summary',{token:viewer});
  assert.deepEqual(s.data,{products:1,labels:100,receipts:10002,units:10000});
  const exact=env.DB.direct.prepare('SELECT label,quantity FROM assignments ORDER BY label').all();
  assert.equal(exact.length,100);
  assert.ok(exact.every(x=>x.quantity===100));
  assert.equal(env.DB.direct.prepare('SELECT count(DISTINCT id) AS c FROM receipts').get().c,10002);
  const target=await api('/api/search?q=402-010',{token:admin});
  assert.equal(target.status,200);
  assert.equal(target.data.items[0].stock,10000);
  assert.ok(target.data.items[0].ubicaciones.some(x=>x.marbete==='ZAP-402-010'));
});

test('admin migration copies original scan UUIDs and retries cannot double stock',async()=>{
  const code='123456789012',label='ZAP-459-777',session=crypto.randomUUID();
  const first={p_id:crypto.randomUUID(),p_sesion:session,
    p_departamento:'ZAPATERIA INFANTIL',p_producto:code,p_marbete:label,
    p_operador:'Empleado 16647313',p_leida_en:new Date().toISOString(),p_reversa:null};
  const undo={...first,p_id:crypto.randomUUID(),p_reversa:first.p_id};
  const items=[first,undo].map(p=>({payload:p,receipt:{id:p.p_id}}));
  let r=await send('/api/import',{items},viewer);
  assert.equal(r.status,403,'a viewer cannot import inventory');
  r=await send('/api/import',{items},admin);
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.imported,2);
  r=await send('/api/import',{items},admin);
  assert.equal(r.status,200);
  assert.equal(r.data.imported,0);
  assert.equal(r.data.repeated,2);
  const query=await api('/api/search?q='+code,{token:viewer});
  assert.equal(query.data.items[0].stock,0);
  assert.equal(env.DB.direct.prepare('SELECT count(*) AS c FROM receipts WHERE id IN (?,?)')
    .get(first.p_id,undo.p_id).c,2);
  assert.equal(env.DB.direct.prepare('SELECT count(*) AS c FROM receipts WHERE operator_label=?')
    .get(first.p_operador).c,2,'original operator retained for audit');
});
