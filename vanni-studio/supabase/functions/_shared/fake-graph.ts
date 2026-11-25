// Servidor simulado de la Graph API de Instagram — SOLO para pruebas automatizadas.
export interface FakeGraphOptions {
  followers?: number;
  unsupportedAccount?: string[];
  unsupportedMedia?: string[];
  tokenInvalid?: boolean;
  rateLimited?: boolean;
  media?: Array<{ id: string; media_product_type: string; media_type: string; timestamp: string; like_count?: number; comments_count?: number }>;
  stories?: Array<{ id: string; timestamp: string }>;
}

export function createFakeGraph(opts: FakeGraphOptions) {
  const log: string[] = [];
  const err = (status: number, code: number, message: string) =>
    new Response(JSON.stringify({ error: { message, type: 'OAuthException', code } }), { status, headers: { 'content-type': 'application/json' } });
  const ok = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

  const fetchImpl = async (input: string): Promise<Response> => {
    const url = new URL(input);
    log.push(url.pathname + '?' + [...url.searchParams].filter(([k]) => k !== 'access_token').map(([k, v]) => `${k}=${v}`).join('&'));
    if (opts.tokenInvalid) return err(400, 190, 'Error validating access token: Session has expired');
    if (opts.rateLimited) return err(400, 4, 'Application request limit reached');
    const path = url.pathname.replace(/^\/v\d+\.\d+/, '');
    if (path === '/refresh_access_token') return ok({ access_token: 'refreshed-token', token_type: 'bearer', expires_in: 5_184_000 });
    if (path === '/me') return ok({ id: '900', user_id: '17841400000', username: 'vanni', name: 'VANNI', account_type: 'MEDIA_CREATOR', followers_count: opts.followers ?? 1500, follows_count: 300, media_count: (opts.media ?? []).length, profile_picture_url: 'https://cdn.example/p.jpg' });
    if (path === '/me/media') return ok({ data: (opts.media ?? []).map((m) => ({ ...m, caption: `Post ${m.id}`, permalink: `https://instagram.com/p/${m.id}` })) });
    if (path === '/me/stories') return ok({ data: (opts.stories ?? []).map((s) => ({ ...s, media_type: 'VIDEO', media_product_type: 'STORY' })) });
    const insights = path.match(/^\/(\w+)\/insights$/);
    if (insights) {
      const id = insights[1];
      const metrics = (url.searchParams.get('metric') ?? '').split(',');
      const isAccount = id === '17841400000';
      const unsupported = isAccount ? (opts.unsupportedAccount ?? []) : (opts.unsupportedMedia ?? []);
      if (metrics.some((m) => unsupported.includes(m))) return err(400, 100, '(#100) metric[0] must be one of the following values: …');
      const breakdown = url.searchParams.get('breakdown');
      const data = metrics.map((name) => {
        if (name === 'online_followers') return { name, period: 'lifetime', values: [{ value: { '19': 120, '20': 140 } }, { value: { '19': 100, '20': 160 } }] };
        if (name.endsWith('_demographics')) return { name, period: 'lifetime', total_value: { breakdowns: [{ dimension_keys: [breakdown], results: [{ dimension_values: ['MX'], value: 800 }, { dimension_values: ['US'], value: 90 }] }] } };
        if (breakdown) return { name, period: 'day', total_value: { value: 50, breakdowns: [{ dimension_keys: [breakdown], results: [{ dimension_values: ['FOLLOWER'], value: 30 }, { dimension_values: ['NON_FOLLOWER'], value: 20 }] }] } };
        if (isAccount) return { name, period: 'day', total_value: { value: name === 'reach' ? 1000 : 40 } };
        return { name, period: 'lifetime', values: [{ value: name === 'reach' ? 700 : 12 }] };
      });
      return ok({ data }, { 'x-app-usage': JSON.stringify({ call_count: 3, total_time: 2, total_cputime: 1 }) });
    }
    return err(404, 803, 'Unknown path ' + path);
  };
  return { fetchImpl, log };
}
