-- Evidencia fotográfica automática de entradas realizadas con cámara.
-- Un evento confirmado = una foto; no altera stock ni movimientos existentes.
CREATE TABLE IF NOT EXISTS public.vantis_evidencias_escaneo (
  evento_id uuid PRIMARY KEY REFERENCES public.movimientos(id) ON DELETE RESTRICT,
  departamento_id uuid NOT NULL REFERENCES public.departamentos(id),
  sku text NOT NULL,
  codigo_leido text NOT NULL,
  objeto_path text NOT NULL UNIQUE,
  usuario_id uuid NOT NULL REFERENCES auth.users(id),
  capturada_en timestamptz NOT NULL,
  creada_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidencia_sku_valido CHECK (length(trim(sku)) BETWEEN 1 AND 120),
  CONSTRAINT evidencia_codigo_valido CHECK (length(trim(codigo_leido)) BETWEEN 1 AND 120),
  CONSTRAINT evidencia_ruta_valida CHECK (
    objeto_path = departamento_id::text || '/' || usuario_id::text || '/' || evento_id::text || '.jpg'
  )
);
CREATE INDEX IF NOT EXISTS vantis_evidencias_por_producto ON public.vantis_evidencias_escaneo
  (departamento_id, sku, capturada_en DESC);
ALTER TABLE public.vantis_evidencias_escaneo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vantis_evidencias_escaneo FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.vantis_evidencias_escaneo TO authenticated;
DROP POLICY IF EXISTS vantis_evidencia_leer ON public.vantis_evidencias_escaneo;
CREATE POLICY vantis_evidencia_leer ON public.vantis_evidencias_escaneo FOR SELECT
  TO authenticated USING (vantis_core.can_use(departamento_id));
DROP POLICY IF EXISTS vantis_evidencia_crear ON public.vantis_evidencias_escaneo;
CREATE POLICY vantis_evidencia_crear ON public.vantis_evidencias_escaneo FOR INSERT
  TO authenticated WITH CHECK (
    usuario_id = (SELECT auth.uid()) AND vantis_core.can_use(departamento_id)
    AND EXISTS (
      SELECT 1 FROM public.movimientos m
      WHERE m.id = evento_id AND m.tipo = 'ENTRADA'
        AND m.departamento_id = departamento_id AND m.sku = sku
        AND m.cantidad = 1 AND m.user_id = (SELECT auth.uid())
    )
  );
-- No bucket público: las imágenes solo pueden consultarse con sesión autorizada.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('vantis-evidencias','vantis-evidencias',false,204800,ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET
  public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS vantis_evidencia_subir ON storage.objects;
CREATE POLICY vantis_evidencia_subir ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'vantis-evidencias'
    AND split_part(name,'/',2) = (SELECT auth.uid())::text
    AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.jpg$'
    AND EXISTS (
      SELECT 1 FROM public.departamentos d
      WHERE d.id::text = split_part(name,'/',1)
        AND vantis_core.can_use(d.id)
    )
  );
DROP POLICY IF EXISTS vantis_evidencia_ver ON storage.objects;
CREATE POLICY vantis_evidencia_ver ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'vantis-evidencias'
    AND EXISTS (
      SELECT 1 FROM public.vantis_evidencias_escaneo e
      WHERE e.objeto_path = name AND vantis_core.can_use(e.departamento_id)
    )
  );