// Implementación del almacén de sincronización sobre Supabase (rol de servicio).
import type { Admin } from './server.ts';
import { rpc, tokenKey } from './server.ts';
import { open, seal } from './crypto.ts';
import type { AccountState, MediaState, SupportRow, SyncStore, TokenRecord } from './sync.ts';

type Row = Record<string, unknown>;

/** Agrupa filas por conjunto de columnas para que un upsert parcial no borre columnas ausentes. */
function byShape(rows: Row[]): Row[][] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = Object.keys(r).sort().join(',');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  return [...groups.values()];
}

async function upsert(sb: Admin, table: string, rows: Row[], onConflict: string) {
  for (const group of byShape(rows)) {
    for (let i = 0; i < group.length; i += 500) {
      const { error } = await sb.from(table).upsert(group.slice(i, i + 500), { onConflict, defaultToNull: false });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  }
}

export class SupabaseSyncStore implements SyncStore {
  constructor(private sb: Admin) {}

  async timezone(userId: string) {
    const { data } = await this.sb.from('profiles').select('timezone').eq('user_id', userId).maybeSingle();
    return (data?.timezone as string) || 'America/Mexico_City';
  }

  async getToken(userId: string): Promise<TokenRecord | null> {
    const rows = await rpc<Array<{ ig_user_id: string; ciphertext: string; iv: string; issued_at: string; expires_at: string | null; refreshed_at: string }>>(this.sb, 'svc_token_get', { p_user: userId });
    const t = rows?.[0];
    if (!t) return null;
    const accessToken = await open({ ciphertext: t.ciphertext, iv: t.iv }, await tokenKey(this.sb));
    return { accessToken, igUserId: t.ig_user_id, issuedAt: new Date(t.issued_at), expiresAt: t.expires_at ? new Date(t.expires_at) : null, refreshedAt: new Date(t.refreshed_at) };
  }

  async saveToken(userId: string, igUserId: string, accessToken: string, expiresAt: Date, freshIssue: boolean) {
    const sealed = await seal(accessToken, await tokenKey(this.sb));
    await rpc(this.sb, 'svc_token_save', { p_user: userId, p_ig_user: igUserId, p_cipher: sealed.ciphertext, p_iv: sealed.iv, p_expires: expiresAt.toISOString(), p_fresh_issue: freshIssue });
  }

  async lock(userId: string) { return await rpc<boolean>(this.sb, 'svc_sync_lock', { p_user: userId, p_stale_minutes: 10 }); }
  async unlock(userId: string) { await rpc(this.sb, 'svc_sync_unlock', { p_user: userId }); }

  async getAccount(userId: string): Promise<AccountState | null> {
    const { data, error } = await this.sb.from('ig_accounts').select('status, backfilled_at, audience_synced_on, next_sync_after').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data as AccountState | null;
  }

  async updateAccount(userId: string, patch: Row) {
    const { error } = await this.sb.from('ig_accounts').update(patch).eq('user_id', userId);
    if (error) throw new Error(`ig_accounts: ${error.message}`);
  }

  async startRun(userId: string, trigger: string) {
    const { data, error } = await this.sb.from('ig_sync_runs').insert({ user_id: userId, trigger, status: 'running' }).select('id').single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  async finishRun(runId: string, patch: Row) {
    await this.sb.from('ig_sync_runs').update(patch).eq('id', runId);
  }

  async snapshotProfile(userId: string, igUserId: string, day: string, followers: number | null, follows: number | null, media: number | null) {
    await rpc(this.sb, 'svc_profile_snapshot', { p_user: userId, p_ig_user: igUserId, p_day: day, p_followers: followers, p_follows: follows, p_media: media });
  }

  async upsertAccountInsights(rows: Row[]) { await upsert(this.sb, 'ig_account_insights', rows, 'user_id,ig_user_id,day,metric'); }

  async getSupport(userId: string): Promise<SupportRow[]> {
    const { data, error } = await this.sb.from('ig_metric_support').select('scope, metric, status, error, checked_at').eq('user_id', userId);
    if (error) throw new Error(error.message);
    return (data ?? []) as SupportRow[];
  }

  async setSupport(userId: string, rows: SupportRow[]) {
    await upsert(this.sb, 'ig_metric_support', rows.map((r) => ({ ...r, user_id: userId })), 'user_id,scope,metric');
  }

  async getMediaState(userId: string): Promise<MediaState[]> {
    const out: MediaState[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.sb.from('ig_media').select('ig_media_id, posted_at, insights_fetched_at, media_product_type, is_story').eq('user_id', userId).order('posted_at', { ascending: false }).range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as MediaState[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  async upsertMedia(rows: Row[]) { await upsert(this.sb, 'ig_media', rows, 'user_id,ig_media_id'); }
  async upsertMediaDaily(rows: Row[]) { await upsert(this.sb, 'ig_media_insights_daily', rows, 'user_id,ig_media_id,day'); }
  async upsertAudience(rows: Row[]) { await upsert(this.sb, 'ig_audience', rows, 'user_id,ig_user_id,day,metric,breakdown,timeframe'); }
}
