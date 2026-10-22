-- VANTIS 4.0 · migración propuesta. NO se ejecuta hasta revisar el proyecto Supabase vinculado.
-- No modifica existencias existentes. Transacciones de traslado conservan stock general.
begin;

create table if not exists public.vantis_operadores_v4 (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  departamento_id uuid not null references public.departamentos(id) on delete cascade,
  rol text not null check (rol in ('admin','operador')),
  primary key(usuario_id,departamento_id)
);
alter table public.vantis_operadores_v4 enable row level security;
revoke all on public.vantis_operadores_v4 from anon, authenticated;
grant select on public.vantis_operadores_v4 to authenticated;
drop policy if exists vantis_operadores_self_read_v4 on public.vantis_operadores_v4;
create policy vantis_operadores_self_read_v4 on public.vantis_operadores_v4
  for select to authenticated using(usuario_id = (select auth.uid()));

-- Compatibilidad temporal con los dos accesos existentes; se deben reemplazar por
-- cuentas individuales y rotar las claves desde Auth antes de uso multiusuario real.
insert into public.vantis_operadores_v4(usuario_id,departamento_id,rol)
select u.id,d.id,case when u.email='99@bodega.local' then 'admin' else 'operador' end
from auth.users u cross join public.departamentos d
where u.email in ('99@bodega.local','10@bodega.local')
on conflict (usuario_id,departamento_id) do nothing;

