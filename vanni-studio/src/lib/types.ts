// Tipos de las tablas de VANNI STUDIO (espejo del esquema SQL).
export interface Base { id: string; user_id?: string; created_at?: string; updated_at?: string }
export interface Tagged { tags?: string[]; custom?: Record<string, unknown> }

export interface Profile extends Base { display_name: string; handle?: string | null; bio?: string | null; contact_email?: string | null; timezone: string; currency: string; settings: Record<string, any> }
export interface IgAccount extends Base {
  ig_user_id: string | null; username: string | null; name: string | null; biography: string | null; website: string | null; profile_picture_url: string | null;
  account_type: string | null; followers_count: number | null; follows_count: number | null; media_count: number | null;
  status: 'connected' | 'reconnect_required' | 'disconnected' | 'error'; scopes: string[]; token_expires_at: string | null; token_refreshed_at: string | null;
  connected_at: string | null; last_sync_at: string | null; last_success_at: string | null; last_error: string | null; last_error_at: string | null;
  sync_started_at: string | null; next_sync_after: string | null; backfilled_at: string | null; audience_synced_on: string | null;
}
export interface ProfileSnapshot extends Base { ig_user_id: string; day: string; followers_open: number | null; followers_count: number | null; follows_count: number | null; media_count: number | null; captured_at: string }
export interface AccountInsight extends Base { ig_user_id: string; day: string; metric: string; value: number | null; breakdown: Record<string, number> | null; fetched_at: string }
export interface IgMedia extends Base {
  ig_user_id: string; ig_media_id: string; caption: string | null; media_type: string | null; media_product_type: string | null; permalink: string | null;
  media_url: string | null; thumbnail_url: string | null; posted_at: string | null; like_count: number | null; comments_count: number | null; is_story: boolean;
  insights: Record<string, any>; insights_fetched_at: string | null; unavailable_metrics: string[]; insights_note: string | null;
}
export interface Audience extends Base { ig_user_id: string; day: string; metric: string; breakdown: string; timeframe: string; data: any; fetched_at: string }
export interface SyncRun extends Base { trigger: string; status: string; started_at: string; finished_at: string | null; api_calls: number; error: string | null; details: Record<string, any> }
export interface MetricSupport extends Base { scope: string; metric: string; status: 'available' | 'empty' | 'unavailable'; error: string | null; checked_at: string }
export interface ManualMetric extends Base { day: string; metric: string; value: number; note?: string | null }

