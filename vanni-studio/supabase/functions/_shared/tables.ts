// Inventario de tablas exportables y su orden de restauración (respeta llaves foráneas).
export interface TableSpec { name: string; conflict: string; serverOnly?: boolean }

export const BACKUP_TABLES: TableSpec[] = [
  { name: 'profiles', conflict: 'user_id' },
  { name: 'contacts', conflict: 'id' },
  { name: 'gyms', conflict: 'id' },
  { name: 'series', conflict: 'id' },
  { name: 'seasons', conflict: 'id' },
  { name: 'episodes', conflict: 'id' },
  { name: 'media_links', conflict: 'user_id,ig_media_id' },
  { name: 'routines', conflict: 'id' },
  { name: 'workouts', conflict: 'id' },
  { name: 'workout_sets', conflict: 'id' },
  { name: 'habits', conflict: 'id' },
  { name: 'goals', conflict: 'id' },
  { name: 'months', conflict: 'user_id,month' },
  { name: 'deals', conflict: 'id' },
  { name: 'interactions', conflict: 'id' },
  { name: 'rates', conflict: 'id' },
  { name: 'transactions', conflict: 'id' },
  { name: 'ideas', conflict: 'id' },
  { name: 'events', conflict: 'id' },
  { name: 'tasks', conflict: 'id' },
  { name: 'body_logs', conflict: 'user_id,day' },
  { name: 'attachments', conflict: 'id' },
  { name: 'categories', conflict: 'id' },
  { name: 'custom_fields', conflict: 'user_id,entity,key' },
  { name: 'collections', conflict: 'id' },
  { name: 'collection_items', conflict: 'id' },
  { name: 'templates', conflict: 'id' },
  { name: 'notes', conflict: 'id' },
  { name: 'manual_metrics', conflict: 'user_id,day,metric' },
  { name: 'ig_accounts', conflict: 'user_id', serverOnly: true },
  { name: 'ig_profile_snapshots', conflict: 'user_id,ig_user_id,day', serverOnly: true },
  { name: 'ig_account_insights', conflict: 'user_id,ig_user_id,day,metric', serverOnly: true },
  { name: 'ig_media', conflict: 'user_id,ig_media_id', serverOnly: true },
  { name: 'ig_media_insights_daily', conflict: 'user_id,ig_media_id,day', serverOnly: true },
  { name: 'ig_audience', conflict: 'user_id,ig_user_id,day,metric,breakdown,timeframe', serverOnly: true },
  { name: 'ig_metric_support', conflict: 'user_id,scope,metric', serverOnly: true },
];

export const BACKUP_FORMAT = 'vanni-studio-backup';
export const BACKUP_VERSION = 1;

/** Ordena objetivos para que los transferidos se inserten después de su original. */
export function orderRows(table: string, rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (table !== 'goals') return rows;
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const visit = (r: Record<string, unknown>, depth = 0) => {
    const id = r.id as string;
    if (seen.has(id) || depth > 50) return;
    const parent = r.carried_from ? byId.get(r.carried_from as string) : undefined;
    if (parent) visit(parent, depth + 1);
    seen.add(id);
    out.push(r);
  };
  rows.forEach((r) => visit(r));
  return out;
}

export function validateBackup(data: unknown): { tables: Record<string, Array<Record<string, unknown>>>; exportedAt?: string } {
  if (!data || typeof data !== 'object') throw new Error('El archivo no es una copia de VANNI STUDIO.');
  const d = data as Record<string, unknown>;
  if (d.format !== BACKUP_FORMAT) throw new Error('El archivo no es una copia de VANNI STUDIO (formato desconocido).');
  if (typeof d.version !== 'number' || d.version > BACKUP_VERSION) throw new Error('La copia proviene de una versión más nueva de VANNI STUDIO.');
  if (!d.tables || typeof d.tables !== 'object') throw new Error('La copia no contiene tablas.');
  const known = new Set(BACKUP_TABLES.map((t) => t.name));
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const [k, v] of Object.entries(d.tables as Record<string, unknown>)) {
    if (!known.has(k)) continue;
    if (!Array.isArray(v)) throw new Error(`La tabla ${k} no es una lista.`);
    tables[k] = v.filter((r) => r && typeof r === 'object') as Array<Record<string, unknown>>;
  }
  return { tables, exportedAt: typeof d.exported_at === 'string' ? d.exported_at : undefined };
}
