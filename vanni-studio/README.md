# VANNI STUDIO — Personal Creator Management System

Aplicación web privada (PWA instalable en iPhone) para gestionar tu crecimiento como creador fitness: Instagram con datos **reales** de la API oficial de Meta, series y episodios, producción, gimnasios, laboratorio creativo, agenda, evolución física, *The VANNI Journey*, marca y colaboraciones, y personalización sin tocar código.

> **BUILD YOURSELF. BUILD YOUR LEGACY.**

- App publicada: `https://gioop92z.github.io/control-bodega/studio/` (se publica al fusionar esta rama en `main`).
- Backend: proyecto Supabase dedicado **vanni-studio** (`xfmwpndnefzpobvsbdyu`, plan gratuito), separado de VANTIS.

## Arquitectura

| Capa | Tecnología | Notas |
|---|---|---|
| Interfaz | React 19 + TypeScript + Vite | HashRouter (funciona en GitHub Pages), rutas con carga diferida, gráficas SVG propias, Kanban táctil (@dnd-kit), mapa Leaflet con teselas oscuras de CARTO/OpenStreetMap |
| Datos | Supabase Postgres | 38 tablas, todas con RLS (`user_id = auth.uid()`); esquema `private` sin acceso desde el navegador |
| Sincronización entre dispositivos | Supabase Realtime + bandeja de salida local | Guardado automático, cola persistente sin conexión, reintentos con espera creciente |
| Autenticación | Supabase Auth | Registro público **cerrado** por disparador en la base; la cuenta única se activa con un código de propietario; recuperación con código propio (sin correo) |
| Archivos | Supabase Storage privado | Fotos comprimidas en el dispositivo; enlaces firmados de 1 hora |
| Servidor | Edge Functions (Deno) | `owner` (alta/recuperación), `instagram` (OAuth, sincronización, estado), `backup` (exportar/importar/copias) |
| Tareas programadas | `pg_cron` + `pg_net` | Instagram cada 60 min (minuto 17), copia semanal (lunes), limpieza diaria |
| Secretos | Supabase Vault + AES-256-GCM | Token de Instagram y App Secret de Meta cifrados; la clave vive en Vault |

Todo lo anterior es gratuito en los planes usados (Supabase Free, GitHub Pages). No se contrató ningún servicio de pago.

## Integración con Instagram (oficial)

- **Instagram API with Instagram Login** (`graph.instagram.com`, versión `v25.0`), permisos `instagram_business_basic` e `instagram_business_manage_insights`. Sin contraseñas, sin scraping.
- OAuth con `state` de un solo uso (hash en servidor, 15 min), intercambio de código → token corto → token largo (60 días), renovación automática semanal.
- Cada hora: perfil y seguidores (una instantánea diaria sin duplicados; conserva el valor de apertura del día), métricas diarias de la cuenta de hoy y los 2 días previos (Meta ajusta hasta 48 h), publicaciones, reels y stories con sus métricas (prioridad a lo reciente; stories antes de que expiren a las 24 h).
- Una vez al día: desgloses (seguidos/bajas, alcance por tipo de seguidor, vistas por formato), demografía (países, ciudades, edad, género) y actividad de seguidores por hora.
- Primera conexión: 30 días de métricas de cuenta y hasta 500 publicaciones.
- **Resiliencia**: si Meta rechaza una métrica, se prueba una por una, se marca como «No disponible» y no se vuelve a pedir durante 7 días. Errores de token → «Reconexión necesaria»; límite de la API → pausa de 2 h; bloqueo para no sincronizar dos veces a la vez.
- **Etiquetas de origen** en toda la app: `Instagram` (real), `Manual`, `Calculado`, `No disponible`.

### Límites que impone Meta (no son fallas de la app)
- La demografía, `follows_and_unfollows` y la actividad por hora requieren **100+ seguidores**.
- Meta no entrega el historial de seguidores anterior a la conexión: VANNI STUDIO lo construye desde el primer día que conectas. Puedes completar meses previos con registros **manuales** (siempre etiquetados).
- Las métricas de stories solo existen 24 h; las de publicaciones pueden tardar hasta 48 h.

## Primeros pasos

1. Abre la app y activa tu cuenta con el **código de propietario** (se entrega por chat, nunca está en el repositorio). Guarda el **código de recuperación** que se muestra.
2. Ve a **Instagram → Abrir asistente de configuración** (`#/configurar-meta`) y sigue los 7 pasos: cuenta profesional, app en Meta Developers, URI de redireccionamiento:
   `https://xfmwpndnefzpobvsbdyu.supabase.co/functions/v1/instagram/callback`, cuenta como evaluadora, App ID y App Secret de **Instagram**.
