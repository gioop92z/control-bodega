-- VANTIS | reinicio físico de existencias (15/oct/2026)
-- SOLO administrador de Supabase / SQL Editor.
-- Ejecutar una sola vez cuando nadie esté registrando entradas o salidas.
-- Conserva TODOS los artículos, SKU, UPC, departamentos, marbetes,
-- relaciones de ubicación, usuarios y el historial de movimientos.
-- Hace respaldo privado y lleva a cero stock total y cantidad por marbete.
-- NO elimina el catálogo ni los movimientos históricos.

BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '180s';

CREATE SCHEMA IF NOT EXISTS vantis_respaldo;
REVOKE ALL ON SCHEMA vantis_respaldo FROM PUBLIC, anon, authenticated;

LOCK TABLE public.productos, public.producto_marbetes IN ACCESS EXCLUSIVE MODE;

-- No volver a ejecutar: el respaldo original debe permanecer intacto.
DO $seguro$
BEGIN
  IF to_regclass('vantis_respaldo.productos_20261015') IS NOT NULL
     OR to_regclass('vantis_respaldo.producto_marbetes_20261015') IS NOT NULL THEN
    RAISE EXCEPTION 'El reinicio 2026-10-15 ya tiene respaldo. No repetir: revisa primero el inventario.';
  END IF;
END
$seguro$;

CREATE TABLE vantis_respaldo.productos_20261015 AS
SELECT id, departamento_id, sku, stock AS stock_anterior
FROM public.productos;

CREATE TABLE vantis_respaldo.producto_marbetes_20261015 AS
SELECT sku, marbete_codigo, cantidad AS cantidad_anterior
FROM public.producto_marbetes;

-- Copias no expuestas al API de clientes.
ALTER TABLE vantis_respaldo.productos_20261015 ENABLE ROW LEVEL SECURITY;
ALTER TABLE vantis_respaldo.producto_marbetes_20261015 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA vantis_respaldo FROM PUBLIC, anon, authenticated;

-- NO tocar metadata/catalogo. NO borrar asignaciones de ubicación.
UPDATE public.productos SET stock = 0 WHERE stock IS DISTINCT FROM 0;
UPDATE public.producto_marbetes SET cantidad = 0 WHERE cantidad IS DISTINCT FROM 0;

-- Cualquier incongruencia aborta la transacción COMPLETA.
DO $verificacion$
BEGIN
  IF EXISTS (SELECT 1 FROM public.productos WHERE stock IS DISTINCT FROM 0) THEN
    RAISE EXCEPTION 'Quedaron productos con existencias: se cancela toda la operación.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.producto_marbetes WHERE cantidad IS DISTINCT FROM 0) THEN
    RAISE EXCEPTION 'Quedaron marbetes con existencias: se cancela toda la operación.';
  END IF;
END
$verificacion$;

COMMIT;

-- Comprobación final: ambos conteos deberán ser 0.
SELECT
  (SELECT count(*) FROM public.productos) AS articulos_preservados,
  (SELECT count(*) FROM public.productos WHERE stock IS DISTINCT FROM 0) AS productos_con_stock_distinto_cero,
  (SELECT count(*) FROM public.producto_marbetes WHERE cantidad IS DISTINCT FROM 0) AS marbetes_con_stock_distinto_cero,
  (SELECT count(*) FROM vantis_respaldo.productos_20261015) AS articulos_respaldados,
  (SELECT count(*) FROM vantis_respaldo.producto_marbetes_20261015) AS asignaciones_respaldadas;
