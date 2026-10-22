-- Additive migration. Does not reset stock, alter existing RPCs or rewrite
-- existing inventory. Run as the database owner, then verify the three RPCs.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

CREATE SCHEMA IF NOT EXISTS vantis_recepcion;
REVOKE ALL ON SCHEMA vantis_recepcion FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA vantis_recepcion TO authenticated;

CREATE TABLE IF NOT EXISTS vantis_recepcion.lecturas (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  operador text NOT NULL,
  departamento_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  sku text NOT NULL,
  marbete_codigo text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('receive','undo')),
  reverses uuid REFERENCES vantis_recepcion.lecturas(id),
  captured_at timestamptz NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now(),
  request jsonb NOT NULL,
  receipt jsonb NOT NULL
);
ALTER TABLE vantis_recepcion.lecturas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE vantis_recepcion.lecturas FROM PUBLIC, anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS lecturas_reversa_unica ON vantis_recepcion.lecturas(reverses) WHERE reverses IS NOT NULL;
CREATE INDEX IF NOT EXISTS lecturas_sesion_usuario ON vantis_recepcion.lecturas(user_id,session_id,stored_at);

-- Privileged work is private, with an explicit server-side identity check.
-- The existing application has two Auth accounts; the badge is an operator
-- identifier declared in that authenticated session, not an Auth credential.
CREATE OR REPLACE FUNCTION vantis_recepcion.usuario()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF u IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = u AND lower(email) IN ('99@bodega.local','10@bodega.local')
  ) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Sesión de VANTIS no autorizada.'; END IF;
  RETURN u;
END;
$$;

CREATE OR REPLACE FUNCTION vantis_recepcion.estado()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM vantis_recepcion.usuario();
  RETURN jsonb_build_object('version',1,'atomic',true,'idempotent',true);
END;
$$;

CREATE OR REPLACE FUNCTION vantis_recepcion.activar(p_departamento uuid, p_codigo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c text := upper(trim(p_codigo)); canonical text; legacy text; m public.marbetes%ROWTYPE; made integer := 0;
BEGIN
  PERFORM vantis_recepcion.usuario();
  IF c IS NULL OR c !~ '^(ZAP-)?(402|405|459)-[0-9]{3,4}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='El código no tiene formato de marbete de zapatería.';
  END IF;
  canonical := CASE WHEN c LIKE 'ZAP-%' THEN c ELSE 'ZAP-' || c END;
  legacy := substr(canonical,5);
  IF NOT EXISTS (SELECT 1 FROM public.departamentos WHERE id=p_departamento AND activo=true) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Departamento no disponible.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.productos WHERE departamento_id=p_departamento AND activo=true
      AND (sku IN (c,canonical,legacy) OR upc IN (c,canonical,legacy))) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Este código identifica un producto; no se activó como marbete.';
  END IF;
  SELECT * INTO m FROM public.marbetes WHERE codigo IN (canonical,legacy)
    ORDER BY (codigo=c) DESC,(codigo=canonical) DESC LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.marbetes(codigo,departamento_id,zona,activo,descripcion,updated_at)
      VALUES(canonical,p_departamento,'BODEGA',true,NULL,now()) ON CONFLICT(codigo) DO NOTHING;
    GET DIAGNOSTICS made = ROW_COUNT;
    SELECT * INTO STRICT m FROM public.marbetes WHERE codigo=canonical;
  END IF;
  IF m.departamento_id IS DISTINCT FROM p_departamento THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='El marbete pertenece a otro departamento.';
  END IF;
  IF m.activo IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='El marbete está inactivo.';
  END IF;
  RETURN jsonb_build_object('codigo',m.codigo,'departamento_id',m.departamento_id,'activo',m.activo,'created',made>0);
END;
$$;

