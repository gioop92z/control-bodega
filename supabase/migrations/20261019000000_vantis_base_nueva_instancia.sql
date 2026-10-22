-- VANTIS: esquema base limpio para la instancia nueva. No importa ni inventa inventario antiguo.
-- Idempotente en base vacía. Las cuentas Auth y la copia de inventario se realizan después.
BEGIN;
CREATE SCHEMA IF NOT EXISTS vantis_core;
REVOKE ALL ON SCHEMA vantis_core FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA vantis_core TO authenticated;

CREATE TABLE IF NOT EXISTS public.departamentos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 nombre text NOT NULL CHECK(length(trim(nombre)) BETWEEN 1 AND 120),
 activo boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.productos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 departamento_id uuid NOT NULL REFERENCES public.departamentos(id),
 sku text NOT NULL UNIQUE CHECK(length(trim(sku)) BETWEEN 1 AND 120),
 upc text, descripcion text NOT NULL DEFAULT 'SIN DESCRIPCIÓN · SKU PENDIENTE',
 marca text, talla text, color text, precio numeric(14,2) NOT NULL DEFAULT 0,
 stock bigint NOT NULL DEFAULT 0 CHECK(stock>=0),
 stock_minimo bigint NOT NULL DEFAULT 0 CHECK(stock_minimo>=0),
 activo boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vantis_productos_upc_dept ON public.productos(departamento_id,upc);
