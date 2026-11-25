import { describe, it, expect } from 'vitest';
import { humanCode, normalizeCode, open, openFromString, randomToken, safeEqual, seal, sealToString, sha256Hex, bytesToBase64 } from './crypto.ts';
import { addDays, dayBoundsUnix, localDay, localHour } from './time.ts';
import { buildAuthorizeUrl, classifyGraphError, cleanAuthCode, exchangeCode, insightBreakdown } from './instagram.ts';
import { appRedirect, isAllowedReturnUrl, DEFAULT_RETURN_PREFIXES } from './http.ts';

const key = bytesToBase64(new Uint8Array(32).map((_, i) => i));

describe('cifrado', () => {
  it('cifra y descifra; el texto cifrado no contiene el token', async () => {
    const s = await seal('IGAAT-secret-token', key);
    expect(s.ciphertext).not.toContain('IGAAT');
    expect(await open(s, key)).toBe('IGAAT-secret-token');
    expect(await openFromString(await sealToString('app-secret', key), key)).toBe('app-secret');
  });
  it('detecta manipulación', async () => {
    const s = await seal('abc', key);
    const tampered = { ...s, ciphertext: s.ciphertext.slice(0, -4) + (s.ciphertext.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
    await expect(open(tampered, key)).rejects.toThrow();
  });
  it('códigos y hashes', async () => {
    expect(humanCode()).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(normalizeCode('k7qm-2xra')).toBe('K7QM2XRA');
    expect(randomToken().length).toBeGreaterThanOrEqual(43);
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(safeEqual('aa', 'aa')).toBe(true);
    expect(safeEqual('aa', 'ab')).toBe(false);
  });
});

describe('fechas locales', () => {
  it('calcula el día y los límites en Ciudad de México', () => {
    const at = Date.parse('2026-11-25T05:30:00Z'); // 23:30 del 24 en CDMX (UTC-6)
    expect(localDay(at, 'America/Mexico_City')).toBe('2026-11-24');
    expect(localHour(at, 'America/Mexico_City')).toBe(23);
    const b = dayBoundsUnix('2026-11-24', 'America/Mexico_City', Date.parse('2026-12-01T00:00:00Z'));
    expect(new Date(b.since * 1000).toISOString()).toBe('2026-11-24T06:00:00.000Z');
    expect(b.until - b.since).toBe(86_400);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('recorta el día en curso a «ahora»', () => {
    const now = Date.parse('2026-11-25T18:00:00Z');
    const b = dayBoundsUnix('2026-11-25', 'America/Mexico_City', now);
    expect(b.until).toBe(now / 1000);
  });
});

describe('OAuth de Instagram', () => {
  it('construye la URL de autorización oficial con estado y permisos', () => {
    const u = new URL(buildAuthorizeUrl('123', 'https://x.supabase.co/functions/v1/instagram/callback', 'st'));
    expect(u.origin + u.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(u.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_manage_insights');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('state')).toBe('st');
  });
  it('limpia el sufijo #_ del código', () => {
    expect(cleanAuthCode('AQBx#_')).toBe('AQBx');
  });
  it('interpreta la respuesta envuelta en data[] del intercambio de código', async () => {
    let body = '';
    const fetchImpl = async (_u: string, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ data: [{ access_token: 'short', user_id: 1784, permissions: 'instagram_business_basic,instagram_business_manage_insights' }] }), { status: 200 });
    };
    const r = await exchangeCode(fetchImpl, { appId: '1', appSecret: 's', redirectUri: 'https://r', code: 'abc#_' });
    expect(r).toEqual({ accessToken: 'short', userId: '1784', permissions: ['instagram_business_basic', 'instagram_business_manage_insights'] });
    expect(new URLSearchParams(body).get('code')).toBe('abc');
    expect(body).toContain('grant_type=authorization_code');
  });
  it('clasifica errores de la Graph API', () => {
    expect(classifyGraphError(400, { code: 190 }, false).kind).toBe('token');
    expect(classifyGraphError(400, { code: 4 }, true).kind).toBe('rate_limit');
    expect(classifyGraphError(400, { code: 100 }, true).kind).toBe('metric');
    expect(classifyGraphError(500, { code: 2 }, false).kind).toBe('transient');
  });
  it('convierte desgloses', () => {
    expect(insightBreakdown({ name: 'x', total_value: { breakdowns: [{ results: [{ dimension_values: ['REEL'], value: 3 }] }] } })).toEqual({ REEL: 3 });
  });
});

describe('redirecciones seguras', () => {
  it('solo permite volver a la app', () => {
    expect(isAllowedReturnUrl('https://gioop92z.github.io/control-bodega/studio/', DEFAULT_RETURN_PREFIXES)).toBe(true);
    expect(isAllowedReturnUrl('https://evil.example/control-bodega/studio/', DEFAULT_RETURN_PREFIXES)).toBe(false);
    expect(isAllowedReturnUrl('https://gioop92z.github.io/otro/', DEFAULT_RETURN_PREFIXES)).toBe(false);
    expect(appRedirect('https://gioop92z.github.io/control-bodega/studio/#/x', '/instagram', { ig: 'connected' }))
      .toBe('https://gioop92z.github.io/control-bodega/studio/#/instagram?ig=connected');
  });
});
