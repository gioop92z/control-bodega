-- VANNI STUDIO · Alta exclusiva del propietario, funciones de servidor, Storage, Realtime.

-- ───────────────────────── Registro cerrado: solo la función segura «owner» puede crear la cuenta
create or replace function private.guard_owner_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_token text := new.raw_user_meta_data ->> 'vanni_claim';
  v_hash text;
begin
  if v_token is null or length(v_token) < 32 then
    raise exception 'VANNI STUDIO: el registro público está cerrado';
  end if;
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  delete from private.signup_tokens where token_hash = v_hash and expires_at > now();
  if not found then
    raise exception 'VANNI STUDIO: autorización de alta inválida o vencida';
  end if;
  if exists (select 1 from private.owner) then
    raise exception 'VANNI STUDIO: ya existe la cuenta propietaria';
  end if;
  new.raw_user_meta_data := new.raw_user_meta_data - 'vanni_claim';
  return new;
end $$;

create or replace function private.after_owner_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.owner (user_id) values (new.id);
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists vanni_guard_signup on auth.users;
create trigger vanni_guard_signup before insert on auth.users
  for each row execute function private.guard_owner_signup();
drop trigger if exists vanni_after_signup on auth.users;
create trigger vanni_after_signup after insert on auth.users
  for each row execute function private.after_owner_signup();

-- ───────────────────────── Funciones exclusivas del rol de servicio (Edge Functions)
create or replace function public.svc_config_get(p_keys text[])
returns table (key text, value text)
language sql security definer set search_path = '' stable as $$
  select c.key, c.value from private.app_config c where c.key = any (p_keys);
$$;

