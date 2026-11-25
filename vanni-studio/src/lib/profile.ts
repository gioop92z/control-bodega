import { useEffect, useRef } from 'react';
import { useTable } from './store';
import { SEED_SERIES, WIDGETS } from './constants';
import type { Profile } from './types';

export interface Settings {
  widgets?: Array<{ key: string; visible: boolean }>;
  gymWeights?: Record<string, number>;
  seeded_v1?: boolean;
  habitsOrder?: string[];
  mediaKit?: { headline?: string; pitch?: string; showRates?: boolean; contactEmail?: string; hidePosts?: string[] };
  monthlyContentBudget?: number;
}

export function useProfile() {
  const t = useTable('profiles');
  const profile = t.rows[0] as Profile | undefined;
  const settings = (profile?.settings ?? {}) as Settings;
  const updateSettings = (patch: Partial<Settings>) => { if (profile) t.update(profile.id, { settings: { ...settings, ...patch } }); };
  const update = (patch: Partial<Profile>) => { if (profile) t.update(profile.id, patch); };
  return { profile, settings, updateSettings, update, ready: t.ready, currency: profile?.currency ?? 'MXN', timezone: profile?.timezone ?? 'America/Mexico_City' };
}

export function widgetConfig(settings: Settings) {
  const saved = settings.widgets ?? [];
  const known = new Set(saved.map((w) => w.key));
  return [...saved.filter((w) => WIDGETS.some((x) => x.key === w.key)), ...WIDGETS.filter((w) => !known.has(w.key)).map((w) => ({ key: w.key, visible: true }))];
}

/** Siembra única de las series iniciales (editables) y creación del perfil si faltara. */
export function useFirstRunSeed() {
  const profiles = useTable('profiles');
  const series = useTable('series');
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !profiles.ready || !series.ready) return;
    let profile = profiles.rows[0];
    if (!profile) profile = profiles.insert({ display_name: 'VANNI', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Mexico_City', currency: 'MXN', settings: {} } as Partial<Profile>) as Profile;
    if (profile.settings?.seeded_v1) { done.current = true; return; }
    if (!series.rows.length) SEED_SERIES.forEach((s, i) => series.insert({ title: s.title, tagline: s.tagline, color: s.color, status: 'activa', sort: i }));
    profiles.update(profile.id, { settings: { ...(profile.settings ?? {}), seeded_v1: true } });
    done.current = true;
  }, [profiles.ready, series.ready, profiles.rows.length, series.rows.length]);
}
