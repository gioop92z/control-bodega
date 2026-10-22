-- Cierre idempotente de conteos, preserva auditoría y stock no contado.
BEGIN;
CREATE OR REPLACE FUNCTION vantis_core.close_count(p_conteo uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.conteos%ROWTYPE; l record; p public.productos%ROWTYPE; adjustments integer:=0; gap bigint;
BEGIN
 IF auth.uid() IS NULL OR p_conteo IS NULL THEN RAISE EXCEPTION 'Acceso requerido.' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.conteos WHERE id=p_conteo FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conteo no encontrado.' USING ERRCODE='22023'; END IF;
 IF NOT vantis_core.can_use(c.departamento_id) THEN RAISE EXCEPTION 'No autorizado.' USING ERRCODE='42501'; END IF;
 IF c.estado='CERRADO' THEN RETURN 0; END IF;
 FOR l IN SELECT producto_id,contado FROM public.conteo_lineas WHERE conteo_id=c.id ORDER BY producto_id LOOP
  SELECT * INTO p FROM public.productos WHERE id=l.producto_id AND departamento_id=c.departamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conteo contiene SKU de otro departamento.' USING ERRCODE='22023'; END IF;
  gap:=l.contado-p.stock;
  IF gap<>0 THEN
   UPDATE public.productos SET stock=l.contado,updated_at=now() WHERE id=p.id;
   INSERT INTO public.movimientos(id,tipo,sku,upc,descripcion,cantidad,impacto,departamento_id,
      stock_anterior,stock_resultante,nota,user_id,user_nombre)
   VALUES(gen_random_uuid(),'AJUSTE',p.sku,p.upc,p.descripcion,abs(gap),gap,p.departamento_id,
     p.stock,l.contado,'Cierre de conteo '||p_conteo,auth.uid(),'Conteo físico');
   adjustments:=adjustments+1;
  END IF;
 END LOOP;
 UPDATE public.conteos SET estado='CERRADO',updated_at=now() WHERE id=c.id;
 RETURN adjustments;
END $$;
CREATE OR REPLACE FUNCTION public.cerrar_conteo(p_conteo uuid)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT vantis_core.close_count(p_conteo) $$;
REVOKE ALL ON FUNCTION vantis_core.close_count(uuid), public.cerrar_conteo(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION vantis_core.close_count(uuid),public.cerrar_conteo(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;