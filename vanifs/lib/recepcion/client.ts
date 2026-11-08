"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { audit, indexManifest } from "./audit";
import { readCache, saveReading, saveServer } from "./offline";
import { BATCH_LIMIT, newId, type TeamActor, type Device, type ScanAcknowledgment, type Delta, type Detail, type History, type ManifestRow, type OperationInput, type Receipt } from "./model";

import { environment, RequestError, request, watchRevisions } from "./transport";
export { request } from "./transport";

const endpoint = "/api/recepcion";

function remember(key: string, value?: string) {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key) ?? "";
  } catch { return ""; }
}

const fresh = { detail: null, pending: [] } as { detail: Detail | null; pending: OperationInput[] };

function merge(snapshot: typeof fresh, delta: Delta) {
  if (!snapshot.detail || snapshot.detail.receipt.id !== delta.receipt.id) return snapshot;
  const accepted = new Set([...(delta.acks ?? []).map(ack => ack.id), ...delta.batches.flatMap(batch => batch.ops.map(op => op.id))]);
  let batches = snapshot.detail.batches;
  if (delta.batches.length) {
    const combined = new Map(batches.map(batch => [batch.seq, batch]));
    delta.batches.forEach(batch => combined.set(batch.seq, batch));
    batches = [...combined.values()].sort((a, b) => a.seq - b.seq);
  }
  const current = snapshot.detail.receipt;
  const newer = delta.receipt.revision > current.revision || (
    delta.receipt.revision === current.revision &&
      Date.parse(delta.receipt.updatedAt ?? delta.receipt.createdAt) >= Date.parse(current.updatedAt ?? current.createdAt)
  );
  return {
    detail: { ...snapshot.detail, receipt: newer ? delta.receipt : current, live: newer && delta.live ? delta.live : snapshot.detail.live, batches },
    pending: accepted.size && snapshot.pending.length ? snapshot.pending.filter(op => !accepted.has(op.id)) : snapshot.pending,
  };
}

function message(error: unknown) {
  return error instanceof RequestError ? error.message : "No se pudo conectar. Las lecturas locales pueden sincronizarse al volver la red.";
}

let deviceMemo: Device | undefined;
export function browserDevice(): Device {
  if (deviceMemo) return deviceMemo;
  let id = newId();
  try {
    const stored = localStorage.getItem("vanifs:device");
    if (stored && /^[0-9a-f-]{36}$/i.test(stored)) id = stored;
    localStorage.setItem("vanifs:device", id);
  } catch {}
  const label = /iPhone/i.test(navigator.userAgent) ? "iPhone" : /iPad/i.test(navigator.userAgent) ? "iPad"
    : /Android/i.test(navigator.userAgent) ? "Android" : "Computadora";
  return deviceMemo = { id, label };
}

export type Confirmation = { ack?: ScanAcknowledgment; error?: string };

