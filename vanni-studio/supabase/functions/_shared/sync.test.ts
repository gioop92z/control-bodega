import { describe, it, expect } from 'vitest';
import { runSync, selectMediaForInsights } from './sync.ts';
import { MemoryStore } from './memory-store.ts';
import { createFakeGraph } from './fake-graph.ts';

const NOW = Date.parse('2026-11-25T18:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function storeWithToken(refreshedAgoMs = HOUR) {
  const s = new MemoryStore();
  s.token = { accessToken: 'tok', igUserId: '17841400000', issuedAt: new Date(NOW - refreshedAgoMs), expiresAt: new Date(NOW + 50 * DAY), refreshedAt: new Date(NOW - refreshedAgoMs) };
  return s;
}

const media = [
  { id: 'm1', media_product_type: 'REELS', media_type: 'VIDEO', timestamp: new Date(NOW - 2 * HOUR).toISOString(), like_count: 10 },
  { id: 'm2', media_product_type: 'FEED', media_type: 'IMAGE', timestamp: new Date(NOW - 20 * DAY).toISOString(), like_count: 5 },
];

describe('sincronización de Instagram', () => {
  it('primera sincronización: histórico de 30 días, publicaciones y métricas no disponibles', async () => {
    const store = storeWithToken();
    const g = createFakeGraph({ media, stories: [{ id: 's1', timestamp: new Date(NOW - HOUR).toISOString() }], unsupportedAccount: ['profile_views', 'website_clicks'], unsupportedMedia: ['ig_reels_video_view_total_time'] });
    const r = await runSync(store, 'u1', 'connect', { fetchImpl: g.fetchImpl, now: () => NOW });
    expect(r.status).toBe('success');
    expect(store.account.backfilled_at).toBeTruthy();
    expect(store.account.followers_count).toBe(1500);
    const days = new Set([...store.insights.values()].filter((x) => x.metric === 'reach').map((x) => x.day));
    expect(days.size).toBe(30);
    expect([...store.insights.values()].some((x) => x.metric === 'profile_views')).toBe(false);
    expect(store.support.get('account|profile_views')?.status).toBe('unavailable');
    expect(store.support.get('account|reach')?.status).toBe('available');
    expect(store.media.get('m1')?.insights.reach).toBe(700);
    expect(store.media.get('m1')?.unavailable_metrics).toContain('ig_reels_video_view_total_time');
    expect(store.media.get('s1')?.is_story).toBe(true);
    expect(store.media.get('s1')?.media_product_type).toBe('STORY');
    const demo = [...store.audience.values()].find((a) => a.metric === 'follower_demographics' && a.breakdown === 'country');
    expect(demo?.data).toEqual({ MX: 800, US: 90 });
    const online = [...store.audience.values()].find((a) => a.metric === 'online_followers');
    expect(online?.data.average_by_hour).toEqual({ '19': 110, '20': 150 });
    const fu = [...store.insights.values()].find((x) => x.metric === 'follows_and_unfollows__follow_type');
    expect(fu?.breakdown).toEqual({ FOLLOWER: 30, NON_FOLLOWER: 20 });
    expect(store.locked).toBe(false);
  });

  it('segunda sincronización del día: sin duplicados y sin repetir métricas no disponibles', async () => {
    const store = storeWithToken();
    const g1 = createFakeGraph({ media, unsupportedAccount: ['profile_views'], followers: 1500 });
    await runSync(store, 'u1', 'connect', { fetchImpl: g1.fetchImpl, now: () => NOW });
    const g2 = createFakeGraph({ media, unsupportedAccount: ['profile_views'], followers: 1512 });
    const r = await runSync(store, 'u1', 'cron', { fetchImpl: g2.fetchImpl, now: () => NOW + HOUR });
    expect(r.status).toBe('success');
    expect(store.snapshots.size).toBe(1);
    const snap = [...store.snapshots.values()][0];
    expect(snap.followers_open).toBe(1500);
    expect(snap.followers_count).toBe(1512);
    expect(g2.log.filter((l) => l.includes('profile_views')).length).toBe(0);
    expect(g2.log.filter((l) => l.includes('_demographics')).length).toBe(0); // demografía: una vez al día
    const reachRows = [...store.insights.values()].filter((x) => x.metric === 'reach');
    expect(reachRows.length).toBe(30);
  });

  it('renueva el token largo cuando tiene más de 7 días', async () => {
    const store = storeWithToken(8 * DAY);
    const g = createFakeGraph({ media: [] });
    await runSync(store, 'u1', 'cron', { fetchImpl: g.fetchImpl, now: () => NOW });
    expect(store.savedTokens[0].token).toBe('refreshed-token');
    expect(store.savedTokens[0].fresh).toBe(false);
    expect(store.account.token_refreshed_at).toBeTruthy();
  });

  it('token inválido: marca reconexión necesaria', async () => {
    const store = storeWithToken();
    const g = createFakeGraph({ tokenInvalid: true });
    const r = await runSync(store, 'u1', 'cron', { fetchImpl: g.fetchImpl, now: () => NOW });
    expect(r.status).toBe('error');
    expect(store.account.status).toBe('reconnect_required');
    expect([...store.runs.values()][0].status).toBe('error');
    expect(store.locked).toBe(false);
  });

  it('límite de la API: pausa y el cron respeta la pausa', async () => {
    const store = storeWithToken();
    const g = createFakeGraph({ rateLimited: true });
    const r = await runSync(store, 'u1', 'cron', { fetchImpl: g.fetchImpl, now: () => NOW });
    expect(r.status).toBe('rate_limited');
    expect(Date.parse(store.account.next_sync_after)).toBeGreaterThan(NOW);
    const again = await runSync(store, 'u1', 'cron', { fetchImpl: createFakeGraph({}).fetchImpl, now: () => NOW + HOUR });
    expect(again.status).toBe('skipped');
  });

  it('no ejecuta dos sincronizaciones a la vez', async () => {
    const store = storeWithToken();
    store.locked = true;
    const r = await runSync(store, 'u1', 'manual', { fetchImpl: createFakeGraph({}).fetchImpl, now: () => NOW });
    expect(r.status).toBe('skipped');
  });

  it('sin token: indica desconexión', async () => {
    const store = new MemoryStore();
    const r = await runSync(store, 'u1', 'manual', { fetchImpl: createFakeGraph({}).fetchImpl, now: () => NOW });
    expect(r.status).toBe('error');
    expect(store.account.status).toBe('disconnected');
  });
});