export interface Series extends Base, Tagged { title: string; tagline?: string | null; description?: string | null; color?: string | null; status: string; cover_path?: string | null; sort: number }
export interface Season extends Base, Tagged { series_id: string; number: number; title?: string | null; description?: string | null; status: string; start_date?: string | null; end_date?: string | null; budget?: number | null; cover_path?: string | null; sort: number }
export type EpisodeStatus = 'idea' | 'planeacion' | 'grabacion' | 'edicion' | 'programado' | 'publicado' | 'analizado';
export interface ListItem { id: string; text: string; done?: boolean; note?: string; image_path?: string | null }
export interface Episode extends Base, Tagged {
  series_id: string | null; season_id: string | null; number: number | null; title: string; synopsis?: string | null; hook?: string | null; script?: string | null;
  status: EpisodeStatus; location?: string | null; gym_id?: string | null; budget?: number | null; cost?: number | null; record_date?: string | null; record_time?: string | null;
  publish_date?: string | null; cover_path?: string | null; refs: Array<{ id: string; url: string; note?: string }>; collaborator_ids: string[];
  shotlist: ListItem[]; checklist: ListItem[]; notes?: string | null; sort: number;
}
export interface MediaLink extends Base { ig_media_id: string; series_id: string | null; episode_id: string | null }
export interface Attachment extends Base { entity_type: string; entity_id: string; kind: string; storage_path?: string | null; external_url?: string | null; mime?: string | null; size_bytes?: number | null; caption?: string | null; taken_on?: string | null; sort: number }
export interface Contact extends Base, Tagged { name: string; kind: string; company?: string | null; role?: string | null; instagram?: string | null; email?: string | null; phone?: string | null; website?: string | null; city?: string | null; notes?: string | null }
export interface Gym extends Base, Tagged {
  name: string; address?: string | null; city?: string | null; lat?: number | null; lng?: number | null; maps_url?: string | null; price_visit?: number | null; price_month?: number | null;
  currency: string; status: string; visit_date?: string | null; experience?: string | null; machines?: string | null; ratings: Record<string, number>; cover_path?: string | null;
}
export interface Idea extends Base, Tagged { kind: string; title: string; body?: string | null; items: ListItem[]; status: string; priority: number; series_id?: string | null; source_url?: string | null; music?: string | null; converted: Array<{ type: string; id: string; at: string }>; pinned: boolean }
export interface Recurrence { freq: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval?: number; byweekday?: number[]; until?: string | null; count?: number | null }
export interface CalEvent extends Base, Tagged {
  title: string; category: string; start_at: string; end_at?: string | null; all_day: boolean; location?: string | null; notes?: string | null; priority: number; status: string;
  color?: string | null; recurrence?: Recurrence | null; exdates: string[]; done_dates: string[]; linked_type?: string | null; linked_id?: string | null;
}
export interface Task extends Base, Tagged { title: string; notes?: string | null; done: boolean; done_at?: string | null; due_date?: string | null; priority: number; list_name: string; linked_type?: string | null; linked_id?: string | null; sort: number }
export interface BodyLog extends Base, Tagged { day: string; weight?: number | null; body_fat?: number | null; measurements: Record<string, number>; sleep_hours?: number | null; sleep_quality?: number | null; energy?: number | null; mood?: number | null; habits: Record<string, boolean>; reflection?: string | null; achievements?: string | null }
export interface Routine extends Base, Tagged { name: string; description?: string | null; exercises: Array<{ id: string; name: string; sets?: number; reps?: string; note?: string }> }
export interface Workout extends Base, Tagged { day: string; title: string; routine_id?: string | null; duration_min?: number | null; rpe?: number | null; notes?: string | null; gym_id?: string | null }
export interface WorkoutSet extends Base { workout_id: string; exercise: string; set_index: number; reps?: number | null; weight?: number | null; unit: string; rpe?: number | null; notes?: string | null }
export interface Habit extends Base { name: string; description?: string | null; target_per_week: number; active: boolean; color?: string | null; sort: number }
export interface Goal extends Base, Tagged { title: string; description?: string | null; area: string; metric: string; start_value?: number | null; target_value?: number | null; current_value?: number | null; unit?: string | null; due_date?: string | null; month?: string | null; status: string; priority: number; carried_from?: string | null; completed_at?: string | null; sort: number }
export interface Month extends Base, Tagged { month: string; title?: string | null; status: 'abierto' | 'cerrado'; objectives?: string | null; achievements?: string | null; difficulties?: string | null; learnings?: string | null; improvements?: string | null; next_strategy?: string | null; content_budget?: number | null; report?: any; closed_at?: string | null; addenda: Array<{ id: string; at: string; text: string }> }
export type DealStatus = 'por_contactar' | 'contactado' | 'negociacion' | 'confirmado' | 'completado';
export interface Deal extends Base, Tagged { contact_id?: string | null; title: string; kind: string; status: DealStatus; amount?: number | null; currency: string; deliverables?: string | null; start_date?: string | null; due_date?: string | null; next_action?: string | null; next_action_date?: string | null; notes?: string | null; archived: boolean; sort: number }
export interface Interaction extends Base { contact_id?: string | null; deal_id?: string | null; happened_at: string; channel: string; direction: string; summary: string }
export interface Rate extends Base { name: string; description?: string | null; price?: number | null; currency: string; active: boolean; sort: number }
export interface Transaction extends Base, Tagged { day: string; kind: 'ingreso' | 'gasto'; amount: number; currency: string; category: string; description?: string | null; deal_id?: string | null; series_id?: string | null; episode_id?: string | null; gym_id?: string | null }
export interface Category extends Base { scope: string; name: string; color?: string | null; icon?: string | null; sort: number }
export type CustomFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'url' | 'rating';
export interface CustomField extends Base { entity: string; key: string; label: string; type: CustomFieldType; options: string[]; sort: number }
export interface CollectionField { key: string; label: string; type: CustomFieldType; options?: string[] }
export interface Collection extends Base { name: string; kind: 'list' | 'tracker' | 'board'; description?: string | null; icon?: string | null; color?: string | null; fields: CollectionField[]; columns: Array<{ key: string; label: string }>; sort: number; tags?: string[] }
export interface CollectionItem extends Base { collection_id: string; title: string; data: Record<string, unknown>; column_key?: string | null; day?: string | null; done: boolean; sort: number; tags?: string[] }
export interface Template extends Base { target: string; name: string; data: Record<string, unknown>; sort: number }
export interface Note extends Base, Tagged { title: string; body?: string | null; folder?: string | null; pinned: boolean }
export interface BackupRun extends Base { trigger: string; status: string; storage_path: string | null; size_bytes: number | null; tables: Record<string, number>; error: string | null }

export interface TableMap {
  profiles: Profile; ig_accounts: IgAccount; ig_profile_snapshots: ProfileSnapshot; ig_account_insights: AccountInsight; ig_media: IgMedia;
  ig_audience: Audience; ig_sync_runs: SyncRun; ig_metric_support: MetricSupport; manual_metrics: ManualMetric; backup_runs: BackupRun;
  series: Series; seasons: Season; episodes: Episode; media_links: MediaLink; attachments: Attachment; contacts: Contact; gyms: Gym; ideas: Idea;
  events: CalEvent; tasks: Task; body_logs: BodyLog; routines: Routine; workouts: Workout; workout_sets: WorkoutSet; habits: Habit; goals: Goal;
  months: Month; deals: Deal; interactions: Interaction; rates: Rate; transactions: Transaction; categories: Category; custom_fields: CustomField;
  collections: Collection; collection_items: CollectionItem; templates: Template; notes: Note;
}
export type TableName = keyof TableMap;
export const READ_ONLY_TABLES: TableName[] = ['ig_accounts', 'ig_profile_snapshots', 'ig_account_insights', 'ig_media', 'ig_audience', 'ig_sync_runs', 'ig_metric_support', 'backup_runs'];