CREATE OR REPLACE FUNCTION vantis_recepcion.recibir(
  p_id uuid, p_sesion uuid, p_departamento uuid, p_producto uuid,
  p_marbete text, p_operador text, p_leida_en timestamptz, p_reversa uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u uuid := vantis_recepcion.usuario();
  req jsonb; previous vantis_recepcion.lecturas%ROWTYPE; original vantis_recepcion.lecturas%ROWTYPE;
  p public.productos%ROWTYPE; m jsonb; movement record;
  stock_before bigint; qty_before bigint; stock_after bigint; delta integer; kind text; note text; receipt jsonb;
BEGIN
  IF p_id IS NULL OR p_sesion IS NULL OR p_producto IS NULL OR p_departamento IS NULL OR
     p_leida_en IS NULL OR NOT isfinite(p_leida_en) OR nullif(trim(p_operador),'') IS NULL OR length(p_operador)>120 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Lectura o responsable incompleto.';
  END IF;
  req := jsonb_build_object('session_id',p_sesion,'department_id',p_departamento,'product_id',p_producto,
    'marbete',p_marbete,'operator',p_operador,'captured_at',p_leida_en,'reverses',p_reversa);
  -- Same event from a retry or a second tab is serialized before doing work.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  SELECT * INTO previous FROM vantis_recepcion.lecturas WHERE id=p_id;
  IF FOUND THEN
    IF previous.user_id IS DISTINCT FROM u OR previous.request IS DISTINCT FROM req THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='El identificador ya pertenece a otra lectura.';
    END IF;
    RETURN previous.receipt;
  END IF;

  delta := CASE WHEN p_reversa IS NULL THEN 1 ELSE -1 END;
  kind := CASE WHEN delta=1 THEN 'receive' ELSE 'undo' END;
  IF p_reversa IS NOT NULL THEN
    SELECT * INTO original FROM vantis_recepcion.lecturas WHERE id=p_reversa FOR UPDATE;
    IF NOT FOUND OR original.user_id IS DISTINCT FROM u OR original.session_id IS DISTINCT FROM p_sesion
       OR original.kind<>'receive' OR original.producto_id IS DISTINCT FROM p_producto
       OR original.departamento_id IS DISTINCT FROM p_departamento OR original.marbete_codigo IS DISTINCT FROM p_marbete THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='La entrada original no corresponde a esta sesión.';
    END IF;
    IF EXISTS (SELECT 1 FROM vantis_recepcion.lecturas WHERE reverses=p_reversa) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Esta entrada ya fue compensada.';
    END IF;
  END IF;

  -- Every simultaneous operator locks the SAME product, independent of
  -- session, browser and marbete. Stock and location update in one transaction.
  SELECT * INTO p FROM public.productos WHERE id=p_producto FOR UPDATE;
  IF NOT FOUND OR p.departamento_id IS DISTINCT FROM p_departamento OR p.activo IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Producto no disponible en este departamento.';
  END IF;
  m := vantis_recepcion.activar(p_departamento,p_marbete);
  IF m->>'codigo' IS DISTINCT FROM p_marbete THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Revalida el código canónico del marbete.';
  END IF;
  INSERT INTO public.producto_marbetes(sku,marbete_codigo,cantidad,updated_at)
    VALUES(p.sku,p_marbete,0,now()) ON CONFLICT(sku,marbete_codigo) DO NOTHING;
  SELECT coalesce(cantidad,0)::bigint INTO STRICT qty_before FROM public.producto_marbetes
    WHERE sku=p.sku AND marbete_codigo=p_marbete FOR UPDATE;
  stock_before := coalesce(p.stock,0)::bigint;
  IF delta<0 AND (stock_before<1 OR qty_before<1) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='La pieza ya no está disponible para compensar en esta ubicación.';
  END IF;
  note := 'RECEPCIÓN CONTINUA · Sesión ' || p_sesion || ' · ' || p_operador ||
    CASE WHEN delta<0 THEN ' · COMPENSA ' || p_reversa ELSE '' END;
  -- Reuse the app's existing inventory/audit infrastructure. A failure of
  -- ANY check below rolls back this call, the assignment AND the ledger.
  PERFORM public.mover_stock_v2(p_token=>NULL,p_id=>p_id,p_producto=>p_producto,
    p_tipo=>CASE WHEN delta=1 THEN 'ENTRADA' ELSE 'SALIDA' END,p_cantidad=>1,p_marbete=>p_marbete,p_nota=>note);
  SELECT stock INTO STRICT stock_after FROM public.productos WHERE id=p_producto;
  IF stock_after IS DISTINCT FROM stock_before+delta THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='El servidor no confirmó la variación exacta de stock.';
  END IF;
  -- mover_stock_v2 ya incrementa la cantidad por marbete de forma atómica.
  -- Solo verificar: actualizar otra vez sumaría doble cada pieza escaneada.
  PERFORM 1 FROM public.producto_marbetes
    WHERE sku=p.sku AND marbete_codigo=p_marbete AND cantidad=qty_before+delta;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Cantidad de marbete inconsistente después de recepción.';
  END IF;
  SELECT id,tipo,sku,cantidad,departamento_id,marbete_codigo,stock_resultante,created_at INTO movement
    FROM public.movimientos WHERE id=p_id;
  IF NOT FOUND OR movement.tipo::text IS DISTINCT FROM (CASE WHEN delta=1 THEN 'ENTRADA' ELSE 'SALIDA' END)
    OR movement.sku IS DISTINCT FROM p.sku OR movement.cantidad IS DISTINCT FROM 1
    OR movement.departamento_id IS DISTINCT FROM p_departamento OR movement.marbete_codigo IS DISTINCT FROM p_marbete
    OR movement.stock_resultante IS DISTINCT FROM stock_after OR movement.created_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='No existe un movimiento de inventario consistente con esta lectura.';
  END IF;
  receipt := jsonb_build_object('id',p_id,'session_id',p_sesion,'user_id',u,'operator',p_operador,
    'product_id',p_producto,'sku',p.sku,'marbete_codigo',p_marbete,'quantity',1,'kind',kind,
    'stock_resultante',stock_after,'location_quantity',qty_before+delta,'stored_at',movement.created_at);
  INSERT INTO vantis_recepcion.lecturas(id,session_id,user_id,operador,departamento_id,producto_id,sku,marbete_codigo,kind,reverses,captured_at,request,receipt)
    VALUES(p_id,p_sesion,u,p_operador,p_departamento,p_producto,p.sku,p_marbete,kind,p_reversa,p_leida_en,req,receipt);
  RETURN receipt;
END;
$$;

-- Only these invoker wrappers are exposed through PostgREST. The ledger and
-- security-definer routines live in a non-exposed schema, with no table DML.
CREATE OR REPLACE FUNCTION public.vantis_recepcion_estado_v1()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT vantis_recepcion.estado(); $$;
CREATE OR REPLACE FUNCTION public.vantis_activar_marbete_v1(p_departamento uuid,p_codigo text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT vantis_recepcion.activar(p_departamento,p_codigo); $$;
CREATE OR REPLACE FUNCTION public.vantis_recibir_pieza_v1(
  p_id uuid,p_sesion uuid,p_departamento uuid,p_producto uuid,p_marbete text,p_operador text,p_leida_en timestamptz,p_reversa uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT vantis_recepcion.recibir(p_id,p_sesion,p_departamento,p_producto,p_marbete,p_operador,p_leida_en,p_reversa);
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vantis_recepcion FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION vantis_recepcion.estado(),vantis_recepcion.activar(uuid,text),vantis_recepcion.recibir(uuid,uuid,uuid,uuid,text,text,timestamptz,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.vantis_recepcion_estado_v1(),public.vantis_activar_marbete_v1(uuid,text),public.vantis_recibir_pieza_v1(uuid,uuid,uuid,uuid,text,text,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vantis_recepcion_estado_v1(),public.vantis_activar_marbete_v1(uuid,text),public.vantis_recibir_pieza_v1(uuid,uuid,uuid,uuid,text,text,timestamptz,uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