describe('prioridad de métricas por publicación', () => {
  it('prioriza stories y publicaciones nuevas, respeta intervalos y el presupuesto', () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    const state = [
      { ig_media_id: 'old-fresh', posted_at: iso(NOW - 100 * DAY), insights_fetched_at: iso(NOW - DAY), media_product_type: 'FEED', is_story: false },
      { ig_media_id: 'old-due', posted_at: iso(NOW - 100 * DAY), insights_fetched_at: iso(NOW - 8 * DAY), media_product_type: 'FEED', is_story: false },
      { ig_media_id: 'new-never', posted_at: iso(NOW - HOUR), insights_fetched_at: null, media_product_type: 'REELS', is_story: false },
      { ig_media_id: 'story', posted_at: iso(NOW - 2 * HOUR), insights_fetched_at: iso(NOW - HOUR), media_product_type: 'STORY', is_story: true },
      { ig_media_id: 'story-expired', posted_at: iso(NOW - 2 * DAY), insights_fetched_at: null, media_product_type: 'STORY', is_story: true },
      { ig_media_id: 'too-old', posted_at: iso(NOW - 800 * DAY), insights_fetched_at: null, media_product_type: 'FEED', is_story: false },
    ];
    expect(selectMediaForInsights(state, NOW, 10).map((m) => m.ig_media_id)).toEqual(['story', 'new-never', 'old-due']);
    expect(selectMediaForInsights(state, NOW, 1).map((m) => m.ig_media_id)).toEqual(['story']);
  });
});
