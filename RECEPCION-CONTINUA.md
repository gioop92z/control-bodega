# VANTIS 3.10.0 — Recepción continua

La recepción continua está integrada en **Recibir mercancía**. Su activación depende de tres RPC nuevas del servidor. Si no existen, la aplicación abre automáticamente la recepción por lote de 3.9.5 y muestra que la activación sigue pendiente. **Publicar el frontend no instala la migración de Supabase.**

## Operación

1. Identificarse con el gafete y elegir departamento como en la aplicación actual.
2. Escanear `402-001`, `ZAP-402-001` o su QR. Un marbete nuevo válido se registra en el servidor; uno existente conserva su código y departamento. Se admiten las secciones 402, 405 y 459, con 3 o 4 dígitos de ubicación.
3. Escanear SKU/UPC. Cada lectura representa una unidad, tiene su UUID y se envía automáticamente. Cinco lecturas idénticas son cinco piezas.
4. Una ubicación diferente abre la única confirmación de cambio. Cancelar mantiene la anterior. Las lecturas anteriores conservan su ubicación.
5. **Deshacer último registro** genera una salida compensatoria ligada a la entrada. Nunca borra el historial. No permite compensar dos veces una entrada ni descontar una pieza que ya no existe en ese marbete.
6. **Finalizar recepción** muestra el resumen y permite CSV o JSON. No ejecuta nuevas entradas. Las operaciones pendientes continúan sincronizando.

El indicador de lector significa que la captura está preparada. Un lector HID funciona como teclado; el navegador no puede comprobar de forma fiable que ese dispositivo físico esté conectado. La cámara se indica activa cuando el lector la abrió. Para otra pieza con el mismo código en cámara, retirar el código del encuadre y presentar la siguiente pieza; mantenerlo inmóvil no produce unidades adicionales.

## Persistencia y stock

- Diario local por lectura antes de cualquier petición. Recuperación tras recarga, cierre o pérdida de respuesta. Una sola pestaña por usuario/departamento/operador mediante Web Locks.
- Cola de captura independiente de la red, hasta cuatro operaciones simultáneas. La consulta de catálogo usa las funciones actuales, con búsquedas por SKU y variantes de UPC, sin descargar o truncar el catálogo completo.
- El contador de confirmados cambia únicamente con un recibo consistente del servidor. Pendiente, enviando, incierto y fallido tienen textos diferentes. No hay sonido de éxito por capturar un borrador.
- Misma carga y UUID en cada reintento. El servidor devuelve el recibo original si el evento ya se guardó; rechaza reutilizar su UUID para otra operación.
- Cada transacción bloquea el producto y la asignación. Invoca `mover_stock_v2`, verifica que el stock cambió exactamente una unidad y que existe el movimiento, actualiza la cantidad por ubicación y añade el recibo privado. Cualquier error revierte toda la transacción.
- La tabla privada tiene RLS y carece de permisos de lectura/escritura directa para los roles de la aplicación. Las funciones privilegiadas están en un esquema privado y verifican `auth.uid()` contra las dos cuentas Auth actuales. Las RPC públicas son envoltorios invoker. No se usan claims editables de `user_metadata`.
- La auditoría guarda la cuenta Auth y el gafete declarado. El sistema existente utiliza cuentas compartidas 99/10: el gafete no constituye una autenticación individual independiente.
- El diario usa almacenamiento de este navegador. Si se agota su cuota, se detiene la captura con un aviso, antes de enviar nuevas lecturas. No borrar los datos del navegador mientras haya pendientes. Descargar el reporte y el respaldo al finalizar.

## Activación de Supabase: pendiente de acceso autorizado

Proyecto de la aplicación: `dkqovohxkxlcccvagpij`.

En la sesión de desarrollo el conector devolvió una lista vacía de proyectos y denegó consultar este proyecto. No se ha aplicado la migración ni se ha verificado el esquema real del servidor. La revisión automática también rechazó usar una contraseña encontrada en el repositorio. No se han realizado recepciones, ajustes ni pruebas destructivas contra inventario real.

Archivo de migración generado con Supabase CLI:

`supabase/migrations/20261020000020_continuous_receiving.sql`

Antes de aplicarlo con una conexión administrativa autorizada:

1. Inspeccionar las definiciones reales de `mover_stock_v2`, `productos`, `movimientos`, `marbetes` y `producto_marbetes`. La firma usada por el frontend es `p_token, p_id, p_producto, p_tipo, p_cantidad, p_marbete, p_nota`; la migración conserva esa infraestructura. Las pruebas locales utilizan un contrato reconstruido de los consumidores del repositorio, no una copia del esquema productivo.
2. Confirmar los permisos actuales y respaldar el esquema con el procedimiento del proyecto. La migración es aditiva, no reinicia stock ni modifica la definición de funciones existentes.
3. Ejecutar la migración como propietario, revisar los asesores de seguridad de Supabase y comprobar las RPC `vantis_recepcion_estado_v1`, `vantis_activar_marbete_v1` y `vantis_recibir_pieza_v1` con una sesión Auth autorizada.
4. Verificar contra datos de prueba aislados la compatibilidad real del RPC antiguo y los permisos. No habilitar una recepción real basándose sólo en que el endpoint existe.
5. Abrir de nuevo **Recibir mercancía**. La aplicación habilita el nuevo flujo si el servidor responde `{version:1, atomic:true, idempotent:true}`. Un fallo de consistencia impide confirmar la pieza y revierte la transacción.

## Verificación reproducible

```sh
npm ci --ignore-scripts
npm test
npm run test:database
npx playwright install chromium
npm run test:browser
node tests/supports.e2e.mjs
```

`test:database` ejecuta la migración real en PGlite. La CI `receiving.yml` usa además PostgreSQL 17 desechable con 12 conexiones para validar bloqueos y concurrencia reales. Su cadena de conexión pertenece únicamente al servicio de pruebas; no contiene credenciales productivas.

La prueba antigua `e2e-fake-login.yml`, que entra a la aplicación real con credenciales incluidas en el repositorio, queda disponible sólo por ejecución manual. Esta publicación usa pruebas de navegador aisladas, sin iniciar esa sesión real de forma indirecta desde el despliegue.

Cobertura: 100, 500 y 1,000 lecturas; múltiples empleados; reintentos simultáneos del mismo UUID; ubicación nueva, heredada, ajena o inactiva; códigos de producto; pérdida de respuesta; recarga; diario lleno; deshacer; contrato de servidor incompatible; operación por teclado, Enter, Tab y sin terminador; cámara continua y QR; cambio/cancelación de marbete; resumen, CSV y retorno a la recepción anterior sin migración. Los decodificadores tienen pruebas independientes. Falta comprobar físicamente el modelo concreto de escáner y la cámara del teléfono del operador.

## Recuperación de versión

La rama `backup/v3.9.5-antes-recepcion-continua-20261019` conserva el commit `44258487c5f2123c80efdfe627d0ef02b248f01b`. Un revert del cambio de frontend restaura el flujo anterior. Conservar el diario y los recibos privados: volver al frontend anterior no revierte mercancía ya recibida.
