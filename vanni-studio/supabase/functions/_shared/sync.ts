// Motor de sincronización de estadísticas reales de Instagram.
// Independiente del entorno: recibe `fetch` y un almacén (Supabase en producción, memoria en pruebas).

import {
  ACCOUNT_DAY_METRICS, IgError, InstagramClient, MEDIA_METRICS, insightBreakdown, insightValue, mediaScope,
  refreshLongLived, type FetchLike, type IgMediaItem, type InsightItem,
} from './instagram.ts';
import { addDays, dayBoundsUnix, localDay } from './time.ts';

export type SupportStatus = 'available' | 'empty' | 'unavailable';
export interface SupportRow { scope: string; metric: string; status: SupportStatus; error?: string | null; checked_at: string }

export interface TokenRecord { accessToken: string; igUserId: string; issuedAt: Date; expiresAt: Date | null; refreshedAt: Date }

export interface AccountState {
  backfilled_at: string | null;
  audience_synced_on: string | null;
  next_sync_after: string | null;
  status: string;
}

export interface MediaState { ig_media_id: string; posted_at: string | null; insights_fetched_at: string | null; media_product_type: string | null; is_story: boolean }

export interface SyncStore {
  timezone(userId: string): Promise<string>;
  getToken(userId: string): Promise<TokenRecord | null>;
  saveToken(userId: string, igUserId: string, accessToken: string, expiresAt: Date, freshIssue: boolean): Promise<void>;
  lock(userId: string): Promise<boolean>;
  unlock(userId: string): Promise<void>;
  getAccount(userId: string): Promise<AccountState | null>;
  updateAccount(userId: string, patch: Record<string, unknown>): Promise<void>;
  startRun(userId: string, trigger: string): Promise<string>;
  finishRun(runId: string, patch: Record<string, unknown>): Promise<void>;
  snapshotProfile(userId: string, igUserId: string, day: string, followers: number | null, follows: number | null, media: number | null): Promise<void>;
  upsertAccountInsights(rows: Array<Record<string, unknown>>): Promise<void>;
  getSupport(userId: string): Promise<SupportRow[]>;
  setSupport(userId: string, rows: SupportRow[]): Promise<void>;
  getMediaState(userId: string): Promise<MediaState[]>;
  upsertMedia(rows: Array<Record<string, unknown>>): Promise<void>;
  upsertMediaDaily(rows: Array<Record<string, unknown>>): Promise<void>;
  upsertAudience(rows: Array<Record<string, unknown>>): Promise<void>;
}

export interface SyncOptions {
  fetchImpl: FetchLike;
  now?: () => number;
  /** Máximo de llamadas a insights de publicaciones por ejecución. */
  mediaBudget?: number;
  /** Presupuesto en la primera sincronización (histórico). */
  backfillMediaBudget?: number;
  backfillDays?: number;
}

export interface SyncResult {
  status: 'success' | 'partial' | 'error' | 'skipped' | 'rate_limited';
  calls: number;
  message?: string;
  details: Record<string, unknown>;
}

const DAY_MS = 86_400_000;
const RECHECK_UNAVAILABLE_MS = 7 * DAY_MS;

class SupportTracker {
  private map = new Map<string, SupportRow>();
  changed = new Map<string, SupportRow>();
  constructor(rows: SupportRow[], private nowIso: string, private nowMs: number) {
    for (const r of rows) this.map.set(`${r.scope}|${r.metric}`, r);
  }
  usable(scope: string, metrics: string[]): string[] {
    return metrics.filter((m) => {
      const r = this.map.get(`${scope}|${m}`);
      if (!r || r.status !== 'unavailable') return true;
      return this.nowMs - Date.parse(r.checked_at) > RECHECK_UNAVAILABLE_MS;
    });
  }
  set(scope: string, metric: string, status: SupportStatus, error?: string) {
    const key = `${scope}|${metric}`;
    const prev = this.map.get(key);
    // «empty» no degrada una métrica que ya devolvió datos (p. ej. un día sin actividad).
    if (status === 'empty' && prev?.status === 'available') return;
    if (prev && prev.status === status && status !== 'unavailable') return;
    const row: SupportRow = { scope, metric, status, error: error ?? null, checked_at: this.nowIso };
    this.map.set(key, row);
    this.changed.set(key, row);
  }
  unavailable(): string[] {
    return [...this.map.values()].filter((r) => r.status === 'unavailable').map((r) => `${r.scope}:${r.metric}`);
  }
}

