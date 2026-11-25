// Capa de datos: caché en memoria por tabla, guardado automático con bandeja de salida persistente
// (sobrevive a recargas y a la falta de conexión) y sincronización en tiempo real entre dispositivos.
import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { uuid } from './ids';
import type { TableMap, TableName } from './types';

type AnyRow = { id: string; [k: string]: any };
type OpKind = 'insert' | 'update' | 'delete';
interface Op { seq: number; kind: OpKind; table: TableName; id: string; data?: Record<string, any> }

export interface SyncState { pending: number; error: string | null; offline: boolean; lastSavedAt: number | null }

const listeners = new Set<() => void>();
let syncState: SyncState = { pending: 0, error: null, offline: typeof navigator !== 'undefined' ? !navigator.onLine : false, lastSavedAt: null };
function setSync(patch: Partial<SyncState>) { syncState = { ...syncState, ...patch }; listeners.forEach((l) => l()); }
export function useSyncState(): SyncState { return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => syncState); }

type ErrorHandler = (msg: string) => void;
let onError: ErrorHandler = () => {};
export function setStoreErrorHandler(fn: ErrorHandler) { onError = fn; }

// ───────────────────────── Bandeja de salida
let userId: string | null = null;
let ops: Op[] = [];
let seq = 0;
let inflight: Op | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let backoff = 0;
const outboxKey = () => `vanni.outbox.v1.${userId}`;

function persist() {
  if (!userId) return;
  try { localStorage.setItem(outboxKey(), JSON.stringify(ops)); } catch { /* almacenamiento lleno o privado */ }
  setSync({ pending: ops.length + (inflight ? 1 : 0) });
}

function loadOutbox() {
  ops = [];
  if (!userId) return;
  try { const raw = localStorage.getItem(outboxKey()); if (raw) ops = JSON.parse(raw); } catch { ops = []; }
  seq = ops.reduce((m, o) => Math.max(m, o.seq), 0);
  setSync({ pending: ops.length });
}

function enqueue(op: Omit<Op, 'seq'>) {
  const last = ops[ops.length - 1];
  const sameTarget = (o: Op) => o.table === op.table && o.id === op.id;
  if (op.kind === 'update' && last && sameTarget(last) && last.kind !== 'delete') {
    last.data = { ...last.data, ...op.data };
  } else if (op.kind === 'delete') {
    const pendingInsert = ops.findIndex((o) => sameTarget(o) && o.kind === 'insert');
    if (pendingInsert >= 0) {
      ops = ops.filter((o) => !sameTarget(o));
      persist();
      return;
    }
    ops = ops.filter((o) => !(sameTarget(o) && o.kind === 'update'));
    ops.push({ ...op, seq: ++seq });
  } else {
    ops.push({ ...op, seq: ++seq });
  }
  persist();
  scheduleFlush(350);
}

function scheduleFlush(ms: number) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, ms);
}

function isNetworkError(err: { message?: string; code?: string } | null, status?: number): boolean {
  if (!err) return false;
  if (status === 0 || (status !== undefined && status >= 500) || status === 408 || status === 429) return true;
  const m = (err.message || '').toLowerCase();
  return m.includes('fetch') || m.includes('network') || m.includes('timeout') || m.includes('load failed') || m.includes('jwt expired');
}

async function send(op: Op): Promise<{ ok: boolean; retry: boolean; message?: string; row?: AnyRow }> {
  const q = supabase.from(op.table);
  try {
    if (op.kind === 'insert') {
      const { data, error, status } = await q.upsert({ ...op.data, id: op.id }, { onConflict: 'id' }).select('*').maybeSingle();
      if (error) return { ok: false, retry: isNetworkError(error, status), message: error.message };
      return { ok: true, retry: false, row: data ?? undefined };
    }
    if (op.kind === 'update') {
      const { data, error, status } = await q.update(op.data!).eq('id', op.id).select('*').maybeSingle();
      if (error) return { ok: false, retry: isNetworkError(error, status), message: error.message };
      return { ok: true, retry: false, row: data ?? undefined };
    }
    const { error, status } = await q.delete().eq('id', op.id);
    if (error) return { ok: false, retry: isNetworkError(error, status), message: error.message };
    return { ok: true, retry: false };
  } catch (e) {
    return { ok: false, retry: true, message: (e as Error).message };
  }
}

