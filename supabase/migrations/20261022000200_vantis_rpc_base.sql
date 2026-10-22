-- RPC transaccionales del inventario; solo exponen envolturas invoker a usuarios Auth.
BEGIN;
CREATE OR REPLACE FUNCTION vantis_core.move_stock(
 p_token text, p_id uuid, p_producto uuid, p_tipo text, p_cantidad integer,
 p_marbete text, p_nota text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.productos%ROWTYPE; prev public.movimientos%ROWTYPE; delta bigint; current_qty bigint;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicia sesión.' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_producto IS NULL OR p_tipo NOT IN ('ENTRADA','SALIDA')
   OR p_cantidad IS NULL OR p_cantidad NOT BETWEEN 1 AND 100000 OR length(coalesce(p_nota,''))>1000
 THEN RAISE EXCEPTION 'Movimiento inválido.' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 SELECT * INTO prev FROM public.movimientos WHERE id=p_id;
 IF FOUND THEN
   IF prev.user_id IS DISTINCT FROM auth.uid() OR prev.tipo<>p_tipo
     OR prev.cantidad<>p_cantidad OR prev.marbete_codigo IS DISTINCT FROM p_marbete
     OR prev.sku IS DISTINCT FROM (SELECT sku FROM public.productos WHERE id=p_producto)
     OR prev.nota IS DISTINCT FROM p_nota
   THEN RAISE EXCEPTION 'El folio corresponde a otra operación.' USING ERRCODE='23505'; END IF;
   RETURN pg_catalog.jsonb_build_object('id',prev.id,'stock_resultante',prev.stock_resultante,'repetida',true);
 END IF;
 SELECT * INTO v FROM public.productos WHERE id=p_producto FOR UPDATE;
 IF NOT FOUND OR NOT v.activo OR NOT vantis_core.can_use(v.departamento_id) THEN
  RAISE EXCEPTION 'SKU o departamento sin autorización.' USING ERRCODE='42501'; END IF;
 delta:=CASE WHEN p_tipo='ENTRADA' THEN p_cantidad ELSE -p_cantidad END;
 IF v.stock+delta<0 THEN RAISE EXCEPTION 'Existencias insuficientes.' USING ERRCODE='22023'; END IF;
 IF p_marbete IS NOT NULL AND trim(p_marbete)<>'' THEN
   IF NOT EXISTS(SELECT 1 FROM public.marbetes m WHERE m.codigo=p_marbete AND m.departamento_id=v.departamento_id AND m.activo)
   THEN RAISE EXCEPTION 'Marbete no registrado en el departamento.' USING ERRCODE='22023'; END IF;
   INSERT INTO public.producto_marbetes(sku,marbete_codigo,cantidad)
     VALUES(v.sku,p_marbete,0) ON CONFLICT(sku,marbete_codigo) DO NOTHING;
   SELECT cantidad INTO current_qty FROM public.producto_marbetes
     WHERE sku=v.sku AND marbete_codigo=p_marbete FOR UPDATE;
   IF current_qty IS NULL THEN RAISE EXCEPTION 'Cantidad por ubicación pendiente de conciliación.' USING ERRCODE='22023'; END IF;
   IF current_qty+delta<0 THEN RAISE EXCEPTION 'Sin piezas suficientes en este marbete.' USING ERRCODE='22023'; END IF;
   UPDATE public.producto_marbetes SET cantidad=current_qty+delta,updated_at=now()
     WHERE sku=v.sku AND marbete_codigo=p_marbete;
 END IF;
 UPDATE public.productos SET stock=v.stock+delta,updated_at=now() WHERE id=v.id;
 INSERT INTO public.movimientos(id,tipo,sku,upc,descripcion,cantidad,impacto,departamento_id,marbete_codigo,
 stock_anterior,stock_resultante,nota,user_id,user_nombre,empleado_puesto)
 VALUES(p_id,p_tipo,v.sku,v.upc,v.descripcion,p_cantidad,delta,v.departamento_id,p_marbete,
 v.stock,v.stock+delta,p_nota,auth.uid(),
 CASE WHEN vantis_core.role_for(v.departamento_id)='admin' THEN 'Administrador' ELSE 'Operador' END,
 CASE WHEN vantis_core.role_for(v.departamento_id)='admin' THEN 'Jefe' ELSE 'Vendedor' END);
 RETURN pg_catalog.jsonb_build_object('id',p_id,'stock_resultante',v.stock+delta,'repetida',false);
END $$;
CREATE OR REPLACE FUNCTION public.mover_stock_v2(p_token text,p_id uuid,p_producto uuid,p_tipo text,p_cantidad integer,p_marbete text,p_nota text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT vantis_core.move_stock(p_token,p_id,p_producto,p_tipo,p_cantidad,p_marbete,p_nota) $$;

CREATE OR REPLACE FUNCTION vantis_core.create_unknown(p_token text,p_departamento uuid,p_codigo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.productos%ROWTYPE; code text:=trim(p_codigo);
BEGIN
 IF NOT vantis_core.can_use(p_departamento) THEN RAISE EXCEPTION 'Sin acceso a este departamento.' USING ERRCODE='42501'; END IF;
 IF code IS NULL OR length(code) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'SKU incorrecto.' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.departamentos WHERE id=p_departamento AND activo)
 THEN RAISE EXCEPTION 'Departamento desactivado.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.productos(departamento_id,sku,descripcion,stock,stock_minimo)
 VALUES(p_departamento,code,'SIN DESCRIPCIÓN · SKU PENDIENTE',0,0)
 ON CONFLICT(sku) DO NOTHING;
 SELECT * INTO p FROM public.productos WHERE sku=code;
 IF p.departamento_id IS DISTINCT FROM p_departamento THEN RAISE EXCEPTION 'SKU registrado en un departamento diferente.' USING ERRCODE='23505'; END IF;
 RETURN pg_catalog.jsonb_build_object('id',p.id,'sku',p.sku,'stock',p.stock);
END $$;
CREATE OR REPLACE FUNCTION public.crear_producto_codigo(p_token text,p_departamento uuid,p_codigo text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT vantis_core.create_unknown(p_token,p_departamento,p_codigo) $$;

CREATE OR REPLACE FUNCTION vantis_core.import_catalog(p_departamento uuid,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e jsonb; code text; target public.productos%ROWTYPE; nuevos integer:=0; actualizados integer:=0; new_price numeric;
BEGIN
 IF vantis_core.role_for(p_departamento) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Solo administración importa catálogos.' USING ERRCODE='42501'; END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)>500
 THEN RAISE EXCEPTION 'Lote inválido (máximo 500 productos).' USING ERRCODE='22023'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  code:=trim(e->>'sku');
  IF length(coalesce(code,'')) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'SKU de catálogo inválido.' USING ERRCODE='22023'; END IF;
  IF (e->>'precio') IS NOT NULL THEN
    new_price:=(e->>'precio')::numeric;
    IF new_price<0 OR new_price>9999999999 THEN RAISE EXCEPTION 'Precio fuera de rango.' USING ERRCODE='22023'; END IF;
  ELSE new_price:=0; END IF;
  SELECT * INTO target FROM public.productos WHERE sku=code FOR UPDATE;
  IF FOUND THEN
    IF target.departamento_id<>p_departamento THEN RAISE EXCEPTION 'SKU duplicado en otro departamento: %',code USING ERRCODE='23505'; END IF;
    UPDATE public.productos SET
      upc=COALESCE(NULLIF(trim(e->>'upc'),''),upc),
      descripcion=COALESCE(NULLIF(trim(e->>'descripcion'),''),descripcion),
      marca=COALESCE(NULLIF(trim(e->>'marca'),''),marca),
      talla=COALESCE(NULLIF(trim(e->>'talla'),''),talla),
      color=COALESCE(NULLIF(trim(e->>'color'),''),color),
      precio=CASE WHEN new_price>0 THEN new_price ELSE precio END,
      stock_minimo=GREATEST(0,COALESCE((e->>'minimo')::bigint,stock_minimo)),
      updated_at=now() WHERE id=target.id;
    actualizados:=actualizados+1;
  ELSE
    INSERT INTO public.productos(departamento_id,sku,upc,descripcion,marca,talla,color,precio,stock_minimo)
    VALUES(p_departamento,code,NULLIF(trim(e->>'upc'),''),
      COALESCE(NULLIF(trim(e->>'descripcion'),''),'SIN DESCRIPCIÓN · SKU PENDIENTE'),
      NULLIF(trim(e->>'marca'),''),NULLIF(trim(e->>'talla'),''),NULLIF(trim(e->>'color'),''),
      new_price,GREATEST(0,COALESCE((e->>'minimo')::bigint,0)));
    nuevos:=nuevos+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('nuevos',nuevos,'actualizados',actualizados);
END $$;
CREATE OR REPLACE FUNCTION public.importar_catalogo(p_departamento uuid,p_items jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT vantis_core.import_catalog(p_departamento,p_items) $$;

CREATE OR REPLACE FUNCTION vantis_core.physical_adjust(p_items jsonb,p_nota text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e jsonb; p public.productos%ROWTYPE; target bigint; ajustados integer:=0;
BEGIN
 IF auth.uid() IS NULL OR p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)>500
 THEN RAISE EXCEPTION 'Lote inválido.' USING ERRCODE='22023'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  target:=(e->>'stock')::bigint;
  IF target IS NULL OR target<0 THEN RAISE EXCEPTION 'Stock físico inválido.' USING ERRCODE='22023'; END IF;
  SELECT * INTO p FROM public.productos WHERE sku=trim(e->>'sku') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SKU no encontrado en ajuste físico.' USING ERRCODE='22023'; END IF;
  IF vantis_core.role_for(p.departamento_id) IS DISTINCT FROM 'admin' THEN
   RAISE EXCEPTION 'Ajuste requiere administración.' USING ERRCODE='42501'; END IF;
  IF target<>p.stock THEN
    UPDATE public.productos SET stock=target,updated_at=now() WHERE id=p.id;
    INSERT INTO public.movimientos(id,tipo,sku,upc,descripcion,cantidad,impacto,departamento_id,stock_anterior,stock_resultante,nota,user_id,user_nombre)
    VALUES(gen_random_uuid(),'AJUSTE',p.sku,p.upc,p.descripcion,abs(target-p.stock),target-p.stock,p.departamento_id,p.stock,target,p_nota,auth.uid(),'Administrador');
    ajustados:=ajustados+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('ajustados',ajustados);
END $$;
CREATE OR REPLACE FUNCTION public.ajuste_fisico_masivo(p_items jsonb,p_nota text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT vantis_core.physical_adjust(p_items,p_nota) $$;

CREATE OR REPLACE FUNCTION public.resumen_departamento(p_departamento uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE x jsonb;
BEGIN
 IF NOT vantis_core.can_use(p_departamento) THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
  'productos',(SELECT count(*) FROM public.productos WHERE departamento_id=p_departamento AND activo),
  'unidades',(SELECT coalesce(sum(stock),0) FROM public.productos WHERE departamento_id=p_departamento AND activo),
  'movimientos',(SELECT count(*) FROM public.movimientos WHERE departamento_id=p_departamento AND created_at>=current_date),
  'entradas',(SELECT coalesce(sum(cantidad),0) FROM public.movimientos WHERE departamento_id=p_departamento AND tipo='ENTRADA' AND created_at>=current_date),
  'salidas',(SELECT coalesce(sum(cantidad),0) FROM public.movimientos WHERE departamento_id=p_departamento AND tipo='SALIDA' AND created_at>=current_date)
 ) INTO x; RETURN x;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vantis_core FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION vantis_core.role_for(uuid),vantis_core.can_use(uuid),
 vantis_core.move_stock(text,uuid,uuid,text,integer,text,text),
 vantis_core.create_unknown(text,uuid,text),vantis_core.import_catalog(uuid,jsonb),
 vantis_core.physical_adjust(jsonb,text) TO authenticated;
REVOKE ALL ON FUNCTION public.mover_stock_v2(text,uuid,uuid,text,integer,text,text),
 public.crear_producto_codigo(text,uuid,text),public.importar_catalogo(uuid,jsonb),
 public.ajuste_fisico_masivo(jsonb,text),public.resumen_departamento(uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mover_stock_v2(text,uuid,uuid,text,integer,text,text),
 public.crear_producto_codigo(text,uuid,text),public.importar_catalogo(uuid,jsonb),
 public.ajuste_fisico_masivo(jsonb,text),public.resumen_departamento(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;