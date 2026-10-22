-- Corregir referencias explícitas a la fila de evidencia y normalizar formato de ruta.
DROP POLICY IF EXISTS vantis_evidencia_crear ON public.vantis_evidencias_escaneo;
CREATE POLICY vantis_evidencia_crear ON public.vantis_evidencias_escaneo
FOR INSERT TO authenticated WITH CHECK (
  usuario_id = (SELECT auth.uid()) AND vantis_core.can_use(departamento_id)
  AND EXISTS (
    SELECT 1 FROM public.movimientos m
    WHERE m.id = vantis_evidencias_escaneo.evento_id
      AND m.tipo = 'ENTRADA'
      AND m.departamento_id = vantis_evidencias_escaneo.departamento_id
      AND m.sku = vantis_evidencias_escaneo.sku
      AND m.cantidad = 1
      AND m.user_id = (SELECT auth.uid())
  )
);
DROP POLICY IF EXISTS vantis_evidencia_subir ON storage.objects;
CREATE POLICY vantis_evidencia_subir ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'vantis-evidencias'
  AND split_part(name,'/',2) = (SELECT auth.uid())::text
  AND split_part(name,'/',3) ~ '^[0-9a-f-]{36}[.]jpg$'
  AND name = split_part(name,'/',1) || '/' || split_part(name,'/',2) || '/' || split_part(name,'/',3)
  AND EXISTS (
    SELECT 1 FROM public.departamentos d
    WHERE d.id::text = split_part(name,'/',1) AND vantis_core.can_use(d.id)
  )
);