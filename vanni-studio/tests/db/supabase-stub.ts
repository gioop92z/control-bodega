// Emulación mínima de las piezas de Supabase que usan las migraciones,
// para validar sintaxis, RLS y disparadores con PGlite sin tocar el proyecto real.
export const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create schema auth;
create schema extensions;
create schema storage;
create schema vault;
create schema cron;
create schema net;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
create publication supabase_realtime;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create function vault.create_secret(p_secret text, p_name text, p_description text) returns uuid language sql as $$
  insert into vault.secrets (name, secret, description) values (p_name, p_secret, p_description) returning id
$$;
create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid
$$;
create function cron.unschedule(p_name text) returns boolean language sql as $$ delete from cron.job where jobname = p_name returning true $$;
create table net.requests (id bigserial primary key, url text, body jsonb, headers jsonb);
create function extensions.http_post_stub() returns void language sql as $$ select $$;
create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer) returns bigint language sql as $$
  insert into net.requests (url, body, headers) values (url, body, headers) returning id
$$;
`;

/** Elimina sentencias de extensiones que PGlite no trae (pg_cron / pg_net) o ya emulamos. */
export function adaptMigration(sql: string): string {
  return sql
    .replace(/create extension if not exists pg_cron;/g, '')
    .replace(/create extension if not exists pg_net with schema extensions;/g, '')
    .replace(/create extension if not exists pgcrypto with schema extensions;/g, '');
}
