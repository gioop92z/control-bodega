
-- VANTIS v5 | Conteo cíclico supervisado e incidencias ampliadas
-- Nunca modifica productos.stock ni producto_marbetes. La aprobación no aplica ajustes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.vantis_ciclos_v5(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 departamento_id uuid NOT NULL REFERENCES public.departamentos(id),
 marbete_codigo text NOT NULL REFERENCES public.marbetes(codigo),
 nombre text NOT NULL CHECK(length(btrim(nombre)) BETWEEN 3 AND 120),
 asignado_gafete text NOT NULL CHECK(length(btrim(asignado_gafete)) BETWEEN 1 AND 30),
 estado text NOT NULL DEFAULT 'ABIERTO' CHECK(estado IN ('ABIERTO','EN_REVISION','APROBADO')),
 creado_por uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
 aprobado_por uuid REFERENCES auth.users(id),
 aprobado_en timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vantis_ciclos_v5_depto_fecha ON public.vantis_ciclos_v5(departamento_id,created_at DESC);
CREATE INDEX IF NOT EXISTS vantis_ciclos_v5_estado ON public.vantis_ciclos_v5(departamento_id,estado);
CREATE TABLE IF NOT EXISTS public.vantis_ciclo_lineas_v5(
 ciclo_id uuid NOT NULL REFERENCES public.vantis_ciclos_v5(id) ON DELETE RESTRICT,
 sku text NOT NULL REFERENCES public.productos(sku),
 esperado bigint CHECK(esperado IS NULL OR esperado>=0),
 contado bigint NOT NULL CHECK(contado BETWEEN 0 AND 1000000),
 registrado_por uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(ciclo_id,sku)
);
CREATE INDEX IF NOT EXISTS vantis_ciclo_lineas_v5_sku ON public.vantis_ciclo_lineas_v5(sku);
ALTER TABLE public.vantis_ciclos_v5 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vantis_ciclo_lineas_v5 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vantis_ciclos_v5,public.vantis_ciclo_lineas_v5 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.vantis_ciclos_v5,public.vantis_ciclo_lineas_v5 TO authenticated;
DROP POLICY IF EXISTS vantis_ciclos_v5_read ON public.vantis_ciclos_v5;
CREATE POLICY vantis_ciclos_v5_read ON public.vantis_ciclos_v5 FOR SELECT TO authenticated
 USING(vantis_core.can_use(departamento_id));
DROP POLICY IF EXISTS vantis_ciclo_lineas_v5_read ON public.vantis_ciclo_lineas_v5;
CREATE POLICY vantis_ciclo_lineas_v5_read ON public.vantis_ciclo_lineas_v5 FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.vantis_ciclos_v5 c WHERE c.id=ciclo_id AND vantis_core.can_use(c.departamento_id)));

-- Evita que clientes escriban estados o existencias directamente: solo RPC validada.
CREATE OR REPLACE FUNCTION vantis_core.ciclo_crear_v5(p_departamento uuid,p_marbete text,p_nombre text,p_gafete text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR vantis_core.role_for(p_departamento) IS DISTINCT FROM 'admin'
 THEN RAISE EXCEPTION 'Solo un administrador puede asignar conteos.' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_nombre,''))) NOT BETWEEN 3 AND 120 OR length(btrim(coalesce(p_gafete,''))) NOT BETWEEN 1 AND 30
 THEN RAISE EXCEPTION 'Nombre o gafete inválido.' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.marbetes WHERE codigo=p_marbete AND departamento_id=p_departamento AND activo)
 THEN RAISE EXCEPTION 'Marbete inexistente o fuera de departamento.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.vantis_ciclos_v5(departamento_id,marbete_codigo,nombre,asignado_gafete,creado_por)
 VALUES(p_departamento,p_marbete,btrim(p_nombre),btrim(p_gafete),auth.uid()) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION vantis_core.ciclo_registrar_v5(p_ciclo uuid,p_sku text,p_cantidad bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.vantis_ciclos_v5%ROWTYPE; v_esperado bigint; v_sku text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesión requerida.' USING ERRCODE='42501'; END IF;
 IF p_cantidad IS NULL OR p_cantidad NOT BETWEEN 0 AND 1000000
 THEN RAISE EXCEPTION 'Cantidad inválida.' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.vantis_ciclos_v5 WHERE id=p_ciclo FOR UPDATE;
 IF NOT FOUND OR NOT vantis_core.can_use(c.departamento_id)
 THEN RAISE EXCEPTION 'Conteo no autorizado.' USING ERRCODE='42501'; END IF;
 IF c.estado<>'ABIERTO' THEN RAISE EXCEPTION 'Conteo cerrado para captura.' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.productos p WHERE p.sku=p_sku AND p.departamento_id=c.departamento_id AND p.activo)
 THEN RAISE EXCEPTION 'El SKU no pertenece a este departamento.' USING ERRCODE='22023'; END IF;
 SELECT pm.cantidad INTO v_esperado FROM public.producto_marbetes pm
 WHERE pm.sku=p_sku AND pm.marbete_codigo=c.marbete_codigo;
 INSERT INTO public.vantis_ciclo_lineas_v5(ciclo_id,sku,esperado,contado,registrado_por)
 VALUES(p_ciclo,p_sku,v_esperado,p_cantidad,auth.uid())
 ON CONFLICT(ciclo_id,sku) DO UPDATE SET contado=EXCLUDED.contado,updated_at=now(),registrado_por=auth.uid()
 RETURNING sku INTO v_sku;
 RETURN pg_catalog.jsonb_build_object('sku',v_sku,'contado',p_cantidad,'esperado',v_esperado,'comparacion',case when v_esperado is null then 'SIN_BASE' when v_esperado=p_cantidad then 'IGUAL' else 'DIFERENCIA' end);
