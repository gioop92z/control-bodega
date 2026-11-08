import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

export const people = Array.from({length:8}, (_, i) => 'a1000000-0000-4000-8000-' + String(i+1).padStart(12,'0'));
export const devices = people.map((_, i) => ({id:crypto.randomUUID(),label:'Dispositivo '+(i+1)}));
export const dept = 'b1000000-0000-4000-8000-000000000001';
export const marbete = 'ZAP-402-001';
export const sku = '000750001';
export const row = (box='', qty=1, code=sku) => ({
  floor:'',date:'',section:'402',manifest:'PRUEBA',box,description:'Artículo de prueba',
  sku:code,qty,price:'',supplier:'',upc:'',brand:'',
});
export const event = (kind, more={}) => ({kind,id:crypto.randomUUID(),at:new Date().toISOString(),...more});
export const scan = (kind, code, box) => event(kind,{code,box,source:'Lector'});

export async function createDatabase(url = process.env.VANIFS_TEST_DATABASE_URL) {
  if (url) {
    const target = new URL(url);
    if (!['127.0.0.1','localhost'].includes(target.hostname) || target.pathname !== '/vanifs_qa') {
      throw new Error('Use a disposable local database named vanifs_qa.');
    }
  }
  const db = url ? new pg.Pool({connectionString:url,max:12}) : new PGlite();
  const run = sql => url ? db.query(sql) : db.exec(sql);
  await run(`
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated;
  `);
  for (const migration of ['20261019000000_vantis_base_nueva_instancia.sql','20261019000001_vantis_rpc_base.sql','20261108073356_vanifs_integrado.sql']) {
    await run(await readFile(new URL('../../supabase/migrations/'+migration,import.meta.url),'utf8'));
  }
  for (const [i,id] of people.entries()) {
    const email = i===7 ? '10@bodega.local' : 'pruebas'+i+'@gmail.com';
    await db.query('INSERT INTO auth.users VALUES($1,$2,clock_timestamp())',[id,email]);
    if (i<6) await db.query('INSERT INTO vanifs_private.operators(user_id,name,role,can_close,employee_number,owner) VALUES($1,$2,$3,$4,$5,$6)',
      [id,'Operador '+i,i===0?'admin':i===5?'supervisor':'collaborator',i===5,i===0?'16640000':null,i===0]);
  }
  await db.query('INSERT INTO public.departamentos(id,nombre) VALUES($1,$2)',[dept,'Zapatería de prueba']);
  await db.query("INSERT INTO public.vantis_operadores_v4 VALUES($1,$2,'admin')",[people[0],dept]);
  await db.query("INSERT INTO public.productos(departamento_id,sku,stock) VALUES($1,$2,37)",[dept,sku]);
  await db.query("INSERT INTO public.marbetes(codigo,departamento_id) VALUES($1,$2)",[marbete,dept]);
  async function as(i,sql,params=[]) {
    const args = [people[i]??''];
    async function execute(client) {
      await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",args);
      await client.query(i===null ? 'SET LOCAL ROLE anon' : 'SET LOCAL ROLE authenticated');
      return client.query(sql,params);
    }
    if (!url) return db.transaction(execute);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await execute(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  const rpc = (i,route,action,data={}) => as(i,'SELECT public.vanifs_api($1,$2,$3::jsonb) AS data',[route,action,JSON.stringify(data)]).then(r=>r.rows[0].data);
  const create = async (rows,by=0,title='Recepción de prueba',id=crypto.randomUUID()) =>
    (await rpc(by,'receipt','create',{id,title,file:'prueba.csv',rows})).receipt;
  const append = (i,id,ops,after=0,more={}) => rpc(i,'receipt','append',{id,ops,after,device:devices[i],remaining:0,...more});
  const close = (i,receipt,more={}) => rpc(i,'receipt','close',{
    id:receipt.id,revision:receipt.revision,device:devices[i],acknowledged:true,note:'Diferencias comprobadas en bodega.',...more,
  });
  return {db,as,rpc,create,append,close,end:()=>url?db.end():db.close(),engine:url?'PostgreSQL 17, conexiones independientes':'PostgreSQL aislado en PGlite'};
}