create or replace function public.svc_config_set(p_key text, p_value text)
returns void language sql security definer set search_path = '' as $$
  insert into private.app_config (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
$$;

create or replace function public.svc_config_delete(p_key text)
returns void language sql security definer set search_path = '' as $$
  delete from private.app_config where key = p_key;
$$;

create or replace function public.svc_owner_info()
returns table (user_id uuid, email text, claimed_at timestamptz)
language sql security definer set search_path = '' stable as $$
  select o.user_id, u.email::text, o.claimed_at
  from private.owner o join auth.users u on u.id = o.user_id;
$$;

create or replace function public.svc_signup_token_create(p_hash text, p_ttl_seconds integer)
returns void language sql security definer set search_path = '' as $$
  delete from private.signup_tokens where expires_at < now();
  insert into private.signup_tokens (token_hash, expires_at)
  values (p_hash, now() + make_interval(secs => p_ttl_seconds));
$$;

create or replace function public.svc_attempts_allowed(p_kind text, p_window_minutes integer, p_max integer)
returns boolean language sql security definer set search_path = '' stable as $$
  select count(*) < p_max from private.auth_attempts
  where kind = p_kind and not ok and at > now() - make_interval(mins => p_window_minutes);
$$;

create or replace function public.svc_attempt_record(p_kind text, p_ok boolean)
returns void language sql security definer set search_path = '' as $$
  delete from private.auth_attempts where at < now() - interval '7 days';
  insert into private.auth_attempts (kind, ok) values (p_kind, p_ok);
$$;

create or replace function public.svc_token_save(
  p_user uuid, p_ig_user text, p_cipher text, p_iv text, p_expires timestamptz, p_fresh_issue boolean)
returns void language sql security definer set search_path = '' as $$
  insert into private.ig_tokens (user_id, ig_user_id, ciphertext, iv, issued_at, expires_at, refreshed_at, updated_at)
  values (p_user, p_ig_user, p_cipher, p_iv, now(), p_expires, now(), now())
  on conflict (user_id) do update set
    ig_user_id = excluded.ig_user_id,
    ciphertext = excluded.ciphertext,
    iv = excluded.iv,
    expires_at = excluded.expires_at,
    refreshed_at = now(),
    updated_at = now(),
    issued_at = case when p_fresh_issue then now() else private.ig_tokens.issued_at end;
$$;

create or replace function public.svc_token_get(p_user uuid)
returns table (ig_user_id text, ciphertext text, iv text, issued_at timestamptz, expires_at timestamptz, refreshed_at timestamptz)
language sql security definer set search_path = '' stable as $$
  select t.ig_user_id, t.ciphertext, t.iv, t.issued_at, t.expires_at, t.refreshed_at
  from private.ig_tokens t where t.user_id = p_user;
$$;

create or replace function public.svc_token_delete(p_user uuid)
returns void language sql security definer set search_path = '' as $$
  delete from private.ig_tokens where user_id = p_user;
$$;

create or replace function public.svc_token_users()
returns setof uuid language sql security definer set search_path = '' stable as $$
  select user_id from private.ig_tokens;
$$;

create or replace function public.svc_oauth_state_create(p_hash text, p_user uuid, p_return text, p_ttl_seconds integer)
returns void language sql security definer set search_path = '' as $$
  delete from private.oauth_states where expires_at < now();
  insert into private.oauth_states (state_hash, user_id, return_url, expires_at)
  values (p_hash, p_user, p_return, now() + make_interval(secs => p_ttl_seconds));
$$;

create or replace function public.svc_oauth_state_consume(p_hash text)
returns table (user_id uuid, return_url text)
language sql security definer set search_path = '' as $$
  delete from private.oauth_states s
  where s.state_hash = p_hash and s.expires_at > now()
  returning s.user_id, s.return_url;
$$;

-- Bloqueo atómico para evitar sincronizaciones simultáneas (cron + botón manual)
create or replace function public.svc_sync_lock(p_user uuid, p_stale_minutes integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.ig_accounts set sync_started_at = now()
  where user_id = p_user
    and (sync_started_at is null or sync_started_at < now() - make_interval(mins => p_stale_minutes));
  return found;
end $$;

create or replace function public.svc_sync_unlock(p_user uuid)
returns void language sql security definer set search_path = '' as $$
  update public.ig_accounts set sync_started_at = null where user_id = p_user;
$$;

-- Primer valor del día de seguidores sin sobrescribirlo (registro histórico sin duplicados)
create or replace function public.svc_profile_snapshot(
  p_user uuid, p_ig_user text, p_day date, p_followers integer, p_follows integer, p_media integer)
returns void language sql security definer set search_path = '' as $$
  insert into public.ig_profile_snapshots (user_id, ig_user_id, day, followers_open, followers_count, follows_count, media_count, captured_at)
  values (p_user, p_ig_user, p_day, p_followers, p_followers, p_follows, p_media, now())
  on conflict (user_id, ig_user_id, day) do update set
    followers_count = excluded.followers_count,
    follows_count = excluded.follows_count,
    media_count = excluded.media_count,
    captured_at = now();
$$;

-- Clave AES-256-GCM para tokens de Instagram y el App Secret de Meta.
-- Se guarda en Supabase Vault (cifrada en reposo con una clave raíz fuera de la base de datos).
create or replace function public.svc_token_key()
returns text language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'vanni_token_key';
  if v is null then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'vanni_token_key',
      'VANNI STUDIO: clave AES-GCM para tokens de Instagram');
    select decrypted_secret into v from vault.decrypted_secrets where name = 'vanni_token_key';
  end if;
  return v;
end $$;

-- Secreto interno para que pg_cron invoque las funciones (nunca sale del servidor).
insert into private.app_config (key, value)
values ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

do $$
declare f text;
begin
  foreach f in array array[
    'svc_config_get(text[])','svc_config_set(text,text)','svc_config_delete(text)','svc_owner_info()',
    'svc_signup_token_create(text,integer)','svc_attempts_allowed(text,integer,integer)',
    'svc_attempt_record(text,boolean)','svc_token_save(uuid,text,text,text,timestamptz,boolean)',
    'svc_token_get(uuid)','svc_token_delete(uuid)','svc_token_users()',
    'svc_oauth_state_create(text,uuid,text,integer)','svc_oauth_state_consume(text)',
    'svc_sync_lock(uuid,integer)','svc_sync_unlock(uuid)',
    'svc_profile_snapshot(uuid,text,date,integer,integer,integer)','svc_token_key()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

revoke all on function private.guard_owner_signup() from public, anon, authenticated;
revoke all on function private.after_owner_signup() from public, anon, authenticated;

-- ───────────────────────── Storage privado
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('vanni-media', 'vanni-media', false, 52428800,
   array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','video/mp4','video/quicktime','video/webm','application/pdf']),
  ('vanni-backups', 'vanni-backups', false, 52428800, array['application/json'])
on conflict (id) do nothing;

create policy "vanni media: leer propios" on storage.objects for select to authenticated
  using (bucket_id = 'vanni-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "vanni media: subir propios" on storage.objects for insert to authenticated
  with check (bucket_id = 'vanni-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "vanni media: actualizar propios" on storage.objects for update to authenticated
  using (bucket_id = 'vanni-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "vanni media: borrar propios" on storage.objects for delete to authenticated
  using (bucket_id = 'vanni-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "vanni backups: leer propios" on storage.objects for select to authenticated
  using (bucket_id = 'vanni-backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ───────────────────────── Realtime: sincronización inmediata entre dispositivos
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','manual_metrics','contacts','gyms','series','seasons','episodes','media_links',
    'attachments','ideas','events','tasks','body_logs','routines','workouts','workout_sets',
    'habits','goals','months','deals','interactions','rates','transactions','categories',
    'custom_fields','collections','collection_items','templates','notes',
    'ig_accounts','ig_sync_runs','backup_runs'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
