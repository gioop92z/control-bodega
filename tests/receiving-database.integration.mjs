import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import pg from 'pg';

// CI uses a disposable PostgreSQL service for real multi-connection locking.
// PGlite runs the identical migration locally when no DATABASE_URL is supplied.
const remote=Boolean(process.env.VANTIS_TEST_DATABASE_URL);
const db=remote?new pg.Pool({connectionString:process.env.VANTIS_TEST_DATABASE_URL,max:12}):new PGlite();
const U='10000000-0000-0000-0000-000000000001',U2='10000000-0000-0000-0000-000000000002';
const D='20000000-0000-0000-0000-000000000001',D2='20000000-0000-0000-0000-000000000002';
const P='30000000-0000-0000-0000-000000000001';
const exec=sql=>remote?db.query(sql):db.exec(sql);
await exec(await readFile(new URL('./helpers/receiving-schema.sql',import.meta.url),'utf8'));
const migration=await readFile(new URL('../supabase/migrations/20261020000020_continuous_receiving.sql',import.meta.url),'utf8');
await exec(migration);
after(()=>remote?db.end():db.close());
let tail=Promise.resolve();
async function query(sql,params=[],user=U,role='authenticated') {
  async function perform(){
    const client=remote?await db.connect():db;
    try{
      await client.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user||'']);
      await client.query('SET ROLE '+role);
      return await client.query(sql,params);
    }finally{await client.query('RESET ROLE');if(remote)client.release();}
  }
  if(remote)return perform();
  const result=tail.then(perform);tail=result.catch(()=>{});return result;
}
const admin=(sql,params=[])=>db.query(sql,params);
const payload=(product=P,overrides={})=>({p_id:crypto.randomUUID(),p_sesion:crypto.randomUUID(),p_departamento:D,p_producto:product,p_marbete:'ZAP-402-001',p_operador:'Empleado PRUEBA',p_leida_en:'2026-10-20T00:00:00Z',p_reversa:null,...overrides});
const receive=(p,user=U)=>query('SELECT public.vantis_recibir_pieza_v1($1,$2,$3,$4,$5,$6,$7,$8) AS receipt',Object.values(p),user).then(r=>r.rows[0].receipt);
async function product(){const id=crypto.randomUUID(),sku='FIXTURE-'+id;await admin('INSERT INTO public.productos(id,departamento_id,sku,upc,stock,activo) VALUES($1,$2,$3,$3,13,true)',[id,D,sku]);return {id,sku};}

test('migration preserves existing product/location quantities and denies unauthenticated callers',async()=>{
  assert.equal(Number((await admin('SELECT stock FROM public.productos WHERE id=$1',[P])).rows[0].stock),37);
  assert.equal(Number((await admin("SELECT cantidad FROM public.producto_marbetes WHERE sku='PRESERVAR'")).rows[0].cantidad),11);
  await assert.rejects(query('SELECT public.vantis_recepcion_estado_v1()',[],null,'anon'),error=>error.code==='42501');
  await assert.rejects(query('SELECT public.vantis_recepcion_estado_v1()',[],'10000000-0000-0000-0000-000000000003'),error=>error.code==='42501');
  await assert.rejects(query('SELECT * FROM vantis_recepcion.lecturas'),error=>error.code==='42501');
  const result=await query('SELECT public.vantis_recepcion_estado_v1() AS status');assert.deepEqual(result.rows[0].status,{version:1,atomic:true,idempotent:true});
});

for(const size of [100,500,1000])test(`SQL migration commits ${size} pieces and exact location stock (${remote?'PostgreSQL pool':'PGlite'})`,async()=>{
  const p=await product(),session=crypto.randomUUID();
  const reads=Array.from({length:size},()=>payload(p.id,{p_sesion:session}));
  const replies=await Promise.all(reads.map(read=>receive(read)));
  assert.equal(new Set(replies.map(row=>row.id)).size,size);
  assert.equal(Number((await admin('SELECT stock FROM public.productos WHERE id=$1',[p.id])).rows[0].stock),13+size);
  assert.equal(Number((await admin('SELECT cantidad FROM public.producto_marbetes WHERE sku=$1',[p.sku])).rows[0].cantidad),size);
  assert.equal(Number((await admin('SELECT count(*) FROM public.movimientos WHERE sku=$1',[p.sku])).rows[0].count),size);
});

test('concurrent retries of one ID return one receipt and one inventory increment',async()=>{
  const p=await product(),read=payload(p.id);
  const replies=await Promise.all(Array.from({length:40},()=>receive(read)));
  assert.ok(replies.every(row=>JSON.stringify(row)===JSON.stringify(replies[0])));
  assert.equal(Number((await admin('SELECT stock FROM public.productos WHERE id=$1',[p.id])).rows[0].stock),14);
  await assert.rejects(receive({...read,p_operador:'Otro operador'}),error=>error.code==='22023');
  assert.equal(Number((await admin('SELECT stock FROM public.productos WHERE id=$1',[p.id])).rows[0].stock),14);
});

