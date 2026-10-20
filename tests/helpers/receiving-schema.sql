-- Disposable test database only. Contract inferred from the existing VANTIS
-- callers; this fixture is NOT an introspection of the production database.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
INSERT INTO auth.users VALUES
 ('10000000-0000-0000-0000-000000000001','10@bodega.local'),
 ('10000000-0000-0000-0000-000000000002','99@bodega.local'),
 ('10000000-0000-0000-0000-000000000003','someone@example.test');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
CREATE TABLE public.departamentos(id uuid PRIMARY KEY,nombre text,activo boolean DEFAULT true);
CREATE TABLE public.productos(id uuid PRIMARY KEY,departamento_id uuid NOT NULL REFERENCES public.departamentos(id),sku text UNIQUE NOT NULL,upc text,descripcion text,stock bigint NOT NULL DEFAULT 0,activo boolean DEFAULT true);
CREATE TABLE public.marbetes(codigo text PRIMARY KEY,departamento_id uuid REFERENCES public.departamentos(id),zona text,descripcion text,activo boolean DEFAULT true,updated_at timestamptz DEFAULT now());
CREATE TABLE public.producto_marbetes(sku text REFERENCES public.productos(sku),marbete_codigo text REFERENCES public.marbetes(codigo),cantidad bigint,updated_at timestamptz,PRIMARY KEY(sku,marbete_codigo));
CREATE TABLE public.movimientos(id uuid PRIMARY KEY,tipo text,sku text,cantidad integer,departamento_id uuid,marbete_codigo text,stock_anterior bigint,stock_resultante bigint,nota text,user_id uuid,created_at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.mover_stock_v2(p_token text,p_id uuid,p_producto uuid,p_tipo text,p_cantidad integer,p_marbete text,p_nota text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.productos%ROWTYPE; delta integer;
BEGIN
 SELECT * INTO STRICT p FROM public.productos WHERE id=p_producto FOR UPDATE;
 delta:=CASE WHEN p_tipo='ENTRADA' THEN p_cantidad ELSE -p_cantidad END;
 UPDATE public.productos SET stock=stock+delta WHERE id=p_producto;
 UPDATE public.producto_marbetes SET cantidad=coalesce(cantidad,0)+delta WHERE sku=p.sku AND marbete_codigo=p_marbete;
 INSERT INTO public.movimientos(id,tipo,sku,cantidad,departamento_id,marbete_codigo,stock_anterior,stock_resultante,nota,user_id)
  VALUES(p_id,p_tipo,p.sku,p_cantidad,p.departamento_id,p_marbete,p.stock,p.stock+delta,p_nota,auth.uid());
 RETURN jsonb_build_object('stock_resultante',p.stock+delta);
END;
$$;
REVOKE ALL ON FUNCTION public.mover_stock_v2(text,uuid,uuid,text,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mover_stock_v2(text,uuid,uuid,text,integer,text,text) TO authenticated;
INSERT INTO public.departamentos VALUES('20000000-0000-0000-0000-000000000001','Zapatería',true),('20000000-0000-0000-0000-000000000002','Otro departamento',true);
INSERT INTO public.productos VALUES('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','PRESERVAR','1234567890000','Inventario previo',37,true);
INSERT INTO public.marbetes(codigo,departamento_id,zona) VALUES('ZAP-402-001','20000000-0000-0000-0000-000000000001','BODEGA');
INSERT INTO public.producto_marbetes VALUES('PRESERVAR','ZAP-402-001',11,now());
