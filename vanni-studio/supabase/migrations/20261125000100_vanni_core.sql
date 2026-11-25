-- VANNI STUDIO · Esquema principal
-- Proyecto dedicado (no compartido con VANTIS). Todo dato pertenece a auth.uid().

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ───────────────────────── Configuración privada (solo servidor)
create table private.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table private.owner (
  user_id uuid primary key references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
-- Solo puede existir una cuenta propietaria.
create unique index owner_singleton on private.owner ((true));

create table private.signup_tokens (
  token_hash text primary key,
  expires_at timestamptz not null
);

create table private.auth_attempts (
  id bigint generated always as identity primary key,
  kind text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index auth_attempts_kind_at on private.auth_attempts (kind, at desc);

create table private.ig_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ig_user_id text not null,
  ciphertext text not null,
  iv text not null,
  key_version int not null default 1,
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  refreshed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  return_url text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- ───────────────────────── Perfil y preferencias
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null default 'VANNI',
  handle text,
  bio text,
  contact_email text,
  timezone text not null default 'America/Mexico_City',
  currency text not null default 'MXN',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Instagram (escritura exclusiva del servidor)
create table public.ig_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  ig_user_id text,
  username text,
  name text,
  biography text,
  website text,
  profile_picture_url text,
  account_type text,
  followers_count integer,
  follows_count integer,
  media_count integer,
  status text not null default 'disconnected'
    check (status in ('connected','reconnect_required','disconnected','error')),
  scopes text[] not null default '{}',
  token_expires_at timestamptz,
  token_refreshed_at timestamptz,
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  sync_started_at timestamptz,
  next_sync_after timestamptz,
  backfilled_at timestamptz,
  audience_synced_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ig_profile_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ig_user_id text not null,
  day date not null,
  followers_open integer,
  followers_count integer,
  follows_count integer,
  media_count integer,
  captured_at timestamptz not null default now(),
  unique (user_id, ig_user_id, day)
);

create table public.ig_account_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ig_user_id text not null,
  day date not null,
  metric text not null,
  value numeric,
  breakdown jsonb,
  fetched_at timestamptz not null default now(),
  unique (user_id, ig_user_id, day, metric)
);
create index ig_account_insights_day on public.ig_account_insights (user_id, day desc);

create table public.ig_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ig_user_id text not null,
  ig_media_id text not null,
  caption text,
  media_type text,
  media_product_type text,
  permalink text,
  media_url text,
  thumbnail_url text,
  posted_at timestamptz,
  like_count integer,
  comments_count integer,
  is_story boolean not null default false,
  insights jsonb not null default '{}'::jsonb,
  insights_fetched_at timestamptz,
  unavailable_metrics text[] not null default '{}',
  insights_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ig_media_id)
);
create index ig_media_posted on public.ig_media (user_id, posted_at desc);

create table public.ig_media_insights_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ig_media_id text not null,
  day date not null,
  metrics jsonb not null default '{}'::jsonb,
  like_count integer,
  comments_count integer,
  fetched_at timestamptz not null default now(),
  unique (user_id, ig_media_id, day)
);

create table public.ig_audience (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ig_user_id text not null,
  day date not null,
  metric text not null,
  breakdown text not null default '',
  timeframe text not null default '',
  data jsonb not null,
  fetched_at timestamptz not null default now(),
  unique (user_id, ig_user_id, day, metric, breakdown, timeframe)
);

create table public.ig_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trigger text not null,
  status text not null default 'running'
    check (status in ('running','success','partial','error','skipped','rate_limited')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  api_calls integer not null default 0,
  error text,
  details jsonb not null default '{}'::jsonb
);
create index ig_sync_runs_started on public.ig_sync_runs (user_id, started_at desc);

create table public.ig_metric_support (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,
  metric text not null,
  status text not null check (status in ('available','empty','unavailable')),
  error text,
  checked_at timestamptz not null default now(),
  unique (user_id, scope, metric)
);

create table public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trigger text not null default 'manual',
  status text not null default 'success',
  storage_path text,
  size_bytes bigint,
  tables jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

-- ───────────────────────── Métricas manuales (claramente distinguidas)
create table public.manual_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  metric text not null,
  value numeric not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day, metric)
);

-- ───────────────────────── Contactos (colaboradores, marcas, gimnasios, patrocinadores)
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  kind text not null default 'marca',
  company text, role text, instagram text, email text, phone text, website text, city text,
  notes text,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Gimnasios
create table public.gyms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  address text, city text,
  lat double precision, lng double precision,
  maps_url text,
  price_visit numeric, price_month numeric,
  currency text not null default 'MXN',
  status text not null default 'pendiente',
  visit_date date,
  experience text,
  machines text,
  ratings jsonb not null default '{}'::jsonb,
  cover_path text,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Series, temporadas y episodios
