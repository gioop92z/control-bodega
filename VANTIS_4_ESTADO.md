# VANTIS — estado real de migración (22 de octubre de 2026)

## Destinos
- Repositorio público: gioop92z/control-bodega (rama main).
- Supabase NUEVO: `uphnzyembyrouvqohwys` (Vantis).
- Supabase ANTERIOR usado aún por la app: `dkqovohxkxlcccvagpij`.
- Modo predeterminado de la app: BASE ANTERIOR; el inventario operativo NO se ha cambiado.
- Piloto explícito: `https://gioop92z.github.io/control-bodega/?backend=nuevo`.
- Integración GitHub→Supabase en el panel: **aún necesita vincular el repositorio** (no basta autorizar la GitHub App).

## Cambios efectivamente aplicados al servidor nuevo
1. Esquema de 10 tablas públicas: departamentos, productos, marbetes, producto_marbetes, movimientos, conteos, conteo_lineas, operadores v4, incidencias v4 y traslados v4.
2. RLS activo en todas las tablas públicas. RPC públicas como SECURITY INVOKER; operaciones privilegiadas en `vantis_core`, sin exposición de claves privadas al frontend.
3. Movimiento de stock idempotente por UUID, histórico, control de saldo y marbete. Alta de códigos provisionales (stock inicial 0), incrementada por cada entrada confirmada.
4. Importar catálogo por SKU sin reemplazar stock existente; ajuste físico separado con auditoría; resumen de departamento y cierre idempotente de conteo.
5. Traslado atómico entre marbetes que no modifica stock general; creación/consulta de incidencias con acceso por departamento.
6. Recepción continua habilitada: preflight, marbete, lecturas identificadas, reversas y ledger privado. Corregida doble suma de cantidad por ubicación.
7. Optimizaciones: índices de llaves foráneas y políticas de autenticación.
8. Se revocó la ejecución pública de `public.rls_auto_enable()` tras alerta de seguridad.

## Evidencia y alcance de pruebas
- Verificado mediante conexión Supabase: 10 tablas, todas con RLS, migraciones registradas, funciones presentes y proyecto saludable.
- El asesor de seguridad marca únicamente una advertencia informativa por la tabla privada `vantis_recepcion.lecturas`, protegida sin políticas y sin acceso DML de los roles públicos. Es intencional.
- El esquema inicial tiene **0 departamentos, 0 productos, 0 existencias, 0 usuarios en Auth**; no es una copia de la base anterior.
- Las RPC no han podido probarse con una sesión Auth real en este nuevo proyecto (no existen usuarios); faltan pruebas con dos operadores y escáner físico/iPhone.
- Se actualizaron las pruebas unitarias del frontend por nueva configuración; es necesario comprobar el último pipeline de GitHub Pages.

## BLOQUEADORES DEL CAMBIO DEFINITIVO
1. La conexión actual a Supabase solo autoriza el proyecto nuevo. Acceso al antiguo `dkqovohxkxlcccvagpij` devuelve *sin permisos*. Sin esa conexión o exportación de base anterior NO se pueden copiar ni cotejar departamentos, productos, ubicaciones, stocks, movimientos y conteos reales.
2. Crear o migrar cuentas vía Supabase Auth y asignar permisos. No generar filas a mano en `auth.users`; no reutilizar PIN embebidos públicamente para un sistema empresarial.
3. Vincular `gioop92z/control-bodega` en Supabase > Integrations > GitHub > Add connection. Esa operación del panel no se ha podido ejecutar con las herramientas actuales.
4. Conciliar cantidades por SKU y ubicación, auditar filas, cuentas, saldos y lecturas pendientes. Hacer copia de seguridad verificable. Solo entonces cambiar el backend predeterminado y probar la app en varios dispositivos.

## Fases funcionales
- Seguridad/confiabilidad: base y políticas instaladas, migración de identidad individual pendiente.
- Velocidad operativa: recepción continua y salidas rápidas en frontend; recepción del servidor nuevo preparada; ensayos reales pendientes.
- Control/inteligencia: localizador, panel, apoyos, incidencias, conteos y traslados implementados parcialmente. Informes consolidados y reservas multiusuario pendientes.
- Plataforma empresarial: paginación existente, estructura segura nueva; no están terminados multi-sesión, reportes por turno, offline multidispositivo, impresión industrial ni pruebas de carga certificadas.
- No desarrollar reposición inteligente, integraciones con sistemas externos ni asistente IA: exclusiones expresas del usuario.

**NO afirmar migración completa ni operatividad 100% hasta que los cuatro bloqueadores se hayan resuelto.**
