import { createClient } from "@supabase/supabase-js";
import { vantisBackendConfig } from "../../../vantis-backend-config.mjs";
import type { Delta, Detail, ManifestRow } from "./model";

export const environment = vantisBackendConfig.mode;
export const supabase = createClient(vantisBackendConfig.url, vantisBackendConfig.key, {
  auth: { persistSession: true, autoRefreshToken: true },
  global: { fetch: (input, init) => fetch(input, {
    ...init, signal: init?.signal ?? (typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(25000) : undefined),
  }) },
});

export function moduleUrl(module = "recepcion") {
  const url = new URL("./", window.location.href);
  if (environment === "NUEVO_EN_PREPARACION") url.searchParams.set("backend", "nuevo");
  url.searchParams.set("modulo", module);
  return url;
}

export function inventoryUrl() {
  const url = new URL("../", window.location.href);
  if (environment === "NUEVO_EN_PREPARACION") url.searchParams.set("backend", "nuevo");
  url.searchParams.set("modulo", "inventario");
  return url;
}

export class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function rpc<T>(route: string, action: string, payload: unknown = {}): Promise<T> {
  const { data, error, status } = await supabase.rpc("vanifs_api", {
    p_route: route, p_action: action, p_data: payload,
  });
  if (error) {
    const statusCode = error.code === "42501" ? 403 : error.code === "PGRST202" ? 503 : status;
    throw new RequestError(
      statusCode === 503 ? "La recepción todavía no está habilitada en este servidor."
        : statusCode ? error.message : "Se interrumpió la conexión. Las lecturas quedan en el dispositivo.",
      statusCode,
    );
  }
  return data as T;
}

const EVENT_PAGE = 250;
async function allBatches(delta: Delta, id: string) {
  let batch = delta.batches;
  if (batch.length < EVENT_PAGE || batch.at(-1)!.seq >= delta.receipt.revision) return batch;
  const batches = [...batch];
  while (batch.length === EVENT_PAGE && batch.at(-1)!.seq < delta.receipt.revision) {
    const { batches: next } = await rpc<Delta>("receipt", "detail", {
      id, after: batch.at(-1)!.seq, through: delta.receipt.revision,
    });
    if (next.length && next[0].seq <= batch.at(-1)!.seq) throw new Error("Página repetida de lecturas.");
    batches.push(...next);
    batch = next;
  }
  return batches;
}

async function readRows(id: string, count: number) {
  const rows: ManifestRow[] = [];
  for (let offset = 0; offset < count; offset += 1600) {
    const pages = await Promise.all(Array.from({ length: Math.min(4, Math.ceil((count - offset) / 400)) },
      (_, page) => rpc<{ rows: ManifestRow[] }>("receipt", "rows", { id, offset: offset + page * 400 })));
    rows.push(...pages.flatMap(page => page.rows));
  }
  if (rows.length !== count) throw new Error("El manifiesto está incompleto.");
  return rows;
}

export async function request<T>(address: string, data?: unknown): Promise<T> {
  const url = new URL(address, window.location.href);
  const query = Object.fromEntries(url.searchParams);
  const payload = data as Record<string, unknown> | undefined;
  const action = String(payload?.action ?? "");
  if (url.pathname === "/api/acceso") {
    if (action === "logout") {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      return { ok: true } as T;
    }
    return rpc<T>("access", action, payload);
  }
  if (url.pathname === "/api/equipo") return rpc<T>("team", action || query.view || "members", payload ?? query);
  if (url.pathname !== "/api/recepcion") throw new Error("Ruta desconocida de recepción.");
  if (payload) {
    if (action !== "append") return rpc<T>("receipt", action, payload);
    const result = await rpc<Delta>("receipt", action, payload);
    return { ...result, batches: await allBatches(result, String(payload.id)) } as T;
  }
  if (!query.id) return rpc<T>("receipt", query.today ? "today" : "list", query);
  const result = await rpc<Delta>("receipt", "detail", query);
  const [batches, rows] = await Promise.all([
    allBatches(result, query.id),
    query.after === undefined ? readRows(query.id, result.receipt.lineCount) : Promise.resolve(undefined),
  ]);
  return { ...result, batches, ...(rows ? { rows } satisfies Pick<Detail, "rows"> : {}) } as T;
}

export function watchRevisions(id: string | null, onChange: () => void) {
  let timer: number | undefined;
  const schedule = () => {
    if (timer !== undefined) return;
    timer = window.setTimeout(() => { timer = undefined; if (!document.hidden) onChange(); }, 350);
  };
  const channel = supabase.channel(id ? "vanifs:" + id : "vanifs:today");
  const source = { schema: "public", table: "vanifs_revisions" };
  if (id) channel.on("postgres_changes", { ...source, event: "*", filter: "journey_id=eq." + id }, schedule);
  else channel.on("postgres_changes", { ...source, event: "INSERT" }, schedule);
  channel.subscribe(status => { if (status === "SUBSCRIBED") schedule(); });
  return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
}