3. Pulsa **Conectar mi Instagram**. La primera sincronización tarda 1–2 minutos.
4. En iPhone: Safari → Compartir → **Agregar a pantalla de inicio**.

## Desarrollo

```bash
cd vanni-studio
npm ci
npm run dev          # http://localhost:5173 (usa el backend real; los datos son los tuyos)
npm run typecheck
npm test             # Vitest: lógica de análisis, recurrencias, Journey, cifrado, OAuth, sincronización (API simulada) y migraciones SQL con RLS (PGlite)
npm run build
```

Prueba de extremo a extremo contra el backend real (crea una cuenta de prueba; requiere un código de propietario de prueba y la app servida en `BASE_URL`):

```bash
npm run build && npx vite preview --port 4173 &
VANNI_E2E_CODE=XXXX-XXXX-XXXX-XXXX PW_CHROMIUM=/ruta/a/chromium npm run test:e2e
```

Funciones del servidor: `supabase/functions/*` (código compartido en `_shared/`, comprobable con `deno check`). Migraciones: `supabase/migrations/*`.

## Verificación realizada (25 nov 2026)

- **54 pruebas unitarias** (Vitest) en verde, incluidas 12 sobre las migraciones reales con RLS y 8 del motor de sincronización contra una Graph API simulada **solo para pruebas**.
- **21 pasos de extremo a extremo** contra el backend real, en un viewport de iPhone 14 (Chromium) y una segunda sesión de escritorio: activación con código, rechazo de código inválido, series sembradas, temporada y episodio persistentes, Kanban, agenda, captura rápida, gimnasio con puntuación y ranking, idea convertida en episodio, peso + entrenamiento + récord, cierre de mes con informe congelado y complemento, pipeline de marca, campo personalizado y colección, Instagram sin datos ficticios, asistente de Meta (credenciales cifradas y URL OAuth oficial con `redirect_uri`, permisos y `state`), media kit sin cifras inventadas, exportación JSON completa, copia de seguridad, cierre de sesión, recuperación con código y acceso desde otro dispositivo.
- Registro público bloqueado (verificado con una petición directa a `/auth/v1/signup`).
- `pg_cron` invocó la sincronización horaria (respuesta 202 de la función).

## Criterios de aceptación

| # | Criterio | Estado |
|---|---|---|
| 1 | Conectar realmente mi cuenta de Instagram | Implementado y verificado hasta la URL OAuth oficial. **Falta tu paso**: crear la app en Meta y autorizar (asistente). |
| 2 | Obtener estadísticas verificables | Implementado; probado con API simulada. Se verifica con datos reales al conectar. |
| 3 | Actualizar métricas automáticamente | Verificado (cron cada 60 min). |
| 4 | Consultar registros históricos | Diario, mensual y anual; exportable a CSV. |
| 5 | Vincular publicaciones con episodios | Implementado (por publicación, serie o episodio); requiere publicaciones importadas. |
| 6 | Crear series y temporadas | Verificado. |
| 7 | Organizar grabaciones | Verificado (episodios, Kanban, agenda). |
| 8 | Registrar y calificar gimnasios | Verificado (7 criterios 1–10, ponderación, mapa). |
| 9 | Documentar mi evolución física | Verificado. |
| 10 | Crear objetivos personalizados | Verificado (manuales y automáticos). |
| 11 | Cerrar y consultar meses anteriores | Verificado (informe congelado, protegido en la base, complementos). |
| 12 | Acceder desde distintos dispositivos | Verificado. |
| 13 | Media kit con datos reales | Implementado; muestra «—» hasta conectar Instagram. Exporta PDF. |
| 14 | Exportar toda mi información | Verificado (JSON completo, ZIP de archivos, CSV por tabla, copias semanales). |
| 15 | Crear nuevas categorías y actividades | Verificado (categorías, campos, colecciones, plantillas). |

## Plan gratuito de Supabase
500 MB de base de datos, 1 GB de archivos (máx. 50 MB por archivo; los videos largos conviene subirlos comprimidos o como enlace). Supabase puede pausar proyectos gratuitos sin actividad; la sincronización horaria mantiene actividad, y si se pausara se reactiva desde el panel sin pérdida de datos.