/**
 * Pide varias métricas en una sola llamada; si Meta rechaza alguna, las prueba una por una
 * y recuerda cuáles no están disponibles para no gastar llamadas cada hora.
 */
export async function fetchResilient(
  scope: string,
  metrics: string[],
  support: SupportTracker,
  call: (metrics: string[]) => Promise<{ data?: InsightItem[] }>,
): Promise<Map<string, InsightItem>> {
  const result = new Map<string, InsightItem>();
  const wanted = support.usable(scope, metrics);
  if (!wanted.length) return result;
  const absorb = (items: InsightItem[] | undefined, asked: string[]) => {
    for (const item of items ?? []) result.set(item.name, item);
    for (const m of asked) {
      const item = result.get(m);
      const v = item ? insightValue(item) : undefined;
      support.set(scope, m, item && (v !== undefined || item.total_value?.breakdowns?.length) ? 'available' : 'empty');
    }
  };
  try {
    absorb((await call(wanted)).data, wanted);
    return result;
  } catch (e) {
    if (!(e instanceof IgError) || e.kind !== 'metric') throw e;
    if (wanted.length === 1) { support.set(scope, wanted[0], 'unavailable', e.message); return result; }
  }
  for (const m of wanted) {
    try {
      absorb((await call([m])).data, [m]);
    } catch (e) {
      if (e instanceof IgError && e.kind === 'metric') support.set(scope, m, 'unavailable', e.message);
      else throw e;
    }
  }
  return result;
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function mediaRow(userId: string, igUserId: string, m: IgMediaItem, isStory: boolean): Record<string, unknown> {
  return {
    user_id: userId,
    ig_user_id: igUserId,
    ig_media_id: m.id,
    caption: m.caption ?? null,
    media_type: m.media_type ?? null,
    media_product_type: isStory ? 'STORY' : (m.media_product_type ?? null),
    permalink: m.permalink ?? null,
    media_url: m.media_url ?? null,
    thumbnail_url: m.thumbnail_url ?? null,
    posted_at: m.timestamp ?? null,
    like_count: m.like_count ?? null,
    comments_count: m.comments_count ?? null,
    is_story: isStory,
  };
}

/** Decide qué publicaciones necesitan métricas nuevas en esta ejecución. */
export function selectMediaForInsights(state: MediaState[], nowMs: number, budget: number): MediaState[] {
  const scored: Array<{ m: MediaState; prio: number }> = [];
  for (const m of state) {
    const posted = m.posted_at ? Date.parse(m.posted_at) : 0;
    const age = nowMs - posted;
    const since = m.insights_fetched_at ? nowMs - Date.parse(m.insights_fetched_at) : Infinity;
    if (m.is_story) {
      if (age < DAY_MS + 3_600_000 && since > 45 * 60_000) scored.push({ m, prio: 0 });
      continue;
    }
    if (age > 730 * DAY_MS) continue; // Meta conserva métricas de publicaciones hasta 2 años
    let due: number;
    if (age < 3 * DAY_MS) due = 45 * 60_000;
    else if (age < 14 * DAY_MS) due = 5 * 3_600_000;
    else if (age < 60 * DAY_MS) due = 23 * 3_600_000;
    else due = 6 * DAY_MS;
    if (since >= due) scored.push({ m, prio: since === Infinity ? 1 : 2 + age / DAY_MS });
  }
  scored.sort((a, b) => a.prio - b.prio);
  return scored.slice(0, budget).map((s) => s.m);
}

export async function runSync(store: SyncStore, userId: string, trigger: string, opts: SyncOptions): Promise<SyncResult> {
  const now = opts.now ?? Date.now;
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();

  const account = await store.getAccount(userId);
  if (trigger === 'cron' && account?.next_sync_after && Date.parse(account.next_sync_after) > nowMs) {
    return { status: 'skipped', calls: 0, message: 'En pausa por límite de la API', details: {} };
  }
  if (!(await store.lock(userId))) {
    return { status: 'skipped', calls: 0, message: 'Ya hay una sincronización en curso', details: {} };
  }

  const runId = await store.startRun(userId, trigger);
  const details: Record<string, unknown> = {};
  const errors: string[] = [];
  let client: InstagramClient | null = null;

  try {
    const token = await store.getToken(userId);
    if (!token) {
      await store.updateAccount(userId, { status: 'disconnected', last_sync_at: nowIso });
      await store.finishRun(runId, { status: 'error', error: 'Instagram no está conectado', finished_at: new Date(now()).toISOString() });
      return { status: 'error', calls: 0, message: 'Instagram no está conectado', details };
    }
    const tz = await store.timezone(userId);
    client = new InstagramClient(opts.fetchImpl, token.accessToken);

    // 1) Renovación del token largo (≥24 h de antigüedad; semanal o si vence en < 20 días).
    const tokenAge = nowMs - token.refreshedAt.getTime();
    const expiresSoon = token.expiresAt ? token.expiresAt.getTime() - nowMs < 20 * DAY_MS : true;
    if (token.expiresAt && token.expiresAt.getTime() <= nowMs) {
      throw new IgError('El token de Instagram venció. Vuelve a conectar tu cuenta.', 'token');
    }
    if (tokenAge > DAY_MS && (tokenAge > 7 * DAY_MS || expiresSoon)) {
      try {
        const r = await refreshLongLived(opts.fetchImpl, token.accessToken);
        client.calls++;
        const expiresAt = new Date(now() + r.expiresIn * 1000);
        await store.saveToken(userId, token.igUserId, r.accessToken, expiresAt, false);
        client.setToken(r.accessToken);
        await store.updateAccount(userId, { token_expires_at: expiresAt.toISOString(), token_refreshed_at: nowIso });
        details.token_refreshed = true;
      } catch (e) {
        if (e instanceof IgError && e.kind === 'token') throw e;
        errors.push(`Renovación de token: ${(e as Error).message}`);
      }
    }

    // 2) Perfil y seguidores (instantánea diaria única).
    const profile = await client.getProfile();
    const igUserId = String(profile.user_id || profile.id || token.igUserId);
    const today = localDay(nowMs, tz);
    await store.updateAccount(userId, {
      ig_user_id: igUserId,
      username: profile.username ?? null,
      name: profile.name ?? null,
      biography: profile.biography ?? null,
      website: profile.website ?? null,
      profile_picture_url: profile.profile_picture_url ?? null,
      account_type: profile.account_type ?? null,
      followers_count: profile.followers_count ?? null,
      follows_count: profile.follows_count ?? null,
      media_count: profile.media_count ?? null,
    });
    await store.snapshotProfile(userId, igUserId, today, profile.followers_count ?? null, profile.follows_count ?? null, profile.media_count ?? null);
    details.followers = profile.followers_count ?? null;

    const support = new SupportTracker(await store.getSupport(userId), nowIso, nowMs);

    // 3) Métricas diarias de la cuenta. Primera vez: 30 días; después: hoy y 2 días previos (Meta ajusta hasta 48 h).
    const isBackfill = !account?.backfilled_at;
    const days = Array.from({ length: isBackfill ? (opts.backfillDays ?? 30) : 3 }, (_, i) => addDays(today, -i));
    const insightRows: Array<Record<string, unknown>> = [];
    for (const day of days) {
      const { since, until } = dayBoundsUnix(day, tz, nowMs);
      if (until <= since) continue;
      const items = await fetchResilient('account', ACCOUNT_DAY_METRICS, support, (metrics) =>
        client!.accountInsights(igUserId, metrics, { period: 'day', metric_type: 'total_value', since, until }));
      for (const [metric, item] of items) {
        const value = numberOrNull(insightValue(item));
        if (value === null) continue;
        insightRows.push({ user_id: userId, ig_user_id: igUserId, day, metric, value, breakdown: insightBreakdown(item), fetched_at: nowIso });
      }
    }

    // 3b) Una vez al día: desgloses del día anterior, demografía y actividad de seguidores.
    const audienceDue = account?.audience_synced_on !== today;
    const audienceRows: Array<Record<string, unknown>> = [];
    if (audienceDue) {
      const yesterday = addDays(today, -1);
      const { since, until } = dayBoundsUnix(yesterday, tz, nowMs);
      const breakdownPlans: Array<{ metric: string; breakdown: string }> = [
        { metric: 'follows_and_unfollows', breakdown: 'follow_type' },
        { metric: 'reach', breakdown: 'follow_type' },
        { metric: 'views', breakdown: 'media_product_type' },
        { metric: 'total_interactions', breakdown: 'media_product_type' },
      ];
      for (const plan of breakdownPlans) {
        const scope = `account_breakdown:${plan.breakdown}`;
        const items = await fetchResilient(scope, [plan.metric], support, (metrics) =>
          client!.accountInsights(igUserId, metrics, { period: 'day', metric_type: 'total_value', breakdown: plan.breakdown, since, until }));
        const item = items.get(plan.metric);
        const b = item ? insightBreakdown(item) : null;
        if (item && b) {
          insightRows.push({
            user_id: userId, ig_user_id: igUserId, day: yesterday, metric: `${plan.metric}__${plan.breakdown}`,
            value: numberOrNull(insightValue(item)), breakdown: b, fetched_at: nowIso,
          });
        }
      }
      for (const metric of ['follower_demographics', 'engaged_audience_demographics']) {
        for (const breakdown of ['country', 'city', 'age', 'gender']) {
          const scope = `audience:${breakdown}`;
          const tryTimeframes = metric === 'engaged_audience_demographics' ? ['this_month'] : ['this_month', ''];
          for (const timeframe of tryTimeframes) {
            try {
              const items = await fetchResilient(`${scope}${timeframe ? '' : ':notimeframe'}`, [metric], support, (metrics) =>
                client!.accountInsights(igUserId, metrics, { period: 'lifetime', metric_type: 'total_value', breakdown, timeframe: timeframe || undefined }));
              const item = items.get(metric);
              const b = item ? insightBreakdown(item) : null;
              if (b) {
                audienceRows.push({ user_id: userId, ig_user_id: igUserId, day: today, metric, breakdown, timeframe, data: b, fetched_at: nowIso });
                break;
              }
            } catch (e) {
              if (e instanceof IgError && (e.kind === 'token' || e.kind === 'rate_limit')) throw e;
              errors.push(`${metric}/${breakdown}: ${(e as Error).message}`);
              break;
            }
          }
        }
      }
      try {
        const items = await fetchResilient('audience:online', ['online_followers'], support, (metrics) =>
          client!.accountInsights(igUserId, metrics, { period: 'lifetime' }));
        const item = items.get('online_followers');
        if (item?.values?.length) {
          const byHour: Record<string, number> = {};
          let n = 0;
          for (const v of item.values) {
            if (!v.value || typeof v.value !== 'object') continue;
            n++;
            for (const [h, c] of Object.entries(v.value as Record<string, number>)) byHour[h] = (byHour[h] ?? 0) + Number(c || 0);
          }
          if (n) {
            for (const h of Object.keys(byHour)) byHour[h] = Math.round(byHour[h] / n);
            audienceRows.push({ user_id: userId, ig_user_id: igUserId, day: today, metric: 'online_followers', breakdown: 'hour', timeframe: '', data: { average_by_hour: byHour, days: n, raw: item.values }, fetched_at: nowIso });
          }
        }
      } catch (e) {
        if (e instanceof IgError && (e.kind === 'token' || e.kind === 'rate_limit')) throw e;
        errors.push(`online_followers: ${(e as Error).message}`);
      }
    }
    if (insightRows.length) await store.upsertAccountInsights(insightRows);
    if (audienceRows.length) await store.upsertAudience(audienceRows);
    details.account_metric_rows = insightRows.length;
    details.audience_rows = audienceRows.length;

    // 4) Publicaciones, reels y stories.
    const listed = await client.listMedia(isBackfill ? 10 : 1);
    let stories: IgMediaItem[] = [];
    try { stories = await client.listStories(); } catch (e) {
      if (e instanceof IgError && (e.kind === 'token' || e.kind === 'rate_limit')) throw e;
      errors.push(`Stories: ${(e as Error).message}`);
    }
    const mediaRows = [...listed.map((m) => mediaRow(userId, igUserId, m, false)), ...stories.map((m) => mediaRow(userId, igUserId, m, true))];
    if (mediaRows.length) await store.upsertMedia(mediaRows);
    details.media_listed = listed.length;
    details.stories_listed = stories.length;

    // 5) Métricas por publicación, con prioridad para lo reciente.
    const state = await store.getMediaState(userId);
    const budget = isBackfill ? (opts.backfillMediaBudget ?? 100) : (opts.mediaBudget ?? 60);
    const due = selectMediaForInsights(state, nowMs, budget);
    const mediaUpdates: Array<Record<string, unknown>> = [];
    const dailyRows: Array<Record<string, unknown>> = [];
    const likeMap = new Map(mediaRows.map((r) => [r.ig_media_id as string, r]));
    for (const m of due) {
      if (client.usage.maxPercent >= 90) { errors.push('Uso de la API ≥ 90 %: se pospone el resto de publicaciones.'); break; }
      const scope = mediaScope(m);
      try {
        const items = await fetchResilient(`media:${scope}`, MEDIA_METRICS[scope], support, (metrics) => client!.mediaInsights(m.ig_media_id, metrics));
        const metrics: Record<string, unknown> = {};
        for (const [name, item] of items) {
          const v = insightValue(item);
          const b = insightBreakdown(item);
          metrics[name] = b ? { total: numberOrNull(v), breakdown: b } : (numberOrNull(v) ?? v ?? null);
        }
        const unavailable = MEDIA_METRICS[scope].filter((x) => !(x in metrics));
        mediaUpdates.push({ user_id: userId, ig_user_id: igUserId, ig_media_id: m.ig_media_id, insights: metrics, insights_fetched_at: nowIso, unavailable_metrics: unavailable, insights_note: null });
        const basic = likeMap.get(m.ig_media_id);
        dailyRows.push({ user_id: userId, ig_media_id: m.ig_media_id, day: today, metrics, like_count: basic?.like_count ?? null, comments_count: basic?.comments_count ?? null, fetched_at: nowIso });
      } catch (e) {
        if (e instanceof IgError && (e.kind === 'token' || e.kind === 'rate_limit')) throw e;
        const note = (e as Error).message;
        mediaUpdates.push({ user_id: userId, ig_user_id: igUserId, ig_media_id: m.ig_media_id, insights_fetched_at: nowIso, insights_note: note });
        if (errors.length < 25) errors.push(`Publicación ${m.ig_media_id}: ${note}`);
      }
    }
    if (mediaUpdates.length) await store.upsertMedia(mediaUpdates);
    if (dailyRows.length) await store.upsertMediaDaily(dailyRows);
    details.media_insights_updated = dailyRows.length;

    if (support.changed.size) await store.setSupport(userId, [...support.changed.values()]);
    details.unavailable_metrics = support.unavailable();
    details.api_usage_percent = client.usage.maxPercent;
    if (errors.length) details.errors = errors;

    const status: SyncResult['status'] = errors.length ? 'partial' : 'success';
    const finished = new Date(now()).toISOString();
    await store.updateAccount(userId, {
      status: 'connected', last_sync_at: finished, last_success_at: finished, last_error: errors.length ? errors[0] : null,
      last_error_at: errors.length ? finished : null, next_sync_after: null,
      ...(isBackfill ? { backfilled_at: finished } : {}),
      ...(audienceDue ? { audience_synced_on: today } : {}),
    });
    await store.finishRun(runId, { status, api_calls: client.calls, details, finished_at: finished, error: errors[0] ?? null });
    return { status, calls: client.calls, details };
  } catch (e) {
    const err = e as Error;
    const finished = new Date(now()).toISOString();
    const calls = client?.calls ?? 0;
    if (e instanceof IgError && e.kind === 'token') {
      await store.updateAccount(userId, { status: 'reconnect_required', last_sync_at: finished, last_error: err.message, last_error_at: finished });
      await store.finishRun(runId, { status: 'error', api_calls: calls, error: `Reconexión necesaria: ${err.message}`, details, finished_at: finished });
      return { status: 'error', calls, message: err.message, details };
    }
    if (e instanceof IgError && e.kind === 'rate_limit') {
      const pause = new Date(now() + 2 * 3_600_000).toISOString();
      await store.updateAccount(userId, { last_sync_at: finished, last_error: `Límite de la API de Meta: ${err.message}`, last_error_at: finished, next_sync_after: pause });
      await store.finishRun(runId, { status: 'rate_limited', api_calls: calls, error: err.message, details, finished_at: finished });
      return { status: 'rate_limited', calls, message: err.message, details };
    }
    await store.updateAccount(userId, { last_sync_at: finished, last_error: err.message, last_error_at: finished });
    await store.finishRun(runId, { status: 'error', api_calls: calls, error: err.message, details, finished_at: finished });
    return { status: 'error', calls, message: err.message, details };
  } finally {
    await store.unlock(userId);
  }
}
