// Prueba de extremo a extremo contra el backend REAL de Supabase (no simulado).
// Requiere: VANNI_E2E_CODE (código de propietario de prueba), app servida en BASE_URL.
// Crea una cuenta propietaria de prueba; al terminar se elimina desde el panel/SQL.
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const CODE = process.env.VANNI_E2E_CODE;
const EMAIL = process.env.VANNI_E2E_EMAIL ?? 'e2e-owner@example.com';
const PASS = process.env.VANNI_E2E_PASS ?? 'E2e-Prueba-Segura-2026';
const OUT = process.env.SHOTS ?? 'test-results/e2e';
if (!CODE) { console.error('Falta VANNI_E2E_CODE'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

// Chromium toma el proxy del entorno y omite la interfaz local por sí mismo.
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const ctx = await browser.newContext({ ...devices['iPhone 14'], deviceScaleFactor: 1, locale: 'es-MX', timezoneId: 'America/Mexico_City', acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|ERR_TUNNEL|net::ERR|Failed to load resource/i.test(m.text())) errors.push(`console: ${m.text()}`); });
// Respuestas HTTP fallidas del backend (el canal Realtime por WebSocket no atraviesa el proxy del entorno de pruebas).
const expected4xx = [/\/functions\/v1\/owner$/];
page.on('response', (r) => {
  const u = r.url();
  if (r.status() < 400 || /realtime|websocket/i.test(u)) return;
  if (r.status() === 403 && expected4xx.some((p) => p.test(u))) return;
  errors.push(`HTTP ${r.status()} ${r.request().method()} ${u.slice(0, 140)}`);
});

let n = 0;
const results = [];
async function step(name, fn) {
  n++;
  const t = Date.now();
  try {
    await fn();
    results.push(`✔ ${n}. ${name} (${Date.now() - t} ms)`);
    console.log(results.at(-1));
  } catch (e) {
    await page.screenshot({ path: `${OUT}/FAIL-${n}.png`, fullPage: true }).catch(() => {});
    console.log(`✘ ${n}. ${name}\n   ${e.message.split('\n')[0]}`);
    console.log(errors.slice(-5).join('\n'));
    await browser.close();
    process.exit(1);
  }
}
const go = (hash) => page.goto(`${BASE}#${hash}`);
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
const saved = () => page.locator('.save-state').filter({ hasText: 'Guardado' }).first().waitFor({ timeout: 20_000 });

await step('Pantalla de activación (registro cerrado, solo con código de propietario)', async () => {
  await page.goto(BASE);
  await page.getByRole('heading', { name: 'Activar tu cuenta privada' }).waitFor({ timeout: 20_000 });
  await shot('01-activar');
});

await step('Rechaza un código de propietario incorrecto', async () => {
  await page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill('AAAA-BBBB-CCCC-DDDD');
  await page.locator('#auth-email').fill(EMAIL);
  await page.locator('#auth-pass').fill(PASS);
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click();
  await page.getByText('El código de propietario no es válido').waitFor({ timeout: 20_000 });
});

let recovery = '';
await step('Crea la cuenta propietaria y muestra el código de recuperación', async () => {
  await page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(CODE);
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click();
  await page.getByText('Guarda tu código de recuperación').waitFor({ timeout: 30_000 });
  recovery = (await page.locator('.code-copy code').textContent())?.trim() ?? '';
  if (!/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/.test(recovery)) throw new Error(`Código inesperado: ${recovery}`);
  await page.getByRole('button', { name: /Ya lo guardé/ }).click();
  await page.getByText(/Buenos días|Buenas tardes|Buenas noches/).waitFor({ timeout: 30_000 });
  await shot('02-inicio');
});

await step('Siembra las 7 series iniciales editables', async () => {
  await go('/series');
  for (const t of ['THE IRON HUNT', 'GYMS CLANDESTINOS', 'GYM VS. GYM', 'GYM AFTER DARK', 'MÁQUINAS QUE NO DEBERÍAN EXISTIR', 'DESCONOCIDOS DE HIERRO', 'ENTRENANDO DONDE NADIE ENTRENA']) {
    await page.getByRole('heading', { name: t, exact: true }).waitFor({ timeout: 20_000 });
  }
  await saved();
  await shot('03-series');
});

await step('Crea temporada y episodio con guion; persiste tras recargar', async () => {
  await page.getByRole('heading', { name: 'THE IRON HUNT', exact: true }).click();
  await page.getByLabel('Nombre de la serie').waitFor();
  await page.getByRole('button', { name: 'Temporada' }).click();
  await page.getByRole('dialog').getByLabel('Título').fill('Ciudad de México');
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: 'Episodio' }).first().click();
  await page.getByLabel('Título del episodio').fill('El gimnasio subterráneo');
  await page.getByLabel('Guion').fill('ESCENA 1 — Bajamos las escaleras.');
  await page.getByLabel('Fecha de grabación').fill('2026-12-02');
  await saved();
  await page.waitForTimeout(1200);
  await saved();
  await page.reload();
  await page.getByLabel('Título del episodio').waitFor({ timeout: 20_000 });
  const v = await page.getByLabel('Título del episodio').inputValue();
  if (v !== 'El gimnasio subterráneo') throw new Error(`Título tras recargar: ${v}`);
  if ((await page.getByLabel('Guion').inputValue()) !== 'ESCENA 1 — Bajamos las escaleras.') throw new Error('El guion no persistió');
  await shot('04-episodio');
});

