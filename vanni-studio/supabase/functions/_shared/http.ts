// Utilidades HTTP comunes a las Edge Functions.

export const DEFAULT_APP_ORIGINS = [
  'https://gioop92z.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
];

export const DEFAULT_RETURN_PREFIXES = [
  'https://gioop92z.github.io/control-bodega/studio/',
  'http://localhost:5173/',
  'http://localhost:4173/',
  'http://127.0.0.1:5173/',
  'http://127.0.0.1:4173/',
];

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error') {
    super(message);
  }
}

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const ok = origin && allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin! : allowed[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function isAllowedReturnUrl(url: string, prefixes: string[]): boolean {
  try {
    const u = new URL(url);
    if (u.username || u.password) return false;
    const normalized = `${u.origin}${u.pathname}`;
    return prefixes.some((p) => normalized.startsWith(p));
  } catch {
    return false;
  }
}

/** Une la URL base de la app con una ruta interna (HashRouter). */
export function appRedirect(base: string, route: string, params: Record<string, string>): string {
  const u = new URL(base);
  u.hash = '';
  const q = new URLSearchParams(params).toString();
  return `${u.toString()}#${route}${q ? `?${q}` : ''}`;
}

export function validEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
