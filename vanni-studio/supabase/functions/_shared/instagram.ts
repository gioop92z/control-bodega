// Cliente oficial «Instagram API with Instagram Login» (graph.instagram.com).
// Sin scraping ni contraseñas: solo OAuth y endpoints documentados por Meta.

export const IG_API_VERSION = 'v25.0';
export const IG_SCOPES = ['instagram_business_basic', 'instagram_business_manage_insights'];
export const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
export const TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
export const GRAPH = 'https://graph.instagram.com';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
  fbtrace_id?: string;
}

export class IgError extends Error {
  constructor(
    message: string,
    public kind: 'token' | 'rate_limit' | 'metric' | 'permission' | 'not_found' | 'transient' | 'api',
    public code?: number,
    public subcode?: number,
    public status?: number,
  ) {
    super(message);
    this.name = 'IgError';
  }
}

export function classifyGraphError(status: number, err: GraphErrorBody | undefined, isInsights: boolean): IgError {
  const code = err?.code;
  const sub = err?.error_subcode;
  const msg = (err?.error_user_msg || err?.message || `HTTP ${status}`).slice(0, 500);
  if (code === 190 || code === 102 || (status === 401 && !isInsights)) return new IgError(msg, 'token', code, sub, status);
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80002 || code === 80006 || status === 429)
    return new IgError(msg, 'rate_limit', code, sub, status);
  if (isInsights && (code === 100 || code === 10)) return new IgError(msg, 'metric', code, sub, status);
  if (code === 10 || code === 200 || (code !== undefined && code >= 200 && code < 300)) return new IgError(msg, 'permission', code, sub, status);
  if (status === 404 || code === 803) return new IgError(msg, 'not_found', code, sub, status);
  if (status >= 500 || code === 1 || code === 2) return new IgError(msg, 'transient', code, sub, status);
  return new IgError(msg, 'api', code, sub, status);
}

export interface TokenResponse {
  access_token: string;
  user_id?: string | number;
  permissions?: string | string[];
  expires_in?: number;
}

export function buildAuthorizeUrl(appId: string, redirectUri: string, state: string): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set('client_id', appId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', IG_SCOPES.join(','));
  u.searchParams.set('state', state);
  u.searchParams.set('enable_fb_login', 'false');
  return u.toString();
}

/** Meta añade «#_» al final del código; no forma parte de él. */
export function cleanAuthCode(code: string): string {
  return code.replace(/#_$/, '').trim();
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text.slice(0, 300) }; }
}

