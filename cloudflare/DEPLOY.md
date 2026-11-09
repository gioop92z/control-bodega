# VANTIS Equipo — puesta en marcha (sin Supabase)

## URLs y preservación de datos
- Edición local existente: https://gioop92z.github.io/control-bodega/local.html
- Edición compartida: https://gioop92z.github.io/control-bodega/team.html
- La edición local mantiene su IndexedDB y no se sobrescribe; **no borres Safari**.
- Hasta configurar Cloudflare, `team.html` bloquea el acceso y no permite escanear contra una base inexistente.

## Preparación del único backend central
Se usan Cloudflare Workers y una base Cloudflare D1 en la cuenta del propietario.
La automatización **reutiliza la base existente**, crea tablas con `IF NOT EXISTS` y nunca borra inventario.

En el repositorio GitHub, abrir **Settings → Secrets and variables → Actions** y crear
los siguientes secretos (no subirlos a código ni pegarlos en conversaciones):

1. `CLOUDFLARE_API_TOKEN`: token restringido a la cuenta, con Workers Scripts:Edit,
   D1:Edit y lectura del subdominio Workers.
2. `CLOUDFLARE_ACCOUNT_ID`: ID de cuenta Cloudflare (32 caracteres).
3. `VANTIS_AUTH_SECRET`: secreto aleatorio criptográfico de al menos 32 caracteres;
   por ejemplo, generado fuera del repositorio con `openssl rand -hex 32`.
4. `VANTIS_SETUP_KEY`: clave de instalación aleatoria distinta, de al menos 24
   caracteres; guardarla en un gestor de contraseñas para la primera cuenta.

Con esos cuatro valores cargados, ejecutar **Actions → Deploy VANTIS Equipo to Cloudflare → Run workflow**.
El workflow:
1. Resuelve o crea la base D1 `vantis-inventario-giovanni`.
2. Aplica `cloudflare/schema.sql` sin eliminar registros.
3. Publica el Worker `vantis-inventario-giovanni`.
4. Inyecta los secretos únicamente en Cloudflare.
5. Comprueba `/api/health` sobre HTTPS desde el origen GitHub Pages.
6. Actualiza `team-config.mjs` con la URL pública y desencadena la publicación en GitHub Pages.

La URL del Worker no es un secreto. Las claves sí lo son.

## Primer acceso
Abrir `/team.html` tras la publicación, desplegar “Primera configuración del administrador”
y proporcionar `VANTIS_SETUP_KEY`, el número de empleado, nombre y PIN.
La instalación solo crea la cuenta si todavía no existe ninguna. Crear después
cuentas separadas con roles **Consulta**, **Escaneo** o **Administrador**.

### Importar lecturas previas del iPhone
Entrar como administrador desde **el mismo iPhone y navegador** donde se escaneó en
`local.html`. Usar **Importar desde este dispositivo**, o seleccionar un respaldo JSON local.
La importación:
- Solo lee los movimientos confirmados y copia sus folios UUID originales.
- Reordena las reversas detrás de las lecturas originales.
- Importa por lotes de cinco con progreso visible.
- Puede reintentarse: el servidor omite los folios ya importados sin incrementar cantidades.
- Nunca elimina ni altera el inventario local del dispositivo.

## Verificaciones antes de uso real
- Las pruebas automáticas verifican 10,000 movimientos SQLite, roles, reintentos y reversas.
- **La prueba automatizada no reemplaza la prueba real** de cámara/lector, Wi-Fi y 2+ dispositivos.
- Verificar al menos una lectura en cada dispositivo y su consulta inmediata desde el perfil del jefe.
- Revisar que cantidad por marbete y total coincidan; exportar respaldo local antes de migrar.
- Revisar límites gratuitos de Cloudflare y permisos corporativos antes de usar datos reales.

No compartir un enlace de la edición local como inventario central. No afirmar que
la versión compartida está operativa hasta que el workflow de Cloudflare y la prueba
multidispositivo se hayan completado.