create table public.series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '',
  tagline text,
  description text,
  color text,
  status text not null default 'activa',
  cover_path text,
  sort integer not null default 0,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  series_id uuid not null references public.series(id) on delete cascade,
  number integer not null default 1,
  title text,
  description text,
  status text not null default 'planeacion',
  start_date date, end_date date,
  budget numeric,
  cover_path text,
  sort integer not null default 0,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  series_id uuid references public.series(id) on delete cascade,
  season_id uuid references public.seasons(id) on delete set null,
  number integer,
  title text not null default '',
  synopsis text,
  hook text,
  script text,
  status text not null default 'idea'
    check (status in ('idea','planeacion','grabacion','edicion','programado','publicado','analizado')),
  location text,
  gym_id uuid references public.gyms(id) on delete set null,
  budget numeric,
  cost numeric,
  record_date date,
  record_time time,
  publish_date date,
  cover_path text,
  refs jsonb not null default '[]'::jsonb,
  collaborator_ids uuid[] not null default '{}',
  shotlist jsonb not null default '[]'::jsonb,
  checklist jsonb not null default '[]'::jsonb,
  notes text,
  sort integer not null default 0,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index episodes_series on public.episodes (series_id);
create index episodes_season on public.episodes (season_id);
create index episodes_gym on public.episodes (gym_id);

-- Vínculo publicación real ↔ serie / episodio (una publicación pertenece a una serie)
create table public.media_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ig_media_id text not null,
  series_id uuid references public.series(id) on delete cascade,
  episode_id uuid references public.episodes(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ig_media_id),
  check (series_id is not null or episode_id is not null)
);
create index media_links_series on public.media_links (series_id);
create index media_links_episode on public.media_links (episode_id);

-- Archivos adjuntos (Storage privado) y referencias externas
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  kind text not null default 'photo',
  storage_path text,
  external_url text,
  mime text,
  size_bytes bigint,
  caption text,
  taken_on date,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index attachments_entity on public.attachments (entity_type, entity_id);

-- ───────────────────────── Laboratorio creativo
create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'idea',
  title text not null default '',
  body text,
  items jsonb not null default '[]'::jsonb,
  status text not null default 'nueva',
  priority integer not null default 2,
  series_id uuid references public.series(id) on delete set null,
  source_url text,
  music text,
  converted jsonb not null default '[]'::jsonb,
  pinned boolean not null default false,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ideas_series on public.ideas (series_id);

-- ───────────────────────── Calendario y tareas
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '',
  category text not null default 'personal',
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  location text,
  notes text,
  priority integer not null default 2,
  status text not null default 'pendiente',
  color text,
  recurrence jsonb,
  exdates text[] not null default '{}',
  done_dates text[] not null default '{}',
  linked_type text,
  linked_id uuid,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index events_start on public.events (user_id, start_at);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '',
  notes text,
  done boolean not null default false,
  done_at timestamptz,
  due_date date,
  priority integer not null default 2,
  list_name text not null default 'General',
  linked_type text,
  linked_id uuid,
  sort integer not null default 0,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Evolución física y personal (privado)
create table public.body_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  weight numeric,
  body_fat numeric,
  measurements jsonb not null default '{}'::jsonb,
  sleep_hours numeric,
  sleep_quality integer,
  energy integer,
  mood integer,
  habits jsonb not null default '{}'::jsonb,
  reflection text,
  achievements text,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  description text,
  exercises jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  title text not null default '',
  routine_id uuid references public.routines(id) on delete set null,
  duration_min integer,
  rpe numeric,
  notes text,
  gym_id uuid references public.gyms(id) on delete set null,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workouts_day on public.workouts (user_id, day desc);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  exercise text not null default '',
  set_index integer not null default 1,
  reps integer,
  weight numeric,
  unit text not null default 'kg',
  rpe numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workout_sets_workout on public.workout_sets (workout_id);

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  description text,
  target_per_week integer not null default 7,
  active boolean not null default true,
  color text,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Objetivos y Journey mensual
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '',
  description text,
  area text not null default 'personal',
  metric text not null default 'manual',
  start_value numeric,
  target_value numeric,
  current_value numeric,
  unit text,
  due_date date,
  month text check (month is null or month ~ '^\d{4}-\d{2}$'),
  status text not null default 'pendiente',
  priority integer not null default 2,
  carried_from uuid references public.goals(id) on delete set null,
  completed_at timestamptz,
  sort integer not null default 0,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.months (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  title text,
  status text not null default 'abierto' check (status in ('abierto','cerrado')),
  objectives text,
  achievements text,
  difficulties text,
  learnings text,
  improvements text,
  next_strategy text,
  content_budget numeric,
  report jsonb,
  closed_at timestamptz,
  addenda jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);

