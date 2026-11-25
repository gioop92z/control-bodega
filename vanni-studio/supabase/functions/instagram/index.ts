// VANNI STUDIO · Conexión oficial con Instagram (Instagram API with Instagram Login).
// Rutas:
//   GET  /instagram/callback        ← redirección OAuth de Meta (pública, validada por «state»)
//   POST /instagram {action}        ← acciones del propietario (JWT) o del cron (secreto interno)
import { HttpError, appRedirect, corsHeaders, isAllowedReturnUrl, json } from '../_shared/http.ts';
import {
  admin, allowedOrigins, background, functionsBaseUrl, getConfig, isCronRequest, requireOwner, returnPrefixes, rpc, tokenKey,
} from '../_shared/server.ts';
import { openFromString, randomToken, seal, sealToString, sha256Hex } from '../_shared/crypto.ts';
import { IG_SCOPES, IgError, InstagramClient, buildAuthorizeUrl, exchangeCode, exchangeLongLived } from '../_shared/instagram.ts';
import { runSync } from '../_shared/sync.ts';
import { SupabaseSyncStore } from '../_shared/supabase-store.ts';

const sb = admin();
const store = new SupabaseSyncStore(sb);

async function appCredentials(): Promise<{ appId: string; appSecret: string; source: 'env' | 'db' } | null> {
  const envId = Deno.env.get('INSTAGRAM_APP_ID');
  const envSecret = Deno.env.get('INSTAGRAM_APP_SECRET');
  if (envId && envSecret) return { appId: envId, appSecret: envSecret, source: 'env' };
  const cfg = await getConfig(sb, ['instagram_app_id', 'instagram_app_secret']);
  if (!cfg.instagram_app_id || !cfg.instagram_app_secret) return null;
  return { appId: cfg.instagram_app_id, appSecret: await openFromString(cfg.instagram_app_secret, await tokenKey(sb)), source: 'db' };
}

async function redirectUri(): Promise<string> {
  return `${await functionsBaseUrl(sb)}/instagram/callback`;
}

