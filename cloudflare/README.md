# VANTIS Equipo — activación del inventario central

Esta edición está preparada en el repositorio existente y NO utiliza Supabase.
La interfaz está en `team.html`; la versión anterior `local.html` y su IndexedDB NO se borran, cambian ni migran automáticamente.

## Necesario antes de publicar al equipo

1. Cuenta Cloudflare con permisos para crear Workers y D1, sin servicios de pago.
2. El origen HTTPS real de GitHub Pages. La variable `ALLOWED_ORIGIN` debe incluir el origen (protocolo + host), NO la ruta `/control-bodega/team.html`.
3. Crear una base D1 real; instalar el esquema **antes de abrir el lector**; crear secretos únicos y el primer usuario administrador.
4. Probar en dos celulares diferentes: uno escanea, el otro encuentra el artículo en el mismo marbete. No utilizar el proyecto con inventario real hasta confirmar esto.

### Pasos de Cloudflare (equipo de TI / propietario)

Desde la raíz del repositorio:

```bash
npx wrangler login
npx wrangler d1 create vantis-equipo
cp cloudflare/wrangler.example.toml cloudflare/wrangler.toml
# Copiar el database_id REAL de la respuesta anterior a cloudflare/wrangler.toml.
# Verificar ALLOWED_ORIGIN con el sitio real donde se publicará team.html.
npx wrangler d1 execute vantis-equipo --remote --config cloudflare/wrangler.toml --file cloudflare/schema.sql
npx wrangler secret put AUTH_SECRET --config cloudflare/wrangler.toml
npx wrangler secret put VANTIS_SETUP_KEY --config cloudflare/wrangler.toml
npx wrangler deploy --config cloudflare/wrangler.toml
```

* Cada secreto debe ser aleatorio, privado y tener al menos 32 caracteres para `AUTH_SECRET` y 24 para `VANTIS_SETUP_KEY`. Usa valores **distintos**, no los guardes en GitHub ni los compartas con el personal.
* `cloudflare/wrangler.toml` se crea a partir del ejemplo y debe conservarse fuera de commits que incluyan datos de cuenta. Nunca incluyas un secreto en ese archivo.
* Cloudflare devolverá una URL HTTPS del Worker: confirma `/api/health`.
* Solo después, edita `team-config.mjs` y escribe esa URL HTTPS en `TEAM_API_URL` (sin barra final). La URL del Worker es pública; los secretos no.
* Publica los cambios en `main` **solo después de ejecutar las pruebas**. GitHub Actions publica GitHub Pages desde `main`.
* Abre `team.html`, expande “Primera configuración del administrador” e introduce la clave de instalación, nombre, número de empleado y PIN. Ese endpoint deja de permitir nuevos administradores iniciales en cuanto hay una cuenta.
* Desde Administrar acceso, crea una cuenta de **Consulta** para el jefe y de **Escaneo** para cada compañera, con PIN independiente. No basta con introducir un número de empleado.

### Verificaciones mínimas con datos de prueba

- Empleado A activa `ZAP-402-001` y escanea un SKU numérico de prueba. La lectura debe pasar a **Guardado**.
- Empleado B, en otro celular y con otra cuenta, busca el SKU y observa marbete y cantidad correctos.
- Al reescanear la misma pieza físicamente se suma **otra pieza** (movimiento distinto). Si se reintenta el **mismo folio** por fallo de red, no se duplica el inventario.
- Cambiar a un marbete distinto; escanear otra pieza; comprobar que la cantidad quedó en la ubicación nueva.
- Probar sin Wi-Fi, reabrir la pestaña con el mismo gafete y reconectar; las lecturas pendientes deben reconciliarse antes de contarse.
- Probar un usuario de Consulta: búsqueda permitida, escaneo y administración denegados.
- Exportar un respaldo JSON de `local.html` antes de cualquier migración. El modo de equipo no importa automáticamente las piezas antiguas de Safari.
- Verificar el límite real de escrituras/lecturas de Cloudflare en el panel. El plan gratuito puede bloquear operaciones al superar la cuota.

### Seguridad

El Worker exige token personal firmado, comprueba el usuario activo en cada petición, aplica roles y restringe el CORS al origen definido. Los PIN no se guardan en claro, hay límite de intentos de inicio de sesión y ninguna llave privada se carga en el frontend de GitHub Pages. El endpoint de instalación exige una clave secreta y funciona solo antes de crear al primer usuario.

**Pendiente:** este repositorio no proporciona autorización para crear/deplegar recursos de la cuenta Cloudflare desde ChatGPT. Tampoco proporciona pruebas físicas con la cámara/lector del almacén. No afirmar que el inventario central ya está publicado sin completar estos pasos.