-- Un mes cerrado conserva su informe y textos; solo admite complementos (addenda).
create or replace function private.protect_closed_month()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'cerrado' and new.status = 'cerrado' then
    if new.report is distinct from old.report
       or new.objectives is distinct from old.objectives
       or new.achievements is distinct from old.achievements
       or new.difficulties is distinct from old.difficulties
       or new.learnings is distinct from old.learnings
       or new.improvements is distinct from old.improvements
       or new.next_strategy is distinct from old.next_strategy
       or new.closed_at is distinct from old.closed_at then
      raise exception 'Este mes está cerrado: agrega un complemento en lugar de sobrescribirlo';
    end if;
    if jsonb_array_length(new.addenda) < jsonb_array_length(old.addenda) then
      raise exception 'Los complementos de un mes cerrado no se pueden borrar';
    end if;
  end if;
  return new;
end $$;

-- ───────────────────────── Marca y colaboraciones
create table public.deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  title text not null default '',
  kind text not null default 'colaboracion',
  status text not null default 'por_contactar'
    check (status in ('por_contactar','contactado','negociacion','confirmado','completado')),
  amount numeric,
  currency text not null default 'MXN',
  deliverables text,
  start_date date, due_date date,
  next_action text, next_action_date date,
  notes text,
  archived boolean not null default false,
  sort integer not null default 0,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deals_contact on public.deals (contact_id);

create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete set null,
  happened_at timestamptz not null default now(),
  channel text not null default 'dm',
  direction text not null default 'saliente',
  summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index interactions_contact on public.interactions (contact_id);
create index interactions_deal on public.interactions (deal_id);

create table public.rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  description text,
  price numeric,
  currency text not null default 'MXN',
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null default current_date,
  kind text not null check (kind in ('ingreso','gasto')),
  amount numeric not null default 0,
  currency text not null default 'MXN',
  category text not null default 'general',
  description text,
  deal_id uuid references public.deals(id) on delete set null,
  series_id uuid references public.series(id) on delete set null,
  episode_id uuid references public.episodes(id) on delete set null,
  gym_id uuid references public.gyms(id) on delete set null,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_day on public.transactions (user_id, day desc);
create index transactions_deal on public.transactions (deal_id);
create index transactions_series on public.transactions (series_id);
create index transactions_episode on public.transactions (episode_id);
create index transactions_gym on public.transactions (gym_id);

-- ───────────────────────── Personalización
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  scope text not null,
  name text not null default '',
  color text,
  icon text,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entity text not null,
  key text not null,
  label text not null default '',
  type text not null default 'text'
    check (type in ('text','textarea','number','date','select','checkbox','url','rating')),
  options jsonb not null default '[]'::jsonb,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entity, key)
);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  kind text not null default 'list' check (kind in ('list','tracker','board')),
  description text,
  icon text,
  color text,
  fields jsonb not null default '[]'::jsonb,
  columns jsonb not null default '[]'::jsonb,
  sort integer not null default 0,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.collection_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  title text not null default '',
  data jsonb not null default '{}'::jsonb,
  column_key text,
  day date,
  done boolean not null default false,
  sort integer not null default 0,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index collection_items_collection on public.collection_items (collection_id);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target text not null,
  name text not null default '',
  data jsonb not null default '{}'::jsonb,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '',
  body text,
  folder text,
  pinned boolean not null default false,
  tags text[] not null default '{}',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Seguridad por fila, permisos, índices y updated_at
revoke all on all tables in schema public from anon;

do $$
declare
  t text;
  rw text[] := array[
    'profiles','manual_metrics','contacts','gyms','series','seasons','episodes','media_links',
    'attachments','ideas','events','tasks','body_logs','routines','workouts','workout_sets',
    'habits','goals','months','deals','interactions','rates','transactions','categories',
    'custom_fields','collections','collection_items','templates','notes'];
  ro text[] := array[
    'ig_accounts','ig_profile_snapshots','ig_account_insights','ig_media',
    'ig_media_insights_daily','ig_audience','ig_sync_runs','ig_metric_support','backup_runs'];
begin
  foreach t in array rw loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_owner_all', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create index if not exists %I on public.%I (user_id)', t || '_user_idx', t);
    execute format('create trigger %I before update on public.%I for each row execute function private.touch_updated_at()', t || '_touch', t);
  end loop;
  foreach t in array ro loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_owner_read', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create index if not exists %I on public.%I (user_id)', t || '_user_idx', t);
  end loop;
end $$;

create trigger ig_accounts_touch before update on public.ig_accounts
  for each row execute function private.touch_updated_at();
create trigger ig_media_touch before update on public.ig_media
  for each row execute function private.touch_updated_at();
create trigger months_protect before update on public.months
  for each row execute function private.protect_closed_month();

-- Las tablas privadas no tienen políticas: solo el rol de servicio (funciones seguras) las usa.
alter table private.app_config enable row level security;
alter table private.owner enable row level security;
alter table private.signup_tokens enable row level security;
alter table private.auth_attempts enable row level security;
alter table private.ig_tokens enable row level security;
alter table private.oauth_states enable row level security;
