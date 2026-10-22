-- Operaciones v4 seguras. La auditoría de traslados es de solo lectura para el cliente.
BEGIN;
CREATE TABLE IF NOT EXISTS public.vantis_incidencias_v4(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 departamento_id uuid NOT NULL REFERENCES public.departamentos(id),
 sku text NOT NULL CHECK(length(trim(sku)) BETWEEN 1 AND 120),
 tipo text NOT NULL CHECK(tipo IN ('DANIO','DIFERENCIA','PERDIDA','DEVOLUCION')),
 descripcion text NOT NULL CHECK(length(trim(descripcion)) BETWEEN 1 AND 1000),
 estado text NOT NULL DEFAULT 'ABIERTA' CHECK(estado IN ('ABIERTA','EN_REVISION','RESUELTA')),
 usuario_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.vantis_traslados_v4(
 operacion_id uuid PRIMARY KEY,
 departamento_id uuid NOT NULL REFERENCES public.departamentos(id),
 sku text NOT NULL, origen text NOT NULL, destino text NOT NULL,
 cantidad integer NOT NULL CHECK(cantidad BETWEEN 1 AND 100000),
 usuario_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(origen<>destino)
);
CREATE INDEX IF NOT EXISTS vantis_incidencias_v4_dept_fecha ON public.vantis_incidencias_v4(departamento_id,created_at DESC);
CREATE INDEX IF NOT EXISTS vantis_traslados_v4_dept_fecha ON public.vantis_traslados_v4(departamento_id,created_at DESC);
ALTER TABLE public.vantis_incidencias_v4 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vantis_traslados_v4 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vantis_incidencias_v4,public.vantis_traslados_v4 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.vantis_incidencias_v4 TO authenticated;
GRANT UPDATE(estado) ON public.vantis_incidencias_v4 TO authenticated;
GRANT SELECT ON public.vantis_traslados_v4 TO authenticated;
CREATE POLICY incident_read ON public.vantis_incidencias_v4 FOR SELECT TO authenticated USING(vantis_core.can_use(departamento_id));
CREATE POLICY incident_insert ON public.vantis_incidencias_v4 FOR INSERT TO authenticated WITH CHECK(
 usuario_id=auth.uid() AND vantis_core.can_use(departamento_id));
CREATE POLICY incident_admin_update ON public.vantis_incidencias_v4 FOR UPDATE TO authenticated
 USING(vantis_core.role_for(departamento_id)='admin')
 WITH CHECK(vantis_core.role_for(departamento_id)='admin');
CREATE POLICY transfer_read ON public.vantis_traslados_v4 FOR SELECT TO authenticated USING(vantis_core.can_use(departamento_id));

CREATE OR REPLACE FUNCTION vantis_core.transfer(
 p_operacion_id uuid,p_departamento uuid,p_sku text,p_origen text,p_destino text,p_cantidad integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.vantis_traslados_v4%ROWTYPE; p public.productos%ROWTYPE;
 origin_qty bigint; target_qty bigint;
BEGIN
 IF NOT vantis_core.can_use(p_departamento) THEN
   RAISE EXCEPTION 'Acceso no autorizado al departamento.' USING ERRCODE='42501'; END IF;
 IF p_operacion_id IS NULL OR length(trim(coalesce(p_sku,''))) NOT BETWEEN 1 AND 120
 OR trim(coalesce(p_origen,''))='' OR trim(coalesce(p_destino,''))=''
 OR p_origen=p_destino OR p_cantidad IS NULL OR p_cantidad NOT BETWEEN 1 AND 100000
 THEN RAISE EXCEPTION 'Traslado inválido.' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operacion_id::text,0));
 SELECT * INTO old FROM public.vantis_traslados_v4 WHERE operacion_id=p_operacion_id;
 IF FOUND THEN
  IF old.usuario_id IS DISTINCT FROM auth.uid() OR old.departamento_id<>p_departamento OR old.sku<>p_sku
     OR old.origen<>p_origen OR old.destino<>p_destino OR old.cantidad<>p_cantidad
  THEN RAISE EXCEPTION 'Folio utilizado con otros parámetros.' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('operacion_id',p_operacion_id,'repetida',true,'cantidad',p_cantidad);
 END IF;
 SELECT * INTO p FROM public.productos WHERE sku=p_sku AND departamento_id=p_departamento AND activo FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SKU no disponible.' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM public.marbetes WHERE codigo IN(p_origen,p_destino) AND departamento_id=p_departamento AND activo)<>2
 THEN RAISE EXCEPTION 'Marbete de origen o destino inválido.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.producto_marbetes(sku,marbete_codigo,cantidad) VALUES(p_sku,p_destino,0)
 ON CONFLICT(sku,marbete_codigo) DO NOTHING;
 PERFORM 1 FROM public.producto_marbetes WHERE sku=p_sku
   AND marbete_codigo IN(p_origen,p_destino) ORDER BY marbete_codigo FOR UPDATE;
 SELECT cantidad INTO origin_qty FROM public.producto_marbetes WHERE sku=p_sku AND marbete_codigo=p_origen;
 SELECT cantidad INTO target_qty FROM public.producto_marbetes WHERE sku=p_sku AND marbete_codigo=p_destino;
 IF origin_qty IS NULL OR origin_qty<p_cantidad OR target_qty IS NULL THEN
   RAISE EXCEPTION 'Ubicación sin cantidad suficiente o sin conciliar.' USING ERRCODE='22023'; END IF;
 UPDATE public.producto_marbetes SET cantidad=origin_qty-p_cantidad,updated_at=now() WHERE sku=p_sku AND marbete_codigo=p_origen;
 UPDATE public.producto_marbetes SET cantidad=target_qty+p_cantidad,updated_at=now() WHERE sku=p_sku AND marbete_codigo=p_destino;
 INSERT INTO public.vantis_traslados_v4(operacion_id,departamento_id,sku,origen,destino,cantidad,usuario_id)
 VALUES(p_operacion_id,p_departamento,p_sku,p_origen,p_destino,p_cantidad,auth.uid());
 RETURN jsonb_build_object('operacion_id',p_operacion_id,'repetida',false,'cantidad',p_cantidad,'stock_global_no_modificado',p.stock);
