-- Afinación de índices y políticas: el cliente no recibe nuevos privilegios.
BEGIN;
CREATE INDEX IF NOT EXISTS vantis_incidencias_user ON public.vantis_incidencias_v4(usuario_id);
CREATE INDEX IF NOT EXISTS vantis_traslados_user ON public.vantis_traslados_v4(usuario_id);
DROP POLICY IF EXISTS vo_sel ON public.vantis_operadores_v4;
CREATE POLICY vo_sel ON public.vantis_operadores_v4 FOR SELECT TO authenticated
USING(usuario_id=(select auth.uid()));
DROP POLICY IF EXISTS incident_insert ON public.vantis_incidencias_v4;
CREATE POLICY incident_insert ON public.vantis_incidencias_v4 FOR INSERT TO authenticated
WITH CHECK(usuario_id=(select auth.uid()) AND vantis_core.can_use(departamento_id));
COMMIT;