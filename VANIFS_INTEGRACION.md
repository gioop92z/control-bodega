# VANTIS · Inventario y recepción

## Estado

La integración conserva el repositorio y la aplicación de inventario VANTIS. El módulo de recepción reutiliza el lector, importador, conciliación, historial, Excel y diseño de VANIFS. Ambos módulos usan la misma sesión de Supabase y el mismo origen web una vez publicado el cambio. La migración agrega tablas y funciones de recepción a la base elegida para VANTIS. Las operaciones de recepción y las existencias tienen registros separados.

| Recurso | Estado comprobado |
| --- | --- |
| VANTIS | GitHub Pages publica la versión 5.12 del repositorio `gioop92z/control-bodega`. El código usa `dkqovohxkxlcccvagpij` de forma predeterminada. |
| Supabase | El proyecto de administración disponible es el piloto `uphnzyembyrouvqohwys`. La consulta administrativa al proyecto operativo no está disponible en esta sesión. |
| VANIFS original | La versión 5 usa un Worker de Sites, D1, ZXing e IndexedDB. La base conserva manifiestos y operaciones. La versión publicada usa invitaciones propias y acceso de propietario con ChatGPT. |
| Google Drive | La hoja existente de recepción se conserva. El módulo acepta Excel, CSV, TSV y pegado desde Sheets. El selector directo requiere configurar OAuth y Google Picker. |
| Código base | VANTIS `e97c15bbb9114c82efff462d492144dd8551ae1e`. VANIFS `26678cff4adefc01daf0524c547dbd1f2a3832d2`. |

## Operación una vez habilitado

1. Entra a VANTIS y elige **Acceso individual del equipo**. Abre la invitación con el correo verificado que autorizó administración.
2. El supervisor elige **VANIFS · Recepción → Nuevo manifiesto**. Sube el Excel o CSV, pega las filas desde Sheets o abre el selector de Drive cuando esté configurado. Revisa encabezados, SKU, contenedores y cantidades antes de elegir **Crear jornada**.
3. Cada operador entra desde su celular, elige VANIFS y busca **Manifiesto activo de hoy**. Selecciona el nombre y el código de su jornada y toca **Unirme a la recepción**. El enlace o QR de la jornada lleva al mismo manifiesto y exige una cuenta autorizada.
4. Escanea primero la caja y después las piezas. El contenedor activo pertenece a la sesión que lo seleccionó. La cámara marca **Confirmado** cuando el servidor devuelve el registro. **Pendiente de sincronizar** indica que la lectura está en la cola local.
5. El supervisor revisa **En vivo** y **Conciliar**. Pausa para permitir que el equipo sincronice, documenta las diferencias y cierra. Los faltantes son definitivos a partir del cierre. El Excel incluye manifiesto, escaneos, diferencias, incidencias, actividad y productividad.
6. En una jornada cerrada, el supervisor autorizado puede validar un SKU conciliado, departamento y marbete en **Traspasar a inventario**. El movimiento queda vinculado a la jornada y los reintentos recuperan el movimiento original.

Conserva los datos del navegador hasta que la cola quede en cero. Si un teléfono reaparece después del cierre, la cola permanece disponible para revisión. El supervisor puede reabrir con motivo mientras la jornada carezca de traspasos. La detección de dos piezas con la misma etiqueta exige retirar la primera del encuadre. En un lector HID sin sufijo, la pausa entre ráfagas separa los códigos.

## Verificación

Ejecuta desde el repositorio:

```sh
npm ci
npm run build:vanifs
npx --no-install tsc -p vanifs/tsconfig.json
npm test
npm run test:database
npm run test:vanifs:database
npx playwright install chromium --only-shell
node tests/vanifs-browser.e2e.mjs
```

Las pruebas de base usan un entorno desechable. Con `VANIFS_TEST_DATABASE_URL` apuntando a una base local vacía llamada `vanifs_qa`, el conjunto usa conexiones PostgreSQL separadas. Sin esa variable, usa PostgreSQL embebido en PGlite. El ensayo de 10,000 piezas repite SKU y reenvía 2,000 eventos. Compara por caja y operador, exige cero duplicados y verifica que la recepción conserve el saldo inicial de inventario.

