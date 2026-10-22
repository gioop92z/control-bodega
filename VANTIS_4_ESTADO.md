# VANTIS 4.0.1 — Implementación incremental

Fecha: 22 de octubre de 2026. Repositorio: gioop92z/control-bodega.

## Alcance EXCLUIDO expresamente
- No implementar reposición inteligente de bodega a piso.
- No implementar integraciones con ventas, pedidos o catálogos externos.
- No implementar asistente de IA VANTIS.

## Funciones integradas al código del frontend
- **Centro operativo:** acceso desde Inicio, métricas confirmadas desde consultas al servidor, conteos recientes y alertas de artículos agotados/SKU provisionales; no se escriben inventarios desde ese panel.
- **Localizador:** búsqueda exacta por SKU/UPC, marbetes del departamento, cantidades conocidas por ubicación, avisos explícitos si existe cantidad sin determinar o diferencia; no ajusta stock solo.
- **Preparación de apoyos:** captura manual o lector conectado como teclado, acumulación de lecturas, borradores conservados por departamento/actor en este navegador, enlace con la fila existente de Salidas para revisión y confirmación posterior; NO hay reserva de stock interdispositivo.
- **Inventario grande:** paginación incremental de 100 productos por página en vez de mostrar solo los primeros 100.
- **Traslados:** formulario de captura y llamada protegida al RPC transaccional `vantis_trasladar_v4` con identificador de idempotencia; el cliente no simula el guardado si el RPC no existe.
- **Incidencias:** formulario y consulta del historial, reintentos con folio UUID; no modifica existencias. No confirma registro si Supabase no responde.
- **Conteos:** consulta de estados de conteos existentes (módulo previo de conteo físico permanece intacto).

## Infraestructura lista, pero NO activada
`supabase/migrations/20261022000000_vantis_operaciones_v4.sql` contiene tablas y políticas RLS para operadores, incidencias, historial de traslados y RPC atómico de traslados. **No se ha aplicado al servidor**; el conector Supabase no devuelve proyectos y rechaza acceso al proyecto cuyo identificador figura en la app.

Antes de desplegar:
1. Conectar el proyecto Supabase correcto y verificar la identidad/propiedad.
2. Hacer respaldo de esquema y existencias. Revisar esquema exacto, FK, tipos, políticas RLS, índices y roles actuales.
3. Ejecutar la migración primero en entorno de pruebas con casos de permisos, concurrencia, saldo insuficiente, ubicación desconocida, repetición de solicitud y respuesta de red perdida.
4. Confirmar expresamente que nunca cambia `productos.stock` en un traslado y que sí actualiza las dos cantidades localizadas y el historial en una transacción.
5. Ejecutar avisos de seguridad de Supabase y revisar funciones privilegiadas. Rotar credenciales públicas compartidas y sustituir accesos 10/99 por identidad individual, respetando los flujos existentes.
6. Hacer pruebas reales en iPhone, escáner HID, cámara, navegador de escritorio y al menos dos sesiones simultáneas. Validar GitHub Pages y el despliegue.

## Funciones PENDIENTES, no declarar completadas
- Migración de accesos verdaderamente individuales con servidor y permisos por área.
- Traslados e incidencias operativos en producción (dependen de migración).
- Reservas de existencias multiusuario y preparación de varios pedidos con asignación automática.
- Recepción contrastada contra manifiesto/documento esperado.
- Conteos cíclicos programados y reglas de seguimiento de diferencias.
- Reportes empresariales por turno y supervisión consolidada multiusuario.
- Impresión industrial de etiquetas/marbetes desde la app.
- Pruebas de carga certificables de más de 100.000 lecturas y un flujo offline en varios dispositivos.
- Mapa digital/RFID (solo si la operación lo justifica).

## Evidencia de validación
- Comprobación sintáctica de `app.js`, `operations-v4.mjs` y archivos existentes cargados desde GitHub.
- Cinco comprobaciones puras de consolidación de preparaciones y conciliación de cantidades pasaron.
- Pruebas automatizadas añadidas en `tests/ops-v4.test.mjs` y flujo de GitHub Actions en `.github/workflows/vantis-ops.yml`; su ejecución real no se pudo comprobar desde esta sesión.
- No se pudo validar el servidor Supabase, el navegador iOS ni un despliegue GitHub Pages vivo.

Esta entrega es una **mejora parcial** y no una certificación de funcionamiento de toda la plataforma.
