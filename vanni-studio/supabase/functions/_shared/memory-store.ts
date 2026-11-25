// Almacén en memoria para pruebas del motor de sincronización.
import type { AccountState, MediaState, SupportRow, SyncStore, TokenRecord } from './sync.ts';

type Row = Record<string, any>;

export class MemoryStore implements SyncStore {
  tz = 'America/Mexico_City';
  token: TokenRecord | null = null;
  locked = false;
  account: Row = { status: 'connected', backfilled_at: null, audience_synced_on: null, next_sync_after: null };
  runs = new Map<string, Row>();
  snapshots = new Map<string, Row>();
  insights = new Map<string, Row>();
  support = new Map<string, SupportRow>();
  media = new Map<string, Row>();
  mediaDaily = new Map<string, Row>();
  audience = new Map<string, Row>();
  savedTokens: Array<{ token: string; expiresAt: Date; fresh: boolean }> = [];

  async timezone() { return this.tz; }
  async getToken() { return this.token; }
  async saveToken(_u: string, igUserId: string, accessToken: string, expiresAt: Date, fresh: boolean) {
    this.savedTokens.push({ token: accessToken, expiresAt, fresh });
    this.token = { accessToken, igUserId, issuedAt: this.token?.issuedAt ?? new Date(), expiresAt, refreshedAt: new Date() };
  }
  async lock() { if (this.locked) return false; this.locked = true; return true; }
  async unlock() { this.locked = false; }
  async getAccount() { return this.account as AccountState; }
  async updateAccount(_u: string, patch: Row) { Object.assign(this.account, patch); }
  async startRun(_u: string, trigger: string) { const id = `run${this.runs.size + 1}`; this.runs.set(id, { trigger, status: 'running' }); return id; }
  async finishRun(id: string, patch: Row) { Object.assign(this.runs.get(id)!, patch); }
  async snapshotProfile(_u: string, ig: string, day: string, followers: number | null, follows: number | null, media: number | null) {
    const k = `${ig}|${day}`;
    const prev = this.snapshots.get(k);
    this.snapshots.set(k, { day, followers_open: prev?.followers_open ?? followers, followers_count: followers, follows_count: follows, media_count: media });
  }
  async upsertAccountInsights(rows: Row[]) { for (const r of rows) this.insights.set(`${r.ig_user_id}|${r.day}|${r.metric}`, { ...this.insights.get(`${r.ig_user_id}|${r.day}|${r.metric}`), ...r }); }
  async getSupport() { return [...this.support.values()]; }
  async setSupport(_u: string, rows: SupportRow[]) { for (const r of rows) this.support.set(`${r.scope}|${r.metric}`, r); }
  async getMediaState(): Promise<MediaState[]> {
    return [...this.media.values()].map((m) => ({ ig_media_id: m.ig_media_id, posted_at: m.posted_at ?? null, insights_fetched_at: m.insights_fetched_at ?? null, media_product_type: m.media_product_type ?? null, is_story: !!m.is_story }));
  }
  async upsertMedia(rows: Row[]) { for (const r of rows) this.media.set(r.ig_media_id, { ...this.media.get(r.ig_media_id), ...r }); }
  async upsertMediaDaily(rows: Row[]) { for (const r of rows) this.mediaDaily.set(`${r.ig_media_id}|${r.day}`, r); }
  async upsertAudience(rows: Row[]) { for (const r of rows) this.audience.set(`${r.day}|${r.metric}|${r.breakdown}|${r.timeframe}`, r); }
}
