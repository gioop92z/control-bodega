// VANNI STUDIO · Copias de seguridad, exportación e importación completas.
import { HttpError, corsHeaders, json } from '../_shared/http.ts';
import { admin, allowedOrigins, background, isCronRequest, ownerUserId, requireOwner, type Admin } from '../_shared/server.ts';
import { BACKUP_FORMAT, BACKUP_TABLES, BACKUP_VERSION, orderRows, validateBackup } from '../_shared/tables.ts';

const sb = admin();
const BUCKET = 'vanni-backups';
const KEEP = 12;

async function exportAll(client: Admin, userId: string) {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client.from(t.name).select('*').eq('user_id', userId).range(from, from + 999);
      if (error) throw new Error(`${t.name}: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    tables[t.name] = rows;
    counts[t.name] = rows.length;
  }
  return { payload: { format: BACKUP_FORMAT, version: BACKUP_VERSION, app: 'VANNI STUDIO', exported_at: new Date().toISOString(), tables }, counts };
}

async function storeBackup(userId: string, trigger: string) {
  try {
    const { payload, counts } = await exportAll(sb, userId);
    const text = JSON.stringify(payload);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `${userId}/vanni-backup-${stamp}.json`;
    const { error } = await sb.storage.from(BUCKET).upload(path, new Blob([text], { type: 'application/json' }), { contentType: 'application/json', upsert: false });
    if (error) throw new Error(error.message);
    const { data: list } = await sb.storage.from(BUCKET).list(userId, { limit: 100, sortBy: { column: 'name', order: 'desc' } });
    const old = (list ?? []).filter((f) => f.name.endsWith('.json')).slice(KEEP).map((f) => `${userId}/${f.name}`);
    if (old.length) await sb.storage.from(BUCKET).remove(old);
    const row = { user_id: userId, trigger, status: 'success', storage_path: path, size_bytes: text.length, tables: counts };
    const { data } = await sb.from('backup_runs').insert(row).select('*').single();
    return data ?? row;
  } catch (e) {
    await sb.from('backup_runs').insert({ user_id: userId, trigger, status: 'error', error: (e as Error).message });
    throw e;
  }
}

async function importAll(userId: string, raw: unknown) {
  const { tables } = validateBackup(raw);
  const report: Record<string, { rows: number; error?: string }> = {};
  for (const spec of BACKUP_TABLES) {
    const rows = tables[spec.name];
    if (!rows?.length) continue;
    const prepared = orderRows(spec.name, rows).map((r) => {
      const copy: Record<string, unknown> = { ...r, user_id: userId };
      if (spec.name === 'ig_accounts') { copy.sync_started_at = null; copy.status = 'disconnected'; }
      return copy;
    });
    let done = 0;
    try {
      for (let i = 0; i < prepared.length; i += 500) {
        const { error } = await sb.from(spec.name).upsert(prepared.slice(i, i + 500), { onConflict: spec.conflict });
        if (error) throw new Error(error.message);
        done += Math.min(500, prepared.length - i);
      }
      report[spec.name] = { rows: done };
    } catch (e) {
      report[spec.name] = { rows: done, error: (e as Error).message };
    }
  }
  return report;
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'), allowedOrigins());
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido', 'method');
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    if (action === 'cron') {
      if (!(await isCronRequest(sb, req))) throw new HttpError(401, 'Cron no autorizado', 'unauthorized');
      const owner = await ownerUserId(sb);
      if (owner) background(storeBackup(owner, 'cron'));
      return json({ ok: true }, 202, cors);
    }

    const user = await requireOwner(sb, req);

    if (action === 'run') return json({ ok: true, run: await storeBackup(user.id, 'manual') }, 200, cors);

    if (action === 'export') {
      const { payload } = await exportAll(sb, user.id);
      return json(payload, 200, { ...cors, 'Content-Disposition': 'attachment; filename="vanni-studio-export.json"' });
    }

    if (action === 'list') {
      const { data, error } = await sb.storage.from(BUCKET).list(user.id, { limit: 100, sortBy: { column: 'name', order: 'desc' } });
      if (error) throw new Error(error.message);
      return json({ files: (data ?? []).filter((f) => f.name.endsWith('.json')).map((f) => ({ name: f.name, path: `${user.id}/${f.name}`, size: f.metadata?.size ?? null, created_at: f.created_at })) }, 200, cors);
    }

    if (action === 'download') {
      const path = String(body.path ?? '');
      if (!path.startsWith(`${user.id}/`) || path.includes('..')) throw new HttpError(400, 'Ruta no válida', 'invalid_path');
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 300, { download: true });
      if (error) throw new Error(error.message);
      return json({ url: data.signedUrl }, 200, cors);
    }

    if (action === 'delete') {
      const path = String(body.path ?? '');
      if (!path.startsWith(`${user.id}/`) || path.includes('..')) throw new HttpError(400, 'Ruta no válida', 'invalid_path');
      const { error } = await sb.storage.from(BUCKET).remove([path]);
      if (error) throw new Error(error.message);
      return json({ ok: true }, 200, cors);
    }

    if (action === 'restore') {
      const path = String(body.path ?? '');
      if (!path.startsWith(`${user.id}/`) || path.includes('..')) throw new HttpError(400, 'Ruta no válida', 'invalid_path');
      const { data, error } = await sb.storage.from(BUCKET).download(path);
      if (error || !data) throw new Error(error?.message ?? 'No se encontró la copia');
      return json({ ok: true, report: await importAll(user.id, JSON.parse(await data.text())) }, 200, cors);
    }

    if (action === 'import') {
      return json({ ok: true, report: await importAll(user.id, body.data) }, 200, cors);
    }

    throw new HttpError(400, `Acción desconocida: ${action}`, 'unknown_action');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status, cors);
    console.error(e);
    return json({ error: (e as Error).message || 'Error interno', code: 'internal' }, 500, cors);
  }
});
