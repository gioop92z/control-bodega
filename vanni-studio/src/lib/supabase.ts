import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY as string;
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'vanni-studio-auth' },
  realtime: { params: { eventsPerSecond: 20 } },
});

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

/** Llama a una Edge Function de VANNI STUDIO con la sesión actual. */
export async function callFunction<T = any>(name: string, body: Record<string, unknown>, opts: { auth?: boolean; timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
  if (opts.auth !== false) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_URL}/${name}`, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
  } catch (e) {
    throw new ApiError((e as Error).name === 'AbortError' ? 'El servidor tardó demasiado en responder.' : 'Sin conexión con el servidor. Revisa tu internet.', 0, 'network');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text.slice(0, 200) }; }
  if (!res.ok) throw new ApiError(json.error || `Error ${res.status}`, res.status, json.code);
  return json as T;
}
