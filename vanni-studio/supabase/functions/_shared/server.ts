// Utilidades exclusivas del entorno Deno de Supabase Edge Functions.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.84.0';
import { HttpError, DEFAULT_APP_ORIGINS, DEFAULT_RETURN_PREFIXES } from './http.ts';
import { safeEqual } from './crypto.ts';

export type Admin = SupabaseClient;

function serviceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try { const parsed = JSON.parse(keys); const v = parsed.default ?? Object.values(parsed)[0]; if (v) return String(v); } catch { /* formato inesperado */ }
  }
  throw new Error('Falta la clave de servicio de Supabase en el entorno de la función.');
}

let adminClient: Admin | null = null;
export function admin(): Admin {
  if (!adminClient) {
    adminClient = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

export function allowedOrigins(): string[] {
  const env = Deno.env.get('VANNI_ALLOWED_ORIGINS');
  return env ? env.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_APP_ORIGINS;
}

export function returnPrefixes(): string[] {
  const env = Deno.env.get('VANNI_RETURN_PREFIXES');
  return env ? env.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_RETURN_PREFIXES;
}

export async function rpc<T = unknown>(sb: Admin, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export async function getConfig(sb: Admin, keys: string[]): Promise<Record<string, string>> {
  const rows = await rpc<Array<{ key: string; value: string }>>(sb, 'svc_config_get', { p_keys: keys });
  return Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]));
}

let cachedKey: string | null = null;
export async function tokenKey(sb: Admin): Promise<string> {
  if (cachedKey) return cachedKey;
  const env = Deno.env.get('VANNI_TOKEN_KEY');
  cachedKey = env || (await rpc<string>(sb, 'svc_token_key'));
  return cachedKey;
}

export interface OwnerUser { id: string; email: string | null }

/** Verifica el JWT de Supabase Auth y que pertenezca a la cuenta propietaria. */
export async function requireOwner(sb: Admin, req: Request): Promise<OwnerUser> {
  const auth = req.headers.get('Authorization') ?? '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) throw new HttpError(401, 'Inicia sesión para continuar.', 'unauthenticated');
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, 'Tu sesión expiró. Vuelve a iniciar sesión.', 'unauthenticated');
  const owner = await rpc<Array<{ user_id: string }>>(sb, 'svc_owner_info');
  if (!owner?.length || owner[0].user_id !== data.user.id) throw new HttpError(403, 'Esta cuenta no es la propietaria de VANNI STUDIO.', 'forbidden');
  return { id: data.user.id, email: data.user.email ?? null };
}

export async function isCronRequest(sb: Admin, req: Request): Promise<boolean> {
  const provided = req.headers.get('x-vanni-cron');
  if (!provided) return false;
  const cfg = await getConfig(sb, ['cron_secret']);
  return !!cfg.cron_secret && safeEqual(provided, cfg.cron_secret);
}

export async function functionsBaseUrl(sb: Admin): Promise<string> {
  const env = Deno.env.get('VANNI_FUNCTIONS_URL');
  if (env) return env.replace(/\/$/, '');
  const cfg = await getConfig(sb, ['functions_base_url']);
  return (cfg.functions_base_url || `${Deno.env.get('SUPABASE_URL')}/functions/v1`).replace(/\/$/, '');
}

export async function ownerUserId(sb: Admin): Promise<string | null> {
  const owner = await rpc<Array<{ user_id: string }>>(sb, 'svc_owner_info');
  return owner?.[0]?.user_id ?? null;
}

/** Ejecuta trabajo en segundo plano sin bloquear la respuesta HTTP. */
export function background(p: Promise<unknown>) {
  const safe = p.catch((e) => console.error('Tarea en segundo plano falló:', e));
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(safe);
}