END $$;
CREATE OR REPLACE FUNCTION vantis_core.ciclo_presentar_v5(p_ciclo uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.vantis_ciclos_v5%ROWTYPE;
BEGIN
 SELECT * INTO c FROM public.vantis_ciclos_v5 WHERE id=p_ciclo FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT vantis_core.can_use(c.departamento_id)
 THEN RAISE EXCEPTION 'No autorizado.' USING ERRCODE='42501'; END IF;
 IF c.estado<>'ABIERTO' THEN RETURN c.estado; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vantis_ciclo_lineas_v5 WHERE ciclo_id=p_ciclo)
 THEN RAISE EXCEPTION 'El conteo no tiene líneas.' USING ERRCODE='22023'; END IF;
 UPDATE public.vantis_ciclos_v5 SET estado='EN_REVISION',updated_at=now() WHERE id=p_ciclo;
 RETURN 'EN_REVISION';
END $$;
CREATE OR REPLACE FUNCTION vantis_core.ciclo_aprobar_v5(p_ciclo uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.vantis_ciclos_v5%ROWTYPE;
BEGIN
 SELECT * INTO c FROM public.vantis_ciclos_v5 WHERE id=p_ciclo FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR vantis_core.role_for(c.departamento_id) IS DISTINCT FROM 'admin'
 THEN RAISE EXCEPTION 'Aprobación exclusiva de administrador.' USING ERRCODE='42501'; END IF;
 IF c.estado='APROBADO' THEN RETURN 'APROBADO'; END IF;
 IF c.estado<>'EN_REVISION' THEN RAISE EXCEPTION 'Primero entrega el conteo para revisión.' USING ERRCODE='22023'; END IF;
 UPDATE public.vantis_ciclos_v5 SET estado='APROBADO',aprobado_por=auth.uid(),aprobado_en=now(),updated_at=now() WHERE id=p_ciclo;
 RETURN 'APROBADO';
END $$;
CREATE OR REPLACE FUNCTION public.vantis_ciclo_crear_v5(p_departamento uuid,p_marbete text,p_nombre text,p_gafete text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT vantis_core.ciclo_crear_v5(p_departamento,p_marbete,p_nombre,p_gafete) $$;
CREATE OR REPLACE FUNCTION public.vantis_ciclo_registrar_v5(p_ciclo uuid,p_sku text,p_cantidad bigint)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT vantis_core.ciclo_registrar_v5(p_ciclo,p_sku,p_cantidad) $$;
CREATE OR REPLACE FUNCTION public.vantis_ciclo_presentar_v5(p_ciclo uuid)
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT vantis_core.ciclo_presentar_v5(p_ciclo) $$;
CREATE OR REPLACE FUNCTION public.vantis_ciclo_aprobar_v5(p_ciclo uuid)
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT vantis_core.ciclo_aprobar_v5(p_ciclo) $$;
REVOKE ALL ON FUNCTION
 vantis_core.ciclo_crear_v5(uuid,text,text,text),vantis_core.ciclo_registrar_v5(uuid,text,bigint),
 vantis_core.ciclo_presentar_v5(uuid),vantis_core.ciclo_aprobar_v5(uuid),
 public.vantis_ciclo_crear_v5(uuid,text,text,text),public.vantis_ciclo_registrar_v5(uuid,text,bigint),
 public.vantis_ciclo_presentar_v5(uuid),public.vantis_ciclo_aprobar_v5(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
 vantis_core.ciclo_crear_v5(uuid,text,text,text),vantis_core.ciclo_registrar_v5(uuid,text,bigint),
 vantis_core.ciclo_presentar_v5(uuid),vantis_core.ciclo_aprobar_v5(uuid),
 public.vantis_ciclo_crear_v5(uuid,text,text,text),public.vantis_ciclo_registrar_v5(uuid,text,bigint),
 public.vantis_ciclo_presentar_v5(uuid),public.vantis_ciclo_aprobar_v5(uuid) TO authenticated;

-- Incidencias: extensión no destructiva sobre el módulo anterior.
ALTER TABLE public.vantis_incidencias_v4
 ADD COLUMN IF NOT EXISTS marbete_codigo text,
 ADD COLUMN IF NOT EXISTS responsable text,
 ADD COLUMN IF NOT EXISTS resolucion text,
 ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.vantis_incidencias_v4 DROP CONSTRAINT IF EXISTS vantis_incidencias_v4_tipo_check;
ALTER TABLE public.vantis_incidencias_v4 ADD CONSTRAINT vantis_incidencias_v4_tipo_check
 CHECK(tipo IN ('DANIO','DIFERENCIA','PERDIDA','DEVOLUCION','CODIGO_ILEGIBLE','UBICACION','EVIDENCIA'));
ALTER TABLE public.vantis_incidencias_v4
 ADD CONSTRAINT vantis_incidencia_responsable_length_v5 CHECK(responsable IS NULL OR length(responsable)<=90);
GRANT UPDATE(estado,resolucion,updated_at) ON public.vantis_incidencias_v4 TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;