function htmlPage(title: string, message: string, link?: string): Response {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const body = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#070807;color:#f2f3ef;font-family:system-ui,sans-serif">
<main style="max-width:420px;padding:24px"><p style="letter-spacing:.2em;font-size:12px;color:#3be58a">VANNI STUDIO</p><h1 style="font-size:22px">${esc(title)}</h1>
<p style="color:#a7aca5;line-height:1.5">${esc(message)}</p>${link ? `<a style="color:#3be58a" href="${esc(link)}">Volver a VANNI STUDIO</a>` : ''}</main></body></html>`;
  return new Response(body, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function handleCallback(url: URL): Promise<Response> {
  const state = url.searchParams.get('state');
  const fallback = returnPrefixes()[0];
  if (!state) return htmlPage('Solicitud incompleta', 'Falta el parámetro de seguridad «state». Inicia la conexión desde VANNI STUDIO.', fallback);
  const rows = await rpc<Array<{ user_id: string; return_url: string }>>(sb, 'svc_oauth_state_consume', { p_hash: await sha256Hex(state) });
  const st = rows?.[0];
  if (!st) return htmlPage('Enlace vencido', 'La autorización expiró o ya se utilizó. Vuelve a pulsar «Conectar mi Instagram».', fallback);
  const back = (params: Record<string, string>) => Response.redirect(appRedirect(st.return_url, '/instagram', params), 302);

  const deny = url.searchParams.get('error');
  if (deny) return back({ ig: 'error', reason: url.searchParams.get('error_description') || deny });
  const code = url.searchParams.get('code');
  if (!code) return back({ ig: 'error', reason: 'Meta no envió el código de autorización.' });

  try {
    const creds = await appCredentials();
    if (!creds) return back({ ig: 'error', reason: 'Configura primero el App ID y App Secret de Instagram.' });
    const short = await exchangeCode(fetch, { appId: creds.appId, appSecret: creds.appSecret, redirectUri: await redirectUri(), code });
    const long = await exchangeLongLived(fetch, { appSecret: creds.appSecret, shortToken: short.accessToken });
    const client = new InstagramClient(fetch, long.accessToken);
    const profile = await client.getProfile();
    const igUserId = String(profile.user_id || short.userId || profile.id);
    const expiresAt = new Date(Date.now() + long.expiresIn * 1000);
    const sealed = await seal(long.accessToken, await tokenKey(sb));
    await rpc(sb, 'svc_token_save', { p_user: st.user_id, p_ig_user: igUserId, p_cipher: sealed.ciphertext, p_iv: sealed.iv, p_expires: expiresAt.toISOString(), p_fresh_issue: true });

    const { data: prev } = await sb.from('ig_accounts').select('ig_user_id').eq('user_id', st.user_id).maybeSingle();
    const sameAccount = prev?.ig_user_id === igUserId;
    const nowIso = new Date().toISOString();
    const accountRow: Record<string, unknown> = {
      user_id: st.user_id, ig_user_id: igUserId, username: profile.username ?? null, name: profile.name ?? null,
      biography: profile.biography ?? null, website: profile.website ?? null, profile_picture_url: profile.profile_picture_url ?? null,
      account_type: profile.account_type ?? null, followers_count: profile.followers_count ?? null, follows_count: profile.follows_count ?? null,
      media_count: profile.media_count ?? null, status: 'connected', scopes: short.permissions.length ? short.permissions : IG_SCOPES,
      token_expires_at: expiresAt.toISOString(), token_refreshed_at: nowIso, connected_at: nowIso, last_error: null, last_error_at: null,
      next_sync_after: null, sync_started_at: null,
    };
    if (!sameAccount) { accountRow.backfilled_at = null; accountRow.audience_synced_on = null; }
    const { error } = await sb.from('ig_accounts').upsert(accountRow, { onConflict: 'user_id' });
    if (error) throw new Error(error.message);

    background(runSync(store, st.user_id, 'connect', { fetchImpl: fetch }));
    const missing = IG_SCOPES.filter((s) => short.permissions.length && !short.permissions.includes(s));
    return back(missing.length ? { ig: 'connected', missing: missing.join(',') } : { ig: 'connected' });
  } catch (e) {
    const msg = e instanceof IgError ? `Meta respondió: ${e.message}` : (e as Error).message;
    console.error('OAuth callback', msg);
    return back({ ig: 'error', reason: msg.slice(0, 300) });
  }
}

async function handleAction(req: Request, cors: Record<string, string>): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? '');

  if (action === 'cron') {
    if (!(await isCronRequest(sb, req))) throw new HttpError(401, 'Cron no autorizado', 'unauthorized');
    const users = await rpc<string[]>(sb, 'svc_token_users');
    background((async () => {
      for (const u of users ?? []) await runSync(store, u, 'cron', { fetchImpl: fetch });
    })());
    return json({ ok: true, accounts: users?.length ?? 0 }, 202, cors);
  }

  const user = await requireOwner(sb, req);

  if (action === 'status') {
    const creds = await appCredentials().catch(() => null);
    const [{ data: account }, { data: runs }, { data: support }] = await Promise.all([
      sb.from('ig_accounts').select('*').eq('user_id', user.id).maybeSingle(),
      sb.from('ig_sync_runs').select('*').eq('user_id', user.id).order('started_at', { ascending: false }).limit(15),
      sb.from('ig_metric_support').select('scope, metric, status, error, checked_at').eq('user_id', user.id).order('scope'),
    ]);
    return json({
      configured: !!creds,
      source: creds?.source ?? null,
      appId: creds?.appId ?? null,
      redirectUri: await redirectUri(),
      scopes: IG_SCOPES,
      account,
      runs: runs ?? [],
      support: support ?? [],
    }, 200, cors);
  }

  if (action === 'save-config') {
    const appId = String(body.appId ?? '').trim();
    const appSecret = String(body.appSecret ?? '').trim();
    if (!/^\d{6,20}$/.test(appId)) throw new HttpError(400, 'El App ID de Instagram debe contener solo números (6 a 20 dígitos).', 'invalid_app_id');
    if (!/^[A-Za-z0-9]{16,64}$/.test(appSecret)) throw new HttpError(400, 'El App Secret no tiene el formato esperado (16–64 caracteres alfanuméricos).', 'invalid_secret');
    await rpc(sb, 'svc_config_set', { p_key: 'instagram_app_id', p_value: appId });
    await rpc(sb, 'svc_config_set', { p_key: 'instagram_app_secret', p_value: await sealToString(appSecret, await tokenKey(sb)) });
    return json({ ok: true, appId }, 200, cors);
  }

  if (action === 'delete-config') {
    await rpc(sb, 'svc_config_delete', { p_key: 'instagram_app_id' });
    await rpc(sb, 'svc_config_delete', { p_key: 'instagram_app_secret' });
    return json({ ok: true }, 200, cors);
  }

  if (action === 'connect') {
    const creds = await appCredentials();
    if (!creds) throw new HttpError(400, 'Configura primero el App ID y App Secret de Instagram en el asistente.', 'not_configured');
    const returnUrl = String(body.returnUrl ?? '');
    if (!isAllowedReturnUrl(returnUrl, returnPrefixes())) throw new HttpError(400, 'Dirección de regreso no permitida.', 'invalid_return');
    const state = randomToken(32);
    await rpc(sb, 'svc_oauth_state_create', { p_hash: await sha256Hex(state), p_user: user.id, p_return: returnUrl, p_ttl_seconds: 900 });
    return json({ url: buildAuthorizeUrl(creds.appId, await redirectUri(), state) }, 200, cors);
  }

  if (action === 'sync') {
    const { data: last } = await sb.from('ig_sync_runs').select('started_at').eq('user_id', user.id).eq('trigger', 'manual').order('started_at', { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - Date.parse(last.started_at) < 60_000) {
      throw new HttpError(429, 'Espera un minuto entre sincronizaciones manuales para respetar los límites de Meta.', 'too_soon');
    }
    const tokens = await rpc<Array<unknown>>(sb, 'svc_token_get', { p_user: user.id });
    if (!tokens?.length) throw new HttpError(400, 'Instagram no está conectado.', 'not_connected');
    background(runSync(store, user.id, 'manual', { fetchImpl: fetch }));
    return json({ ok: true, started: true }, 202, cors);
  }

  if (action === 'disconnect') {
    await rpc(sb, 'svc_token_delete', { p_user: user.id });
    await sb.from('ig_accounts').update({ status: 'disconnected', token_expires_at: null, token_refreshed_at: null, sync_started_at: null, last_error: null }).eq('user_id', user.id);
    let deleted = false;
    if (body.deleteHistory === true) {
      for (const t of ['ig_media_insights_daily', 'ig_media', 'ig_account_insights', 'ig_profile_snapshots', 'ig_audience', 'ig_metric_support', 'ig_sync_runs']) {
        await sb.from(t).delete().eq('user_id', user.id);
      }
      await sb.from('ig_accounts').delete().eq('user_id', user.id);
      deleted = true;
    }
    return json({ ok: true, historyDeleted: deleted }, 200, cors);
  }

  throw new HttpError(400, `Acción desconocida: ${action}`, 'unknown_action');
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const cors = corsHeaders(req.headers.get('Origin'), allowedOrigins());
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method === 'GET' && url.pathname.endsWith('/callback')) return await handleCallback(url);
    if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido', 'method');
    return await handleAction(req, cors);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status, cors);
    console.error(e);
    return json({ error: (e as Error).message || 'Error interno', code: 'internal' }, 500, cors);
  }
});
