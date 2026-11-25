-- VANNI STUDIO · Tareas programadas (gratuitas: pg_cron + pg_net dentro de Supabase)
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Invoca una Edge Function con el secreto interno de cron (guardado solo en private.app_config).
create or replace function private.call_edge(p_function text, p_body jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_base text;
  v_secret text;
  v_id bigint;
begin
  select value into v_base from private.app_config where key = 'functions_base_url';
  select value into v_secret from private.app_config where key = 'cron_secret';
  if v_base is null or v_secret is null then
    return null;
  end if;
  select net.http_post(
    url := v_base || '/' || p_function,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-vanni-cron', v_secret),
    timeout_milliseconds := 15000
  ) into v_id;
  return v_id;
end $$;
revoke all on function private.call_edge(text, jsonb) from public, anon, authenticated;

create or replace function private.housekeeping()
returns void language sql security definer set search_path = '' as $$
  delete from private.oauth_states where expires_at < now();
  delete from private.signup_tokens where expires_at < now();
  delete from private.auth_attempts where at < now() - interval '7 days';
  delete from public.ig_sync_runs where started_at < now() - interval '120 days';
$$;
revoke all on function private.housekeeping() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job
where jobname in ('vanni-instagram-hourly', 'vanni-weekly-backup', 'vanni-housekeeping');

-- Cada 60 minutos (minuto 17 para no coincidir con la hora exacta).
select cron.schedule('vanni-instagram-hourly', '17 * * * *',
  $$select private.call_edge('instagram', '{"action":"cron"}'::jsonb)$$);
-- Copia de seguridad semanal: lunes 09:41 UTC (03:41 en Ciudad de México).
select cron.schedule('vanni-weekly-backup', '41 9 * * 1',
  $$select private.call_edge('backup', '{"action":"cron"}'::jsonb)$$);
select cron.schedule('vanni-housekeeping', '23 4 * * *',
  $$select private.housekeeping()$$);