create table if not exists public.vantis_incidencias_v4 (
  id uuid primary key default gen_random_uuid(),
  departamento_id uuid not null references public.departamentos(id),
  sku text not null check(length(sku) between 1 and 120),
  tipo text not null check(tipo in ('DANIO','DIFERENCIA','PERDIDA','DEVOLUCION')),
  descripcion text not null check(length(trim(descripcion)) between 1 and 1000),
  estado text not null default 'ABIERTA' check(estado in ('ABIERTA','EN_REVISION','RESUELTA')),
  usuario_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists vantis_incidencias_v4_dept_fecha
  on public.vantis_incidencias_v4(departamento_id,created_at desc);
alter table public.vantis_incidencias_v4 enable row level security;
revoke all on public.vantis_incidencias_v4 from anon, authenticated;
grant select,insert on public.vantis_incidencias_v4 to authenticated;
grant update (estado) on public.vantis_incidencias_v4 to authenticated;
drop policy if exists vantis_incident_select_v4 on public.vantis_incidencias_v4;
create policy vantis_incident_select_v4 on public.vantis_incidencias_v4
  for select to authenticated using (
    exists(select 1 from public.vantis_operadores_v4 o
           where o.usuario_id=(select auth.uid()) and o.departamento_id=vantis_incidencias_v4.departamento_id)
  );
drop policy if exists vantis_incident_insert_v4 on public.vantis_incidencias_v4;
create policy vantis_incident_insert_v4 on public.vantis_incidencias_v4
  for insert to authenticated with check (
    usuario_id=(select auth.uid()) and
    exists(select 1 from public.vantis_operadores_v4 o
           where o.usuario_id=(select auth.uid()) and o.departamento_id=vantis_incidencias_v4.departamento_id)
  );
drop policy if exists vantis_incident_admin_update_v4 on public.vantis_incidencias_v4;
create policy vantis_incident_admin_update_v4 on public.vantis_incidencias_v4
  for update to authenticated
  using(exists(select 1 from public.vantis_operadores_v4 o
       where o.usuario_id=(select auth.uid()) and o.departamento_id=vantis_incidencias_v4.departamento_id and o.rol='admin'))
  with check(exists(select 1 from public.vantis_operadores_v4 o
       where o.usuario_id=(select auth.uid()) and o.departamento_id=vantis_incidencias_v4.departamento_id and o.rol='admin'));

create table if not exists public.vantis_traslados_v4 (
  operacion_id uuid primary key,
  departamento_id uuid not null references public.departamentos(id),
  sku text not null,
  origen text not null,
  destino text not null,
  cantidad integer not null check(cantidad>0),
  usuario_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check(origen<>destino)
);
create index if not exists vantis_traslados_v4_dept_fecha
  on public.vantis_traslados_v4(departamento_id,created_at desc);
alter table public.vantis_traslados_v4 enable row level security;
revoke all on public.vantis_traslados_v4 from anon, authenticated;
grant select,insert on public.vantis_traslados_v4 to authenticated;
drop policy if exists vantis_transfers_select_v4 on public.vantis_traslados_v4;
create policy vantis_transfers_select_v4 on public.vantis_traslados_v4
  for select to authenticated using (
    exists(select 1 from public.vantis_operadores_v4 o
      where o.usuario_id=(select auth.uid()) and o.departamento_id=vantis_traslados_v4.departamento_id)
  );
drop policy if exists vantis_transfers_insert_v4 on public.vantis_traslados_v4;
create policy vantis_transfers_insert_v4 on public.vantis_traslados_v4
  for insert to authenticated with check (
    usuario_id=(select auth.uid()) and
    exists(select 1 from public.vantis_operadores_v4 o
      where o.usuario_id=(select auth.uid()) and o.departamento_id=vantis_traslados_v4.departamento_id)
  );

-- SECURITY INVOKER mantiene las políticas RLS de tablas existentes. No se
-- habilita a anon, no se utiliza service_role y ninguna credencial sale al cliente.
create or replace function public.vantis_trasladar_v4(
  p_operacion_id uuid,p_departamento uuid,p_sku text,
  p_origen text,p_destino text,p_cantidad integer
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
  v_usuario uuid:=auth.uid();
  v_previo public.vantis_traslados_v4%rowtype;
  v_cantidad numeric;
  v_stock numeric;
  v_destino numeric;
  v_marbete_count integer;
begin
  if v_usuario is null or not exists(
    select 1 from public.vantis_operadores_v4 o
    where o.usuario_id=v_usuario and o.departamento_id=p_departamento
  ) then raise exception 'Acceso no autorizado al departamento.' using errcode='42501'; end if;
  if p_operacion_id is null or p_sku is null or length(trim(p_sku)) not between 1 and 120
     or p_origen is null or p_destino is null or p_origen=p_destino
     or p_cantidad is null or p_cantidad<1 or p_cantidad>100000 then
    raise exception 'Parámetros de traslado inválidos.' using errcode='22023';
  end if;
  -- Un mismo folio simultáneo no puede ejecutarse dos veces.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operacion_id::text,0));
  select * into v_previo from public.vantis_traslados_v4 where operacion_id=p_operacion_id;
  if found then
    if v_previo.departamento_id<>p_departamento or v_previo.sku<>p_sku
       or v_previo.origen<>p_origen or v_previo.destino<>p_destino
       or v_previo.cantidad<>p_cantidad or v_previo.usuario_id<>v_usuario then
      raise exception 'Folio ya utilizado con datos diferentes.' using errcode='23505';
    end if;
    return pg_catalog.jsonb_build_object('operacion_id',p_operacion_id,'repetida',true,'cantidad',p_cantidad);
  end if;
  select p.stock into v_stock from public.productos p
    where p.departamento_id=p_departamento and p.sku=p_sku and p.activo=true;
  if not found then raise exception 'El SKU no pertenece al departamento.' using errcode='22023'; end if;
  select count(*) into v_marbete_count from public.marbetes m
    where m.departamento_id=p_departamento and m.activo=true
      and m.codigo in (p_origen,p_destino);
  if v_marbete_count<>2 then raise exception 'Origen/destino no registrados o inactivos.' using errcode='22023'; end if;

  -- Bloqueo de ubicaciones existentes en orden fijo para evitar carreras.
  perform 1 from public.producto_marbetes a
    where a.sku=p_sku and a.marbete_codigo in (p_origen,p_destino)
    order by a.marbete_codigo for update;
  select a.cantidad into v_cantidad from public.producto_marbetes a
    where a.sku=p_sku and a.marbete_codigo=p_origen for update;
  if v_cantidad is null or v_cantidad<p_cantidad then
    raise exception 'Ubicación de origen sin cantidad suficiente y verificada.' using errcode='22023';
  end if;
  update public.producto_marbetes set cantidad=cantidad-p_cantidad,updated_at=now()
    where sku=p_sku and marbete_codigo=p_origen and cantidad>=p_cantidad;
  if not found then raise exception 'El origen cambió; vuelve a verificar.' using errcode='40001'; end if;
  insert into public.producto_marbetes(sku,marbete_codigo,cantidad,updated_at)
  values(p_sku,p_destino,p_cantidad,now())
  on conflict (sku,marbete_codigo) do update
    set cantidad=coalesce(public.producto_marbetes.cantidad,0)+excluded.cantidad,
        updated_at=now();
  insert into public.vantis_traslados_v4(operacion_id,departamento_id,sku,origen,destino,cantidad,usuario_id)
  values(p_operacion_id,p_departamento,p_sku,p_origen,p_destino,p_cantidad,v_usuario);
  return pg_catalog.jsonb_build_object('operacion_id',p_operacion_id,'repetida',false,
         'cantidad',p_cantidad,'stock_global_no_modificado',v_stock);
end;
$$;
revoke all on function public.vantis_trasladar_v4(uuid,uuid,text,text,text,integer) from public,anon;
grant execute on function public.vantis_trasladar_v4(uuid,uuid,text,text,text,integer) to authenticated;
commit;

-- REVISIÓN PREVIA OBLIGATORIA: verificar tipos, RLS actual de producto_marbetes,
-- índice UNIQUE(sku,marbete_codigo), disponibilidad de gen_random_uuid,
-- y comportamiento de traslados concurrentes con pruebas en entorno aislado.