async function flush() {
  if (inflight || !userId) return;
  while (ops.length) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) { setSync({ offline: true }); return; }
    const op = ops.shift()!;
    inflight = op;
    persist();
    const res = await send(op);
    inflight = null;
    if (res.ok) {
      backoff = 0;
      if (res.row) stores.get(op.table)?.confirm(res.row);
      setSync({ error: null, offline: false, lastSavedAt: Date.now() });
      persist();
      continue;
    }
    if (res.retry) {
      ops.unshift(op);
      persist();
      backoff = Math.min(backoff ? backoff * 2 : 2000, 60_000);
      setSync({ error: 'Reintentando guardar…', offline: !navigator.onLine });
      scheduleFlush(backoff);
      return;
    }
    persist();
    const msg = friendlyDbError(res.message ?? 'No se pudo guardar');
    setSync({ error: msg });
    onError(msg);
    void stores.get(op.table)?.load();
  }
}

export function friendlyDbError(msg: string): string {
  if (/duplicate key|unique/i.test(msg)) return 'Ya existe un registro con esos datos (por ejemplo, el mismo día).';
  if (/mes está cerrado|complementos/i.test(msg)) return msg;
  if (/foreign key/i.test(msg)) return 'El elemento relacionado ya no existe.';
  if (/row-level security|permission/i.test(msg)) return 'Tu sesión no tiene permiso para esta acción. Vuelve a iniciar sesión.';
  return `No se pudo guardar: ${msg}`;
}

// ───────────────────────── Tiendas por tabla
interface Snapshot<T> { rows: T[]; byId: Map<string, T>; status: 'idle' | 'loading' | 'ready' | 'error'; error: string | null }

class TableStore<T extends AnyRow> {
  private map = new Map<string, T>();
  private subs = new Set<() => void>();
  private snap: Snapshot<T> = { rows: [], byId: new Map(), status: 'idle', error: null };
  lastLoad = 0;
  private loading: Promise<void> | null = null;

  constructor(public table: TableName, private order: { column: string; ascending: boolean }) {}

  subscribe = (l: () => void) => { this.subs.add(l); return () => { this.subs.delete(l); }; };
  getSnapshot = () => this.snap;
  get loaded() { return this.snap.status === 'ready'; }

  private emit(status = this.snap.status, error = this.snap.error) {
    const rows = [...this.map.values()];
    this.snap = { rows, byId: new Map(this.map), status, error };
    this.subs.forEach((l) => l());
  }

  ensure() { if (this.snap.status === 'idle') void this.load(); }

