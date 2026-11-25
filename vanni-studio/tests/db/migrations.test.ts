import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SUPABASE_STUB, adaptMigration } from './supabase-stub';

const dir = join(__dirname, '../../supabase/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

let db: PGlite;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}

async function createOwner(uid: string, email: string) {
  const token = 'claim-token-' + uid.replace(/-/g, '') ;
  await db.query(`select public.svc_signup_token_create(encode(extensions.digest($1, 'sha256'), 'hex'), 120)`, [token]);
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object('vanni_claim', $3::text))`, [uid, email, token]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  // PGlite no trae pgcrypto: emulamos digest(sha256) y gen_random_bytes con funciones nativas.
  await db.exec(`
    create function extensions.digest(text, text) returns bytea language sql immutable as $$ select sha256(convert_to($1, 'UTF8')) $$;
    create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as $$
      select substring(decode(string_agg(replace(gen_random_uuid()::text, '-', ''), ''), 'hex') from 1 for n)
      from generate_series(1, (n / 16) + 1)
    $$;
  `);
  for (const f of files) {
    await db.exec(adaptMigration(readFileSync(join(dir, f), 'utf8')));
  }
}, 60_000);

describe('migraciones VANNI STUDIO', () => {
  it('crea todas las tablas con RLS activo', async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`);
    expect(r.rows.length).toBeGreaterThanOrEqual(38);
    for (const row of r.rows) expect(row.relrowsecurity, row.relname).toBe(true);
  });

  it('bloquea el registro público sin autorización de alta', async () => {
    await expect(db.query(`insert into auth.users (email) values ('intruso@example.com')`)).rejects.toThrow(/registro público está cerrado/);
  });

  it('permite exactamente una cuenta propietaria', async () => {
    await createOwner(A, 'owner@example.com');
    const owner = await db.query<{ user_id: string }>('select user_id from public.svc_owner_info()');
    expect(owner.rows[0].user_id).toBe(A);
    const meta = await db.query<{ m: unknown }>('select raw_user_meta_data as m from auth.users where id = $1', [A]);
    expect(meta.rows[0].m).toEqual({});
    await expect(createOwner(B, 'second@example.com')).rejects.toThrow(/ya existe la cuenta propietaria/);
    const profile = await db.query('select * from public.profiles where user_id = $1', [A]);
    expect(profile.rows.length).toBe(1);
  });

  it('aísla los datos por usuario (RLS)', async () => {
    // Usuario B creado directamente (simula un segundo usuario si el guardia se retirara).
    await db.exec(`alter table auth.users disable trigger vanni_guard_signup; alter table auth.users disable trigger vanni_after_signup;`);
    await db.query(`insert into auth.users (id, email) values ($1, 'b@example.com')`, [B]);
    await db.exec(`alter table auth.users enable trigger vanni_guard_signup; alter table auth.users enable trigger vanni_after_signup;`);
    await asUser(A, () => db.query(`insert into public.series (title) values ('THE IRON HUNT')`));
    const seenByB = await asUser(B, () => db.query('select * from public.series'));
    expect(seenByB.rows.length).toBe(0);
    const seenByA = await asUser(A, () => db.query<{ user_id: string }>('select * from public.series'));
    expect(seenByA.rows.length).toBe(1);
    expect(seenByA.rows[0].user_id).toBe(A);
    await expect(asUser(B, () => db.query(`insert into public.series (user_id, title) values ($1, 'x')`, [A]))).rejects.toThrow();
  });

  it('impide que el cliente escriba estadísticas de Instagram', async () => {
    await expect(asUser(A, () => db.query(`insert into public.ig_media (user_id, ig_user_id, ig_media_id) values ($1, '1', '2')`, [A]))).rejects.toThrow(/permission denied/);
    await expect(asUser(A, () => db.query(`select public.svc_token_get($1)`, [A]))).rejects.toThrow(/permission denied/);
  });

  it('no permite al cliente leer el esquema privado', async () => {
    await expect(asUser(A, () => db.query('select * from private.ig_tokens'))).rejects.toThrow(/permission denied/);
  });

  it('protege los meses cerrados y conserva complementos', async () => {
    await asUser(A, () => db.query(`insert into public.months (month, objectives) values ('2026-10', 'Crecer')`));
    await asUser(A, () => db.query(`update public.months set status = 'cerrado', closed_at = now(), report = '{"a":1}' where month = '2026-10'`));
    await expect(asUser(A, () => db.query(`update public.months set objectives = 'otro' where month = '2026-10'`))).rejects.toThrow(/mes está cerrado/);
    await asUser(A, () => db.query(`update public.months set addenda = '[{"text":"nota"}]' where month = '2026-10'`));
    await expect(asUser(A, () => db.query(`update public.months set addenda = '[]' where month = '2026-10'`))).rejects.toThrow(/no se pueden borrar/);
  });

  it('guarda una sola instantánea diaria y conserva el valor de apertura', async () => {
    await db.exec(`insert into public.ig_accounts (user_id, status) values ('${A}', 'connected')`);
    await db.query(`select public.svc_profile_snapshot($1, '17841', '2026-11-25', 1000, 10, 50)`, [A]);
    await db.query(`select public.svc_profile_snapshot($1, '17841', '2026-11-25', 1012, 10, 51)`, [A]);
    const r = await db.query<{ followers_open: number; followers_count: number }>('select followers_open, followers_count from public.ig_profile_snapshots where user_id = $1', [A]);
    expect(r.rows).toEqual([{ followers_open: 1000, followers_count: 1012 }]);
  });

  it('el bloqueo de sincronización es exclusivo', async () => {
    const first = await db.query<{ ok: boolean }>('select public.svc_sync_lock($1, 10) as ok', [A]);
    const second = await db.query<{ ok: boolean }>('select public.svc_sync_lock($1, 10) as ok', [A]);
    expect(first.rows[0].ok).toBe(true);
    expect(second.rows[0].ok).toBe(false);
    await db.query('select public.svc_sync_unlock($1)', [A]);
    const third = await db.query<{ ok: boolean }>('select public.svc_sync_lock($1, 10) as ok', [A]);
    expect(third.rows[0].ok).toBe(true);
  });

  it('el estado OAuth es de un solo uso', async () => {
    await db.query(`select public.svc_oauth_state_create('h1', $1, 'https://x/#/', 600)`, [A]);
    const a = await db.query('select * from public.svc_oauth_state_consume($1)', ['h1']);
    const b = await db.query('select * from public.svc_oauth_state_consume($1)', ['h1']);
    expect(a.rows.length).toBe(1);
    expect(b.rows.length).toBe(0);
  });

  it('genera y reutiliza la clave de cifrado del Vault', async () => {
    const k1 = await db.query<{ k: string }>('select public.svc_token_key() as k');
    const k2 = await db.query<{ k: string }>('select public.svc_token_key() as k');
    expect(Buffer.from(k1.rows[0].k, 'base64').length).toBe(32);
    expect(k2.rows[0].k).toBe(k1.rows[0].k);
  });

  it('programa la sincronización cada hora y la copia semanal', async () => {
    const jobs = await db.query<{ jobname: string; schedule: string }>('select jobname, schedule from cron.job order by jobname');
    expect(jobs.rows).toEqual([
      { jobname: 'vanni-housekeeping', schedule: '23 4 * * *' },
      { jobname: 'vanni-instagram-hourly', schedule: '17 * * * *' },
      { jobname: 'vanni-weekly-backup', schedule: '41 9 * * 1' },
    ]);
    await db.query(`select public.svc_config_set('functions_base_url', 'https://example.supabase.co/functions/v1')`);
    await db.exec(`select private.call_edge('instagram', '{"action":"cron"}'::jsonb)`);
    const req = await db.query<{ url: string; headers: Record<string, string> }>('select url, headers from net.requests');
    expect(req.rows[0].url).toBe('https://example.supabase.co/functions/v1/instagram');
    expect(req.rows[0].headers['x-vanni-cron']).toMatch(/^[0-9a-f]{64}$/);
  });
});