export function useReception(actor: TeamActor | null) {
  const [snapshot, setSnapshot] = useState(fresh);
  const [history, setHistory] = useState<History>({ receipts: [], next: null });
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(Boolean(actor));
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const current = useRef(fresh);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const openToken = useRef(0);
  const localWrites = useRef<Promise<unknown>>(Promise.resolve());
  const acknowledgments = useRef(new Map<string, ScanAcknowledgment>());
  const waiting = useRef(new Map<string, (result: Confirmation) => void>());
  const lastFailure = useRef("");
  const heartbeat = useRef<Promise<unknown> | null>(null);
  const boxRef = useRef("");
  const scope = useCallback((id: string) => environment + "|" + (actor?.id ?? "") + "|" + id, [actor?.id]);
  const localKey = "vanifs:last:" + environment + ":" + (actor?.id ?? "");
  const set = useCallback((value: typeof fresh) => { current.current = value; setSnapshot(value); }, []);

  const historyPage = useCallback(async (before?: string) => {
    if (!actor?.id) return { receipts: [], next: null } as History;
    const next = await request<History>(endpoint + (before ? "?before=" + encodeURIComponent(before) : ""));
    setHistory(prior => before ? { receipts: [...prior.receipts, ...next.receipts], next: next.next } : next);
    return next;
  }, [actor?.id]);

  const record = useCallback(async (receipt: Receipt, batches: Delta["batches"], rows?: ManifestRow[], confirmed?: string[]) => {
    try { await saveServer(scope(receipt.id), receipt, batches, rows, confirmed); }
    catch { setStorageError(true); }
  }, [scope]);

  const open = useCallback(async (id: string) => {
    if (current.current.detail?.receipt.id === id) return true;
    if (current.current.pending.length) {
      setError("Sincroniza o respalda las lecturas de la jornada abierta antes de cambiar.");
      return false;
    }
    const token = ++openToken.current;
    setLoading(true);
    setError("");
    let cache = fresh;
    try { cache = await readCache(scope(id)); } catch { setStorageError(true); }
    if (token !== openToken.current) return false;
    try {
      const detail = await request<Detail>(endpoint + "?id=" + id);
      if (token !== openToken.current) return false;
      if (detail.viewerRole && detail.viewerRole !== actor?.role) { location.reload(); return false; }
      const existing = current.current.detail?.receipt.id === id ? current.current.pending : cache.pending;
      const accepted = new Set(detail.batches.flatMap(batch => batch.ops.map(op => op.id)));
      set({ detail, pending: existing.filter(op => !accepted.has(op.id)) });
      await record(detail.receipt, detail.batches, detail.rows);
    } catch (e) {
      if (token !== openToken.current) return false;
      if (cache.detail && !(e instanceof RequestError && [401,403,404].includes(e.status))) {
        if (actor?.role === "collaborator") cache.detail.batches = cache.detail.batches.map(batch => ({ ...batch, ops: batch.ops.filter(op => op.actor.id === actor.id) }));
        set(cache);
      } else setError(message(e));
    } finally {
      if (token === openToken.current) setLoading(false);
    }
    const ok = current.current.detail?.receipt.id === id;
    if (ok) remember(localKey, id);
    return ok;
  }, [actor?.id, actor?.role, localKey, record, scope, set]);

  useEffect(() => {
    function update() { setOnline(navigator.onLine); }
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  useEffect(() => {
    if (!actor?.id) return;
    let active = true;
    async function init() {
      try {
        const prior = remember(localKey);
        if (prior) {
          const saved = await readCache(scope(prior)).catch(() => fresh);
          if (active && saved.detail && (saved.pending.length || !navigator.onLine) && !current.current.detail) await open(prior);
        }
        if (navigator.onLine) await historyPage();
      } catch (e) {
        if (!active) return;
        const id = remember(localKey);
        if (id && !current.current.detail) await open(id);
        else setError(message(e));
      } finally { if (active) setLoading(false); }
    }
    void init();
    return () => { active = false; };
  }, [actor?.id, historyPage, localKey, open, scope]);

  const acknowledge = useCallback((ack: ScanAcknowledgment) => {
    acknowledgments.current.set(ack.id, ack);
    waiting.current.get(ack.id)?.({ ack });
    while (acknowledgments.current.size > 512) acknowledgments.current.delete(acknowledgments.current.keys().next().value!);
  }, []);

  const flush = useCallback((pull = false) => {
    if (inFlight.current) return inFlight.current;
    const start = current.current;
    if (!start.detail) return Promise.resolve(true);
    if (!navigator.onLine) return Promise.resolve(false);
    const id = start.detail.receipt.id;
    const task = (async () => {
      setSyncing(Boolean(start.pending.length));
      lastFailure.current = "";
      try {
        await heartbeat.current;
        await localWrites.current;
        let attempted = false;
        while (current.current.detail?.receipt.id === id) {
          const now = current.current;
          const receipt = now.detail!.receipt;
          const ops = now.pending.slice(0, BATCH_LIMIT);
          if (!ops.length && (!pull || attempted)) break;
          const delta = ops.length
            ? await request<Delta>(endpoint, { action: "append", id, after: receipt.revision, ops, device: browserDevice(), remaining: Math.max(0, now.pending.length - ops.length) })
            : await request<Delta>(endpoint + "?id=" + id + "&after=" + receipt.revision);
          attempted = true;
          if (delta.viewerRole && delta.viewerRole !== actor?.role) { location.reload(); return false; }
          for (const ack of delta.acks ?? []) acknowledge(ack);
          // A response can be lost after commit. A server delta is also proof of persistence.
          for (const batch of delta.batches) for (const op of batch.ops) {
            if (waiting.current.has(op.id) && op.recordedAt && op.scanResult) {
              acknowledge({ id: op.id, at: op.recordedAt, result: op.scanResult, sku: op.registeredSku });
            }
          }
          if (delta.receipt.revision !== receipt.revision || delta.acks?.length || delta.receipt.closedAt !== receipt.closedAt || delta.receipt.pausedAt !== receipt.pausedAt) {
            await record(delta.receipt, delta.batches, undefined, delta.acks?.map(ack => ack.id));
          }
          if (current.current.detail?.receipt.id !== id) return true;
          const next = merge(current.current, delta);
          if (ops.length && next.pending.some(op => op.id === ops[0].id)) throw new Error("El lote no se confirmó.");
          set(next);
        }
        setError("");
        return true;
      } catch (e) {
        if (e instanceof RequestError && e.status === 409 && current.current.detail?.receipt.id === id) {
          const rev = current.current.detail.receipt.revision;
          try {
            const delta = await request<Delta>(endpoint + "?id=" + id + "&after=" + rev);
            if (current.current.detail?.receipt.id === id) set(merge(current.current, delta));
            await record(delta.receipt, delta.batches);
          } catch { /* The local outbox still contains the pending reads. */ }
        }
        if (e instanceof RequestError) {
          lastFailure.current = e.message;
          if (e.status >= 400 && e.status < 500 && e.status !== 429) {
            for (const op of current.current.pending) waiting.current.get(op.id)?.({ error: e.message });
          }
          if ([401,403,404].includes(e.status) && current.current.detail?.receipt.id === id) {
            set({ detail: null, pending: current.current.pending });
            void historyPage().catch(() => setHistory({ receipts: [], next: null }));
          }
        }
        setError(message(e));
        return false;
      } finally { setSyncing(false); }
    })();
    inFlight.current = task;
    void task.finally(() => { if (inFlight.current === task) inFlight.current = null; });
    return task;
  }, [acknowledge, actor?.role, historyPage, record, set]);

  const pendingCount = snapshot.pending.length;
  useEffect(() => {
    if (!pendingCount || !online || syncing || !snapshot.detail || snapshot.detail.receipt.canceled) return;
    const timer = window.setTimeout(() => { void flush(); }, error ? 5000 : 240);
    return () => window.clearTimeout(timer);
  }, [Boolean(pendingCount), snapshot.detail?.receipt.id, snapshot.detail?.receipt.closedAt, online, syncing, flush, error]);

  const pulse = useCallback(() => {
    const value = current.current;
    if (!value.detail || value.detail.receipt.closedAt || !navigator.onLine || inFlight.current) return;
    if (heartbeat.current) return heartbeat.current;
    const task = request("/api/equipo", {
      action: "pulse", id: value.detail.receipt.id, device: browserDevice(), pending: value.pending.length, box: boxRef.current,
    }).catch(() => undefined);
    heartbeat.current = task;
    void task.finally(() => { if (heartbeat.current === task) heartbeat.current = null; });
    return task;
  }, []);

  useEffect(() => {
    if (!online || !snapshot.detail) return;
    const pull = () => { if (!document.hidden) void flush(true); };
    pull();
    const unwatch = watchRevisions(snapshot.detail.receipt.id, pull);
    const timer = window.setInterval(pull, 12000);
    document.addEventListener("visibilitychange", pull);
    return () => { unwatch(); window.clearInterval(timer); document.removeEventListener("visibilitychange", pull); };
  }, [online, snapshot.detail?.receipt.id, snapshot.detail?.receipt.closedAt, flush]);

  useEffect(() => {
    if (!online || !snapshot.detail || snapshot.detail.receipt.closedAt) return;
    void pulse();
    const timer = window.setInterval(() => { if (!document.hidden) void pulse(); }, 12000);
    return () => window.clearInterval(timer);
  }, [online, snapshot.detail?.receipt.id, snapshot.detail?.receipt.closedAt, pulse]);

  useEffect(() => {
    if (online && (pendingCount || snapshot.detail?.receipt.pausedAt)) void pulse();
  }, [Boolean(pendingCount), snapshot.detail?.receipt.pausedAt, online, pulse]);

  function enqueue(op: OperationInput): Promise<boolean> {
    const value = current.current;
    if (!value.detail || value.detail.receipt.canceled || value.detail.receipt.archived) return Promise.resolve(false);
    op = { ...op, captureDevice: browserDevice().id };
    set({ ...value, pending: [...value.pending, op] });
    const saved = saveReading(scope(value.detail.receipt.id), op).then(() => true).catch(() => { setStorageError(true); return false; });
    localWrites.current = Promise.all([localWrites.current, saved]).then(() => undefined);
    return saved;
  }

  function confirm(id: string): Promise<Confirmation> {
    const previous = acknowledgments.current.get(id);
    if (previous) return Promise.resolve({ ack: previous });
    if (!navigator.onLine) return Promise.resolve({});
    return new Promise(resolve => {
      const finish = (result: Confirmation) => {
        clearTimeout(timeout);
        waiting.current.delete(id);
        resolve(result);
      };
      const timeout = window.setTimeout(() => finish(lastFailure.current ? { error: lastFailure.current } : {}), 27000);
      waiting.current.set(id, finish);
      void flush();
    });
  }

  async function create(id: string, title: string, file: string, rows: ManifestRow[]) {
    ++openToken.current;
    if (current.current.pending.length) throw new Error("Sincroniza tus lecturas pendientes antes de cambiar de jornada.");
    const { receipt } = await request<{ receipt: Receipt }>(endpoint, { action: "create", id, title, file, rows });
    const detail = await request<Detail>(endpoint + "?id=" + receipt.id);
    set({ detail, pending: [] });
    remember(localKey, receipt.id);
    await record(detail.receipt, detail.batches, detail.rows);
    void historyPage().catch(() => {});
    return detail;
  }

  async function finish(action: { action: "close"; note: string; acknowledged: boolean } | { action: "cancel" }) {
    const selected = current.current.detail;
    if (!selected || !actor) throw new Error("Abre una jornada.");
    const expected = selected.live?.totals ?? audit(indexManifest(selected.rows), selected.batches.flatMap(batch => batch.ops)).totals;
    if (!await flush(true) || current.current.pending.length) {
      throw new Error("Conéctate y sincroniza las lecturas antes de finalizar la jornada.");
    }
    const detail = current.current.detail;
    if (!detail || detail.receipt.id !== selected.receipt.id) throw new Error("La jornada cambió.");
    const checked = audit(indexManifest(detail.rows), detail.batches.flatMap(batch => batch.ops)).totals;
    if ((Object.keys(expected) as (keyof typeof expected)[]).some(key => expected[key] !== checked[key])) throw new Error("Llegaron nuevas lecturas. Revisa el resultado y confirma de nuevo.");
    const { receipt } = await request<{ receipt: Receipt }>(endpoint, {
      ...action, id: detail.receipt.id, revision: detail.receipt.revision, device: browserDevice(),
    });
    set(merge(current.current, { receipt, batches: [] }));
    await record(receipt, []);
    void historyPage().catch(() => {});
    return receipt;
  }

  return { ...snapshot, history, historyPage, open, create, finish, enqueue, confirm, flush, pulse, boxRef, online, syncing, loading, error, storageError };
}