await step('Kanban de producción: mueve el episodio de etapa', async () => {
  await go('/produccion');
  const card = page.locator('.kanban-card', { hasText: 'El gimnasio subterráneo' });
  await card.waitFor({ timeout: 20_000 });
  await card.getByLabel('Mover a etapa').selectOption('grabacion');
  await saved();
  await page.reload();
  await page.locator('.kanban-col[aria-label="Grabación"] .kanban-card', { hasText: 'El gimnasio subterráneo' }).waitFor({ timeout: 20_000 });
  await shot('05-kanban');
});

await step('Agenda muestra la grabación del episodio', async () => {
  await go('/agenda?v=mes&d=2026-12-02');
  await page.getByText('Grabar: El gimnasio subterráneo').first().waitFor({ timeout: 20_000 });
  await shot('06-agenda');
});

await step('Captura rápida de evento recurrente y tarea', async () => {
  await page.getByRole('button', { name: 'Captura rápida' }).click();
  await page.getByRole('tab', { name: 'Evento' }).click();
  await page.getByPlaceholder('Título del evento').fill('Entreno pierna');
  await page.getByLabel('Categoría').selectOption('entrenamiento');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await page.getByText('Evento agregado a la agenda').waitFor();
  await page.getByRole('button', { name: 'Captura rápida' }).click();
  await page.getByRole('tab', { name: 'Tarea' }).click();
  await page.getByPlaceholder('¿Qué hay que hacer?').fill('Editar reel Iron Hunt');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await saved();
  await go('/tareas');
  await page.getByText('Editar reel Iron Hunt').waitFor({ timeout: 20_000 });
  await page.getByLabel('Completar Editar reel Iron Hunt').click();
  await saved();
  await page.getByRole('button', { name: 'Hechas' }).click();
  await page.getByLabel('Completar Editar reel Iron Hunt').waitFor();
  if (!(await page.getByLabel('Completar Editar reel Iron Hunt').isChecked())) throw new Error('La tarea no quedó completada');
});

await step('Gimnasio: registro, calificación 1–10 y ranking', async () => {
  await go('/gimnasios');
  await page.getByRole('button', { name: 'Gimnasio', exact: true }).click();
  await page.getByLabel('Nombre').first().fill('Iron Temple CDMX');
  await page.getByLabel('Ciudad').fill('Ciudad de México');
  await page.getByLabel('Enlace de Google Maps').fill('https://www.google.com/maps/place/Gym/@19.4326,-99.1332,17z');
  await page.getByRole('button', { name: 'Desde el enlace' }).click();
  await page.getByLabel('Maquinaria').fill('9');
  await page.getByLabel('Ambiente hardcore').fill('10');
  await page.getByLabel('Limpieza').fill('6');
  await page.locator('.score').first().filter({ hasText: '8.3' }).waitFor({ timeout: 10_000 });
  await saved();
  await go('/gimnasios/ranking');
  await page.getByRole('link', { name: /Iron Temple CDMX/ }).waitFor({ timeout: 20_000 });
  await shot('07-ranking');
});

await step('Laboratorio: idea rápida y conversión en episodio', async () => {
  await go('/laboratorio');
  await page.getByPlaceholder(/Una idea espontánea/).fill('Gym 24 h en azotea');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByRole('link', { name: /Gym 24 h en azotea/ }).click();
  await page.getByRole('button', { name: 'Convertir' }).click();
  await page.getByRole('button', { name: 'Crear episodio' }).click();
  await page.getByLabel('Título del episodio').waitFor({ timeout: 20_000 });
  if ((await page.getByLabel('Título del episodio').inputValue()) !== 'Gym 24 h en azotea') throw new Error('Conversión sin título');
  await saved();
});