Para repetir la prueba de importación con una exportación autorizada, pasa su ruta local mediante `VANIFS_ARCHIVE_TEST_FILE`. El respaldo histórico validado contenía dos jornadas, 26 renglones y 60 eventos. El importador conserva el JSON de origen y permite reejecutar exactamente el mismo respaldo. El archivo de operación debe permanecer fuera del repositorio.

## Publicación y reversión

1. Consigue acceso administrativo al Supabase operativo. Toma y verifica una exportación recuperable de inventario, esquemas, permisos, identidades y evidencia fotográfica. Contrasta las firmas y los permisos reales de `vantis_core.role_for(uuid)` y `public.mover_stock_v2(text,uuid,uuid,text,integer,text,text)` con el contrato del módulo. Valida el flujo de inventario con cuentas de prueba y los asesores de seguridad.
2. Pausa el corte hasta que las jornadas del VANIFS original estén cerradas y los dispositivos hayan sincronizado. Descarga **En vivo → Descargar respaldo** con la cuenta propietaria. Conserva la versión 5 como punto de reversión. Verifica los conteos de tablas y la integridad del JSON antes de usarlo.
3. Aplica la migración aditiva `20261108073356_vanifs_integrado.sql` en el entorno autorizado. El primer administrador se vincula en `vanifs_private.operators` con el UUID de una cuenta confirmada de `auth.users`, `role='admin'` y `owner=true`. El rol de inventario y el número de empleado se conceden por separado según el departamento.
4. Prueba el archivo de VANIFS en un entorno aislado y compara los conteos por jornada, líneas, eventos y totales de cierre. `node scripts/archive-vanifs.mjs /ruta/privada/respaldo.json` genera SQL transaccional para que lo ejecute administración. El original queda archivado para consulta y conserva sus identificadores. Guarda ambos respaldos fuera del código.
5. Configura los retornos de Auth a la ruta `/control-bodega/vanifs/` del origen de VANTIS. Habilita Google en Supabase o el envío de enlaces para las cuentas aprobadas. El proveedor Google estaba deshabilitado al inspeccionar ambos proyectos. El correo predeterminado de Supabase admite solo direcciones del equipo del proyecto. Si se habilita Drive, configura las variables públicas `VANIFS_GOOGLE_CLIENT_ID`, `VANIFS_GOOGLE_PICKER_KEY` y `VANIFS_GOOGLE_PROJECT_NUMBER`. Restringe la clave del selector al origen de VANTIS y a Google Picker.
6. Valida con cuentas reales autorizadas en cuatro teléfonos, iPhone/Safari, Android y el lector portátil de bodega. Comprueba WebSockets, retorno desde correo o Google, estado offline, actualización del tablero, Excel, cierre y un traspaso controlado. Fusiona y verifica el despliegue de GitHub Pages después de pasar esas pruebas. Cambia el acceso antiguo de VANIFS a una redirección solo cuando el corte y los respaldos estén verificados.
7. Para revertir, pausa las nuevas jornadas, exporta sus eventos y confirma las colas. Reimplanta la versión anterior de VANTIS y conserva el histórico de la migración. Si se cambió la URL de VANIFS a una redirección, restaura la versión 5. Revisa la bitácora antes de reintentar cualquier traspaso. Las tablas nuevas son el registro de auditoría de las operaciones ya confirmadas.

## Capacidad y costo

No se contrataron servicios. Supabase Free publica 500 MB de base, 1 GB de archivos, 50,000 usuarios activos mensuales y 200 conexiones Realtime concurrentes. El tráfico, mensajes de Realtime y capacidad de base tienen límites propios. La prueba aislada mide la lógica y persistencia, no los tiempos de la red de bodega.

- [Límites y precios de Supabase](https://supabase.com/pricing)
- [Límites de Supabase Realtime](https://supabase.com/docs/guides/realtime/limits)
- [Límites de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Límites de D1 para el VANIFS original](https://developers.cloudflare.com/d1/platform/pricing/)
- [Configuración de correo de Supabase](https://supabase.com/docs/guides/auth/auth-smtp)
- [Integración de Google Picker](https://developers.google.com/workspace/drive/picker/guides/web-picker)