export async function exchangeCode(fetchImpl: FetchLike, p: { appId: string; appSecret: string; redirectUri: string; code: string }): Promise<{ accessToken: string; userId: string; permissions: string[] }> {
  const body = new URLSearchParams({
    client_id: p.appId,
    client_secret: p.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: p.redirectUri,
    code: cleanAuthCode(p.code),
  });
  const res = await fetchImpl(TOKEN_URL, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const json = await readJson(res);
  if (!res.ok || json.error_type || json.error) {
    const err = json.error ?? { message: json.error_message, code: json.code };
    throw classifyGraphError(res.status, err, false);
  }
  const row: TokenResponse = Array.isArray(json.data) ? json.data[0] : json;
  if (!row?.access_token) throw new IgError('Meta no devolvió un token de acceso.', 'api');
  const perms = Array.isArray(row.permissions) ? row.permissions : String(row.permissions ?? '').split(',').filter(Boolean);
  return { accessToken: row.access_token, userId: String(row.user_id ?? ''), permissions: perms };
}

export async function exchangeLongLived(fetchImpl: FetchLike, p: { appSecret: string; shortToken: string }): Promise<{ accessToken: string; expiresIn: number }> {
  const u = new URL(`${GRAPH}/access_token`);
  u.searchParams.set('grant_type', 'ig_exchange_token');
  u.searchParams.set('client_secret', p.appSecret);
  u.searchParams.set('access_token', p.shortToken);
  const res = await fetchImpl(u.toString());
  const json = await readJson(res);
  if (!res.ok || json.error) throw classifyGraphError(res.status, json.error, false);
  return { accessToken: json.access_token, expiresIn: Number(json.expires_in ?? 5_184_000) };
}

export async function refreshLongLived(fetchImpl: FetchLike, token: string): Promise<{ accessToken: string; expiresIn: number }> {
  const u = new URL(`${GRAPH}/refresh_access_token`);
  u.searchParams.set('grant_type', 'ig_refresh_token');
  u.searchParams.set('access_token', token);
  const res = await fetchImpl(u.toString());
  const json = await readJson(res);
  if (!res.ok || json.error) throw classifyGraphError(res.status, json.error, false);
  return { accessToken: json.access_token, expiresIn: Number(json.expires_in ?? 5_184_000) };
}

export interface IgProfile {
  id: string;
  user_id?: string;
  username?: string;
  name?: string;
  account_type?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  biography?: string;
  website?: string;
}

export interface IgMediaItem {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

export interface InsightItem {
  name: string;
  period?: string;
  total_value?: { value?: unknown; breakdowns?: Array<{ dimension_keys?: string[]; results?: Array<{ dimension_values?: string[]; value?: number }> }> };
  values?: Array<{ value?: unknown; end_time?: string }>;
}

export const PROFILE_FIELDS_FULL = 'id,user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography,website';
export const PROFILE_FIELDS_CORE = 'id,username,profile_picture_url,followers_count,follows_count,media_count';
export const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,permalink,media_url,thumbnail_url,timestamp,like_count,comments_count';
export const STORY_FIELDS = 'id,caption,media_type,media_product_type,permalink,media_url,thumbnail_url,timestamp';

/** Métricas de cuenta (total_value, period=day) solicitadas; las no admitidas se descartan solas. */
export const ACCOUNT_DAY_METRICS = [
  'reach', 'views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'shares', 'saves',
  'replies', 'reposts', 'profile_links_taps', 'follows_and_unfollows', 'profile_views', 'website_clicks',
];

export const MEDIA_METRICS: Record<string, string[]> = {
  REELS: ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reposts'],
  FEED: ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'profile_visits', 'follows', 'reposts'],
  STORY: ['views', 'reach', 'replies', 'shares', 'total_interactions', 'follows', 'profile_visits', 'navigation', 'reposts'],
};

export function mediaScope(item: { media_product_type?: string | null; is_story?: boolean }): 'REELS' | 'FEED' | 'STORY' {
  if (item.is_story || item.media_product_type === 'STORY') return 'STORY';
  if (item.media_product_type === 'REELS') return 'REELS';
  return 'FEED';
}

export interface UsageInfo { maxPercent: number }

export class InstagramClient {
  calls = 0;
  usage: UsageInfo = { maxPercent: 0 };

  constructor(private fetchImpl: FetchLike, private token: string, private version = IG_API_VERSION) {}

  setToken(token: string) { this.token = token; }

  private trackUsage(res: Response) {
    for (const h of ['x-app-usage', 'x-business-use-case-usage', 'x-ig-usage']) {
      const v = res.headers.get(h);
      if (!v) continue;
      try {
        const nums: number[] = [];
        const walk = (o: unknown) => {
          if (typeof o === 'number') nums.push(o);
          else if (o && typeof o === 'object') Object.values(o as Record<string, unknown>).forEach(walk);
        };
        walk(JSON.parse(v));
        const max = Math.max(0, ...nums.filter((n) => n <= 100));
        this.usage.maxPercent = Math.max(this.usage.maxPercent, max);
      } catch { /* encabezado no numérico */ }
    }
  }

  async request(pathOrUrl: string, params: Record<string, string | number | undefined> = {}, opts: { insights?: boolean } = {}): Promise<any> {
    const url = pathOrUrl.startsWith('https://') ? new URL(pathOrUrl) : new URL(`${GRAPH}/${this.version}/${pathOrUrl.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', this.token);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      this.calls++;
      let res: Response;
      try {
        res = await this.fetchImpl(url.toString());
      } catch (e) {
        lastErr = new IgError(`Sin conexión con Instagram: ${(e as Error).message}`, 'transient');
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      this.trackUsage(res);
      const json = await readJson(res);
      if (res.ok && !json.error) return json;
      const err = classifyGraphError(res.status, json.error, !!opts.insights);
      if (err.kind === 'transient' && attempt === 0) { lastErr = err; await new Promise((r) => setTimeout(r, 600)); continue; }
      throw err;
    }
    throw lastErr;
  }

  async getProfile(): Promise<IgProfile> {
    try {
      return await this.request('me', { fields: PROFILE_FIELDS_FULL });
    } catch (e) {
      if (e instanceof IgError && (e.kind === 'api' || e.kind === 'permission') && e.code === 100) {
        return await this.request('me', { fields: PROFILE_FIELDS_CORE });
      }
      throw e;
    }
  }

  async listMedia(maxPages: number, pageSize = 50): Promise<IgMediaItem[]> {
    const out: IgMediaItem[] = [];
    let json = await this.request('me/media', { fields: MEDIA_FIELDS, limit: pageSize });
    for (let page = 1; ; page++) {
      out.push(...(json.data ?? []));
      const next: string | undefined = json.paging?.next;
      if (!next || page >= maxPages) break;
      json = await this.request(next);
    }
    return out;
  }

  async listStories(): Promise<IgMediaItem[]> {
    const json = await this.request('me/stories', { fields: STORY_FIELDS });
    return json.data ?? [];
  }

  accountInsights(igUserId: string, metrics: string[], params: Record<string, string | number | undefined>): Promise<{ data?: InsightItem[] }> {
    return this.request(`${igUserId}/insights`, { metric: metrics.join(','), ...params }, { insights: true });
  }

  mediaInsights(mediaId: string, metrics: string[]): Promise<{ data?: InsightItem[] }> {
    return this.request(`${mediaId}/insights`, { metric: metrics.join(',') }, { insights: true });
  }
}

/** Valor escalar de una métrica (total_value o values[0]); objetos se devuelven tal cual. */
export function insightValue(item: InsightItem): unknown {
  if (item.total_value && 'value' in item.total_value) return item.total_value.value;
  if (item.values && item.values.length) return item.values[item.values.length - 1]?.value;
  return undefined;
}

/** Convierte breakdowns de total_value en un objeto { dimension: valor }. */
export function insightBreakdown(item: InsightItem): Record<string, number> | null {
  const b = item.total_value?.breakdowns?.[0];
  if (!b?.results?.length) return null;
  const out: Record<string, number> = {};
  for (const r of b.results) out[(r.dimension_values ?? []).join(' · ') || '—'] = Number(r.value ?? 0);
  return out;
}