await step('Evolución física: peso, entrenamiento con series y récord', async () => {
  await go('/evolucion');
  await page.getByLabel('Peso corporal (kg)').fill('78.4');
  await saved();
  await page.getByRole('tab', { name: 'Entrenos' }).click();
  await page.getByRole('button', { name: 'Iniciar entrenamiento' }).click();
  page.once('dialog', (d) => d.accept('Sentadilla'));
  await page.getByRole('button', { name: 'Agregar ejercicio' }).click();
  await page.getByPlaceholder('Reps').first().fill('5');
  await page.getByPlaceholder('kg').first().fill('140');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Listo' }).click();
  await saved();
  await page.getByRole('tab', { name: 'Récords' }).click();
  await page.getByRole('cell', { name: 'Sentadilla' }).waitFor({ timeout: 20_000 });
  await page.getByRole('cell', { name: /163,3 kg|163.3 kg/ }).waitFor();
});

await step('Objetivo automático de seguidores y Journey: cierre de mes con informe congelado', async () => {
  await go('/journey');
  await page.getByText(/Abrir el capítulo de/).click();
  await page.getByLabel('Objetivos del mes').fill('Publicar 8 reels y visitar 3 gimnasios');
  await page.getByRole('button', { name: 'Objetivo' }).click();
  await page.getByRole('dialog').getByLabel('Objetivo', { exact: true }).fill('Llegar a 10k');
  await page.getByRole('dialog').getByRole('button', { name: 'Listo' }).click();
  await saved();
  const acceptAll = (d) => d.accept();
  page.on('dialog', acceptAll);
  await page.getByRole('button', { name: 'Cerrar mes' }).click();
  await page.getByText('Mes cerrado. Informe guardado.').waitFor({ timeout: 20_000 });
  page.off('dialog', acceptAll);
  await page.getByText(/Informe generado/).waitFor();
  await page.getByPlaceholder(/Algo que quieras añadir/).fill('Complemento de prueba');
  await page.getByRole('button', { name: 'Agregar complemento' }).click();
  await saved();
  await page.reload();
  await page.getByText('Complemento de prueba').waitFor({ timeout: 20_000 });
  await shot('08-journey');
});

await step('Marca: oportunidad en pipeline con historial', async () => {
  await go('/marca');
  await page.getByRole('button', { name: 'Oportunidad' }).first().click();
  await page.getByLabel('Propuesta / oportunidad').fill('Patrocinio suplementos');
  await page.getByPlaceholder('Resumen de la conversación…').fill('Primer contacto por DM');
  await page.getByRole('button', { name: 'Agregar al historial' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Negociación' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Listo' }).click();
  await page.locator('.kanban-col[aria-label="Negociación"]', { hasText: 'Patrocinio suplementos' }).waitFor();
  await saved();
});

await step('Personalización: campo propio y colección de seguimiento', async () => {
  await go('/ajustes');
  await page.getByRole('tab', { name: 'Personalizar' }).click();
  await page.getByLabel('Nombre del campo').fill('Cámara usada');
  await page.getByRole('button', { name: 'Agregar campo' }).click();
  await page.getByText('Cámara usada').first().waitFor();
  await go('/colecciones');
  await page.getByRole('button', { name: 'Seguimiento' }).click();
  await page.getByRole('button', { name: 'Agregar' }).click();
  await page.getByRole('dialog').getByLabel('Valor').fill('3');
  await page.getByRole('dialog').getByRole('button', { name: 'Listo' }).click();
  await saved();
});

await step('Instagram sin configurar: no muestra datos ficticios', async () => {
  await go('/instagram');
  await page.getByText('Conecta tu Instagram real').waitFor({ timeout: 30_000 });
  const followers = await page.locator('.kpi', { hasText: 'Seguidores' }).first().locator('.kpi-value').textContent();
  if (followers?.trim() !== '—') throw new Error(`Se mostró un valor sin datos reales: ${followers}`);
  await shot('09-instagram');
});