CREATE INDEX IF NOT EXISTS vantis_productos_dept_stock ON public.productos(departamento_id,stock);
CREATE TABLE IF NOT EXISTS public.marbetes (
 codigo text PRIMARY KEY, departamento_id uuid NOT NULL REFERENCES public.departamentos(id),
 zona text NOT NULL DEFAULT 'BODEGA', descripcion text,
 activo boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vantis_marbetes_dept ON public.marbetes(departamento_id,codigo);
CREATE TABLE IF NOT EXISTS public.producto_marbetes (
 sku text NOT NULL REFERENCES public.productos(sku),
 marbete_codigo text NOT NULL REFERENCES public.marbetes(codigo),
 cantidad bigint CHECK(cantidad>=0),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(sku,marbete_codigo)
);
CREATE TABLE IF NOT EXISTS public.movimientos (
 id uuid PRIMARY KEY, tipo text NOT NULL CHECK(tipo IN ('ENTRADA','SALIDA','AJUSTE')),
 sku text NOT NULL, upc text, descripcion text,
 cantidad bigint NOT NULL CHECK(cantidad>0), impacto bigint NOT NULL,
 departamento_id uuid NOT NULL REFERENCES public.departamentos(id),
 marbete_codigo text, stock_anterior bigint NOT NULL,
 stock_resultante bigint NOT NULL CHECK(stock_resultante>=0),
 nota text, user_id uuid REFERENCES auth.users(id), user_nombre text,
 empleado_puesto text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vantis_movimientos_dept_fecha ON public.movimientos(departamento_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.conteos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), departamento_id uuid NOT NULL REFERENCES public.departamentos(id),
 nombre text NOT NULL, estado text NOT NULL DEFAULT 'ABIERTO' CHECK(estado IN ('ABIERTO','PAUSADO','CERRADO')),
 creado_nombre text, creado_por uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.conteo_lineas (
 conteo_id uuid NOT NULL REFERENCES public.conteos(id), producto_id uuid NOT NULL REFERENCES public.productos(id),
 sku text NOT NULL, contado bigint NOT NULL CHECK(contado>=0),
 user_id uuid REFERENCES auth.users(id), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(conteo_id,producto_id)
);
CREATE TABLE IF NOT EXISTS public.vantis_operadores_v4 (
 usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 departamento_id uuid NOT NULL REFERENCES public.departamentos(id) ON DELETE CASCADE,
 rol text NOT NULL CHECK(rol IN ('admin','operador')),
 PRIMARY KEY(usuario_id,departamento_id)
);

CREATE OR REPLACE FUNCTION vantis_core.role_for(p_departamento uuid DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE
   WHEN auth.uid() IS NULL THEN NULL
   WHEN EXISTS (SELECT 1 FROM public.vantis_operadores_v4 o
     WHERE o.usuario_id=auth.uid() AND (p_departamento IS NULL OR o.departamento_id=p_departamento) AND o.rol='admin') THEN 'admin'
   WHEN EXISTS (SELECT 1 FROM auth.users u WHERE u.id=auth.uid() AND u.email='99@bodega.local') THEN 'admin'
   WHEN EXISTS (SELECT 1 FROM public.vantis_operadores_v4 o
     WHERE o.usuario_id=auth.uid() AND (p_departamento IS NULL OR o.departamento_id=p_departamento)) THEN 'operador'
   WHEN EXISTS (SELECT 1 FROM auth.users u WHERE u.id=auth.uid() AND u.email='10@bodega.local') THEN 'operador'
   ELSE NULL END
$$;
CREATE OR REPLACE FUNCTION vantis_core.can_use(p_departamento uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND p_departamento IS NOT NULL
 AND vantis_core.role_for(p_departamento) IS NOT NULL
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vantis_core FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION vantis_core.role_for(uuid),vantis_core.can_use(uuid) TO authenticated;

ALTER TABLE public.departamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marbetes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producto_marbetes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conteos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conteo_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vantis_operadores_v4 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.departamentos,public.productos,public.marbetes,public.producto_marbetes,public.movimientos,public.conteos,public.conteo_lineas,public.vantis_operadores_v4 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.departamentos, public.marbetes, public.producto_marbetes, public.conteos, public.conteo_lineas TO authenticated;
GRANT SELECT ON public.productos, public.movimientos,public.vantis_operadores_v4 TO authenticated;
GRANT UPDATE (descripcion,upc,stock_minimo) ON public.productos TO authenticated;
CREATE POLICY d_sel ON public.departamentos FOR SELECT TO authenticated USING(vantis_core.can_use(id));
CREATE POLICY d_add ON public.departamentos FOR INSERT TO authenticated WITH CHECK(vantis_core.role_for(NULL)='admin');
CREATE POLICY d_upd ON public.departamentos FOR UPDATE TO authenticated USING(vantis_core.role_for(NULL)='admin') WITH CHECK(vantis_core.role_for(NULL)='admin');
CREATE POLICY p_sel ON public.productos FOR SELECT TO authenticated USING(vantis_core.can_use(departamento_id));
CREATE POLICY p_upd ON public.productos FOR UPDATE TO authenticated USING(vantis_core.role_for(departamento_id)='admin') WITH CHECK(vantis_core.role_for(departamento_id)='admin');
CREATE POLICY m_sel ON public.marbetes FOR SELECT TO authenticated USING(vantis_core.can_use(departamento_id));
CREATE POLICY m_add ON public.marbetes FOR INSERT TO authenticated WITH CHECK(vantis_core.can_use(departamento_id));
CREATE POLICY m_upd ON public.marbetes FOR UPDATE TO authenticated USING(vantis_core.can_use(departamento_id)) WITH CHECK(vantis_core.can_use(departamento_id));
CREATE POLICY pm_sel ON public.producto_marbetes FOR SELECT TO authenticated USING(
 EXISTS (SELECT 1 FROM public.productos p WHERE p.sku=producto_marbetes.sku AND vantis_core.can_use(p.departamento_id)));
CREATE POLICY pm_ins ON public.producto_marbetes FOR INSERT TO authenticated WITH CHECK(
 EXISTS (SELECT 1 FROM public.productos p JOIN public.marbetes m ON m.codigo=producto_marbetes.marbete_codigo
 WHERE p.sku=producto_marbetes.sku AND p.departamento_id=m.departamento_id AND vantis_core.can_use(p.departamento_id)));
CREATE POLICY pm_upd ON public.producto_marbetes FOR UPDATE TO authenticated USING(
 EXISTS (SELECT 1 FROM public.productos p WHERE p.sku=producto_marbetes.sku AND vantis_core.can_use(p.departamento_id)))
 WITH CHECK(EXISTS (SELECT 1 FROM public.productos p JOIN public.marbetes m ON m.codigo=producto_marbetes.marbete_codigo WHERE p.sku=producto_marbetes.sku AND p.departamento_id=m.departamento_id AND vantis_core.can_use(p.departamento_id)));
CREATE POLICY mv_sel ON public.movimientos FOR SELECT TO authenticated USING(vantis_core.can_use(departamento_id));
CREATE POLICY c_sel ON public.conteos FOR SELECT TO authenticated USING(vantis_core.can_use(departamento_id));
CREATE POLICY c_ins ON public.conteos FOR INSERT TO authenticated WITH CHECK(vantis_core.can_use(departamento_id));
CREATE POLICY c_upd ON public.conteos FOR UPDATE TO authenticated USING(vantis_core.can_use(departamento_id)) WITH CHECK(vantis_core.can_use(departamento_id));
CREATE POLICY cl_sel ON public.conteo_lineas FOR SELECT TO authenticated USING(
 EXISTS (SELECT 1 FROM public.conteos c WHERE c.id=conteo_id AND vantis_core.can_use(c.departamento_id)));
CREATE POLICY cl_ins ON public.conteo_lineas FOR INSERT TO authenticated WITH CHECK(
 EXISTS (SELECT 1 FROM public.conteos c JOIN public.productos p ON p.id=conteo_lineas.producto_id WHERE c.id=conteo_id AND p.departamento_id=c.departamento_id AND vantis_core.can_use(c.departamento_id)));
CREATE POLICY cl_upd ON public.conteo_lineas FOR UPDATE TO authenticated USING(
 EXISTS (SELECT 1 FROM public.conteos c WHERE c.id=conteo_id AND vantis_core.can_use(c.departamento_id)))
 WITH CHECK(EXISTS (SELECT 1 FROM public.conteos c JOIN public.productos p ON p.id=conteo_lineas.producto_id WHERE c.id=conteo_id AND p.departamento_id=c.departamento_id AND vantis_core.can_use(c.departamento_id)));
CREATE POLICY vo_sel ON public.vantis_operadores_v4 FOR SELECT TO authenticated USING(usuario_id=auth.uid());

NOTIFY pgrst,'reload schema';
COMMIT;