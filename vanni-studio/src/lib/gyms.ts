import { GYM_CRITERIA } from './constants';
import type { Gym } from './types';

export type Weights = Record<string, number>;
export const DEFAULT_WEIGHTS: Weights = Object.fromEntries(GYM_CRITERIA.map((c) => [c.key, 1]));

/** Promedio ponderado (0–10) de los criterios calificados; null si no hay calificaciones. */
export function gymScore(ratings: Record<string, number> | null | undefined, weights: Weights = DEFAULT_WEIGHTS): number | null {
  let sum = 0, w = 0;
  for (const c of GYM_CRITERIA) {
    const v = Number(ratings?.[c.key]);
    const wt = weights[c.key] ?? 1;
    if (!Number.isFinite(v) || v < 1 || v > 10 || wt <= 0) continue;
    sum += v * wt;
    w += wt;
  }
  return w ? Math.round((sum / w) * 10) / 10 : null;
}

export function rankGyms(gyms: Gym[], weights: Weights = DEFAULT_WEIGHTS) {
  return gyms
    .map((g) => ({ gym: g, score: gymScore(g.ratings, weights), rated: GYM_CRITERIA.filter((c) => Number(g.ratings?.[c.key]) >= 1).length }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.gym.visit_date ?? '').localeCompare(a.gym.visit_date ?? '') || a.gym.name.localeCompare(b.gym.name))
    .map((r, i) => ({ ...r, rank: r.score === null ? null : i + 1 }));
}

/** Extrae coordenadas de enlaces largos de Google Maps. Los enlaces cortos (maps.app.goo.gl) no las contienen. */
export function parseMapsUrl(url: string | null | undefined): { lat: number; lng: number } | null {
  if (!url) return null;
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|destination|center)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}