await step('Asistente de Meta: guarda credenciales cifradas y genera la URL OAuth oficial', async () => {
  await go('/configurar-meta');
  await page.getByLabel('Instagram App ID').fill('1234567890123456');
  await page.getByLabel('Instagram App Secret').fill('abcdef0123456789abcdef0123456789');
  await page.getByRole('button', { name: 'Guardar en el servidor' }).click();
  await page.getByText(/Credenciales configuradas/).waitFor({ timeout: 30_000 });
  await page.route('https://www.instagram.com/**', (r) => r.fulfill({ status: 200, body: 'intercepted' }));
  const [req] = await Promise.all([page.waitForRequest((r) => r.url().startsWith('https://www.instagram.com/oauth/authorize'), { timeout: 30_000 }), page.getByRole('button', { name: 'Conectar mi Instagram' }).click()]);
  const u = new URL(req.url());
  if (u.searchParams.get('client_id') !== '1234567890123456') throw new Error('client_id incorrecto');
  if (u.searchParams.get('redirect_uri') !== 'https://xfmwpndnefzpobvsbdyu.supabase.co/functions/v1/instagram/callback') throw new Error(`redirect_uri: ${u.searchParams.get('redirect_uri')}`);
  if (u.searchParams.get('scope') !== 'instagram_business_basic,instagram_business_manage_insights') throw new Error('scope incorrecto');
  if (!u.searchParams.get('state') || u.searchParams.get('state').length < 40) throw new Error('state ausente');
  // La ruta interceptada sigue activa: la prueba nunca llega a instagram.com.
});

await step('Elimina las credenciales de prueba de Meta', async () => {
  await go('/configurar-meta');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Reemplazar o eliminar credenciales' }).click();
  await page.getByLabel('Instagram App ID').waitFor({ timeout: 30_000 });
});

await step('Media kit sin cifras inventadas', async () => {
  await go('/media-kit');
  await page.getByText('Conecta Instagram para incluir métricas reales').waitFor({ timeout: 20_000 });
  await shot('10-mediakit');
});

await step('Exporta toda la información (JSON) y crea copia de seguridad', async () => {
  await go('/ajustes');
  await page.getByRole('tab', { name: 'Datos y copias' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('button', { name: /Datos completos/ }).click()]);
  const path = await dl.path();
  const data = JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8'));
  if (data.format !== 'vanni-studio-backup') throw new Error('Formato de exportación incorrecto');
  if (!data.tables.episodes.some((e) => e.title === 'El gimnasio subterráneo')) throw new Error('La exportación no contiene el episodio');
  if (data.tables.series.length !== 7) throw new Error(`Series exportadas: ${data.tables.series.length}`);
  await page.getByRole('button', { name: 'Crear copia ahora' }).click();
  await page.getByText('Copia de seguridad creada').waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Restaurar' }).first().waitFor({ timeout: 20_000 });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Eliminar copia' }).first().click();
  await page.getByText('Aún no hay copias.').waitFor({ timeout: 20_000 });
});

await step('Cierra sesión y recupera el acceso con el código de recuperación', async () => {
  page.on('response', (r) => { if (/auth\/v1\/logout/.test(r.url())) console.log('   logout →', r.status()); });
  await go('/mas');
  await page.getByRole('button', { name: 'Cerrar sesión' }).last().click();
  await page.getByRole('heading', { name: 'Iniciar sesión' }).waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: /Olvidé mi contraseña/ }).click();
  await page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(recovery);
  await page.locator('#auth-email').fill(EMAIL);
  await page.locator('#auth-pass').fill(`${PASS}-nueva`);
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await page.getByText('Guarda tu código de recuperación').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /Ya lo guardé/ }).click();
  await page.getByRole('heading', { name: 'Todo', exact: true }).waitFor({ timeout: 30_000 });
});

await step('Otro dispositivo (sesión nueva) ve los mismos datos', async () => {
  const ctx2 = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-MX', timezoneId: 'America/Mexico_City' });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE);
  await p2.getByRole('heading', { name: 'Iniciar sesión' }).waitFor({ timeout: 20_000 });
  await p2.locator('#auth-email').fill(EMAIL);
  await p2.locator('#auth-pass').fill(`${PASS}-nueva`);
  await p2.getByRole('button', { name: 'Entrar' }).click();
  await p2.getByText(/Buenos días|Buenas tardes|Buenas noches/).waitFor({ timeout: 30_000 });
  await p2.goto(`${BASE}#/produccion`);
  await p2.locator('.kanban-card', { hasText: 'El gimnasio subterráneo' }).waitFor({ timeout: 20_000 });
  await p2.screenshot({ path: `${OUT}/11-escritorio.png` });
  await ctx2.close();
});

await browser.close();
console.log(`\n${results.length} pasos correctos.`);
if (errors.length) { console.log('Errores de consola:\n' + errors.join('\n')); process.exit(1); }