test('two authenticated employees and two locations share atomic product stock',async()=>{
  const p=await product();
  const replies=await Promise.all(Array.from({length:100},(_,i)=>receive(payload(p.id,{p_marbete:i%2?'ZAP-402-002':'ZAP-402-001',p_operador:'Empleado '+(i%2)}),i%2?U2:U)));
  assert.equal(replies.length,100);
  assert.equal(Number((await admin('SELECT stock FROM public.productos WHERE id=$1',[p.id])).rows[0].stock),113);
  const rows=(await admin('SELECT cantidad FROM public.producto_marbetes WHERE sku=$1 ORDER BY marbete_codigo',[p.sku])).rows;
  assert.deepEqual(rows.map(row=>Number(row.cantidad)),[50,50]);
});

test('a compensation is auditable, idempotent and cannot be submitted by another account',async()=>{
  const p=await product(),original=payload(p.id);await receive(original);
  const undo={...original,p_id:crypto.randomUUID(),p_reversa:original.p_id};
  await assert.rejects(receive(undo,U2),error=>error.code==='22023');
  const replies=await Promise.all([receive(undo),receive(undo)]);assert.equal(replies[0].kind,'undo');
  await assert.rejects(receive({...undo,p_id:crypto.randomUUID()}),error=>error.code==='22023');
  assert.equal(Number((await admin('SELECT stock FROM public.productos WHERE id=$1',[p.id])).rows[0].stock),13);
  assert.equal(Number((await admin('SELECT count(*) FROM public.movimientos WHERE sku=$1',[p.sku])).rows[0].count),2);
});

test('invalid, foreign, inactive and product barcodes cannot be new locations',async()=>{
  await assert.rejects(query('SELECT public.vantis_activar_marbete_v1($1,$2)',[D,'1200768112']),error=>error.code==='22023');
  await admin("INSERT INTO public.marbetes(codigo,departamento_id,zona,activo) VALUES('ZAP-405-888',$1,'BODEGA',true),('ZAP-405-889',$2,'BODEGA',false)",[D2,D]);
  for(const code of ['ZAP-405-888','ZAP-405-889'])await assert.rejects(query('SELECT public.vantis_activar_marbete_v1($1,$2)',[D,code]),error=>error.code==='22023');
  await admin("INSERT INTO public.productos(id,departamento_id,sku,stock,activo) VALUES($1,$2,'402-777',0,true)",[crypto.randomUUID(),D]);
  await assert.rejects(query('SELECT public.vantis_activar_marbete_v1($1,$2)',[D,'402-777']),error=>error.code==='22023');
  assert.equal(Number((await admin("SELECT count(*) FROM public.marbetes WHERE codigo='ZAP-402-777'")).rows[0].count),0);
});

test('legacy marbetes are reused, and a canonical new marbete is registered once',async()=>{
  await admin("INSERT INTO public.marbetes(codigo,departamento_id,zona,activo) VALUES('459-876',$1,'BODEGA',true)",[D]);
  const result=await query('SELECT public.vantis_activar_marbete_v1($1,$2) AS location',[D,'ZAP-459-876']);assert.equal(result.rows[0].location.codigo,'459-876');
  await Promise.all(Array.from({length:10},()=>query('SELECT public.vantis_activar_marbete_v1($1,$2)',[D,'402-987'])));
  assert.equal(Number((await admin("SELECT count(*) FROM public.marbetes WHERE codigo='ZAP-402-987'")).rows[0].count),1);
});

test('a broken legacy movement RPC rolls back stock, assignment and ledger together',async()=>{
  const p=await product();
  // A separate incompatible fixture models a server that cannot meet the
  // contract. The wrapper must fail closed, never acknowledge partial work.
  await admin("CREATE OR REPLACE FUNCTION public.mover_stock_v2(p_token text,p_id uuid,p_producto uuid,p_tipo text,p_cantidad integer,p_marbete text,p_nota text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN UPDATE public.productos SET stock=stock+2 WHERE id=p_producto; RETURN '{}'::jsonb; END; $$");
  const read=payload(p.id);await assert.rejects(receive(read),error=>error.code==='P0001');
  assert.equal(Number((await admin('SELECT stock FROM public.productos WHERE id=$1',[p.id])).rows[0].stock),13);
  assert.equal(Number((await admin('SELECT count(*) FROM public.producto_marbetes WHERE sku=$1',[p.sku])).rows[0].count),0);
  assert.equal(Number((await admin('SELECT count(*) FROM vantis_recepcion.lecturas WHERE id=$1',[read.p_id])).rows[0].count),0);
});