END $$;
CREATE OR REPLACE FUNCTION public.vantis_trasladar_v4(p_operacion_id uuid,p_departamento uuid,p_sku text,
 p_origen text,p_destino text,p_cantidad integer)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT vantis_core.transfer(p_operacion_id,p_departamento,p_sku,p_origen,p_destino,p_cantidad) $$;
REVOKE ALL ON FUNCTION vantis_core.transfer(uuid,uuid,text,text,text,integer),public.vantis_trasladar_v4(uuid,uuid,text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION vantis_core.transfer(uuid,uuid,text,text,text,integer),public.vantis_trasladar_v4(uuid,uuid,text,text,text,integer) TO authenticated;
-- Índices adicionales para 100k+ líneas y minimizar bloqueos por FK.
CREATE INDEX IF NOT EXISTS vantis_conteo_lineas_product ON public.conteo_lineas(producto_id);
CREATE INDEX IF NOT EXISTS vantis_conteo_lineas_user ON public.conteo_lineas(user_id);
CREATE INDEX IF NOT EXISTS vantis_conteos_creator ON public.conteos(creado_por);
CREATE INDEX IF NOT EXISTS vantis_conteos_dept ON public.conteos(departamento_id);
CREATE INDEX IF NOT EXISTS vantis_movimientos_user ON public.movimientos(user_id);
CREATE INDEX IF NOT EXISTS vantis_pm_marbete ON public.producto_marbetes(marbete_codigo);
CREATE INDEX IF NOT EXISTS vantis_operator_dept ON public.vantis_operadores_v4(departamento_id);
NOTIFY pgrst,'reload schema';
COMMIT;