  load(): Promise<void> {
    if (this.loading) return this.loading;
    if (this.snap.status !== 'ready') this.emit('loading', null);
    this.loading = (async () => {
      try {
        const all: T[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.from(this.table).select('*').order(this.order.column, { ascending: this.order.ascending }).range(from, from + 999);
          if (error) throw error;
          all.push(...((data ?? []) as T[]));
          if (!data || data.length < 1000) break;
        }
        const next = new Map(all.map((r) => [r.id, r]));
        // Lo pendiente de guardar en este dispositivo prevalece sobre la copia del servidor.
        for (const op of [inflight, ...ops]) {
          if (!op || op.table !== this.table) continue;
          if (op.kind === 'delete') next.delete(op.id);
          else next.set(op.id, { ...(next.get(op.id) ?? {}), ...op.data, id: op.id } as T);
        }
        this.map = next;
        this.lastLoad = Date.now();
        this.emit('ready', null);
      } catch (e) {
        this.emit(this.snap.status === 'ready' ? 'ready' : 'error', (e as Error).message);
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  private hasPending(id: string) { return inflight?.id === id && inflight.table === this.table || ops.some((o) => o.table === this.table && o.id === id); }

  confirm(row: AnyRow) {
    if (this.hasPending(row.id)) {
      const local = this.map.get(row.id);
      this.map.set(row.id, { ...row, ...(local ?? {}) } as T);
    } else this.map.set(row.id, row as T);
    this.emit();
  }

  applyRemote(type: string, row: AnyRow | null, old: AnyRow | null) {
    if (!this.loaded) return;
    const id = (row?.id ?? old?.id) as string | undefined;
    if (!id || this.hasPending(id)) return;
    if (type === 'DELETE') this.map.delete(id);
    else if (row) this.map.set(id, row as T);
    this.emit();
  }

  insert(data: Partial<T>): T {
    const id = (data.id as string) ?? uuid();
    const now = new Date().toISOString();
    const row = { created_at: now, updated_at: now, ...data, id } as unknown as T;
    this.map.set(id, row);
    this.emit();
    const payload = { ...data, id };
    enqueue({ kind: 'insert', table: this.table, id, data: payload });
    return row;
  }

  update(id: string, patch: Partial<T>) {
    const prev = this.map.get(id);
    if (!prev) return;
    this.map.set(id, { ...prev, ...patch, updated_at: new Date().toISOString() });
    this.emit();
    enqueue({ kind: 'update', table: this.table, id, data: patch });
  }

  remove(id: string) {
    this.map.delete(id);
    this.emit();
    enqueue({ kind: 'delete', table: this.table, id });
  }

  reset() { this.map.clear(); this.lastLoad = 0; this.snap = { rows: [], byId: new Map(), status: 'idle', error: null }; this.subs.forEach((l) => l()); }
}

const ORDER: Partial<Record<TableName, { column: string; ascending: boolean }>> = {
  ig_profile_snapshots: { column: 'day', ascending: true },
  ig_account_insights: { column: 'day', ascending: true },
  ig_media: { column: 'posted_at', ascending: false },
  ig_audience: { column: 'day', ascending: false },
  ig_sync_runs: { column: 'started_at', ascending: false },
  ig_metric_support: { column: 'checked_at', ascending: true },
  events: { column: 'start_at', ascending: true },
  body_logs: { column: 'day', ascending: true },
  workouts: { column: 'day', ascending: false },
  transactions: { column: 'day', ascending: false },
  months: { column: 'month', ascending: false },
  interactions: { column: 'happened_at', ascending: false },
  manual_metrics: { column: 'day', ascending: true },
};

const stores = new Map<TableName, TableStore<AnyRow>>();
export function getStore<K extends TableName>(table: K): TableStore<TableMap[K] & AnyRow> {
  let s = stores.get(table);
  if (!s) { s = new TableStore(table, ORDER[table] ?? { column: 'created_at', ascending: true }); stores.set(table, s); }
  return s as unknown as TableStore<TableMap[K] & AnyRow>;
}

export interface TableApi<T> {
  rows: T[];
  byId: Map<string, T>;
  ready: boolean;
  loading: boolean;
  error: string | null;
  insert: (data: Partial<T>) => T;
  update: (id: string, patch: Partial<T>) => void;
  remove: (id: string) => void;
  reload: () => Promise<void>;
}

export function useTable<K extends TableName>(table: K): TableApi<TableMap[K]> {
  const store = getStore(table);
  useEffect(() => { store.ensure(); }, [store]);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return {
    rows: snap.rows as TableMap[K][],
    byId: snap.byId as Map<string, TableMap[K]>,
    ready: snap.status === 'ready',
    loading: snap.status === 'loading' || snap.status === 'idle',
    error: snap.error,
    insert: (d) => store.insert(d as any) as TableMap[K],
    update: (id, p) => store.update(id, p as any),
    remove: (id) => store.remove(id),
    reload: () => store.load(),
  };
}

// ───────────────────────── Ciclo de vida y tiempo real
let channel: ReturnType<typeof supabase.channel> | null = null;

export function startDataLayer(uid: string) {
  if (userId === uid) return;
  stopDataLayer();
  userId = uid;
  loadOutbox();
  scheduleFlush(50);
  channel = supabase
    .channel(`vanni-${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
      const s = stores.get(payload.table as TableName);
      s?.applyRemote(payload.eventType, (payload.new as AnyRow) ?? null, (payload.old as AnyRow) ?? null);
    })
    .subscribe();
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
}

export function stopDataLayer() {
  if (channel) { void supabase.removeChannel(channel); channel = null; }
  window.removeEventListener('online', onOnline);
  document.removeEventListener('visibilitychange', onVisible);
  stores.forEach((s) => s.reset());
  userId = null;
  ops = [];
  setSync({ pending: 0, error: null });
}

function refreshLoaded(minAgeMs: number) {
  stores.forEach((s) => { if (s.loaded && Date.now() - s.lastLoad > minAgeMs) void s.load(); });
}
function onOnline() { setSync({ offline: false }); scheduleFlush(100); refreshLoaded(5_000); }
function onVisible() { if (document.visibilityState === 'visible') { scheduleFlush(100); refreshLoaded(60_000); } }

export function flushNow() { return flush(); }
export function pendingOps() { return ops.length + (inflight ? 1 : 0); }
