import type { Goal } from './types';

export interface GoalContext { followers: number | null; workoutsThisMonth: number; episodesPublished: number; latestWeight: number | null; gymsVisited: number; incomeThisMonth: number }

/** Avance de un objetivo: automático si su métrica está ligada a datos reales, manual en otro caso. */
export function goalProgress(g: Goal, ctx: GoalContext): { current: number | null; target: number | null; pct: number | null; auto: boolean } {
  const autoValues: Record<string, number | null> = {
    followers: ctx.followers, workouts_month: ctx.workoutsThisMonth, episodes_published: ctx.episodesPublished,
    weight: ctx.latestWeight, gyms_visited: ctx.gymsVisited, income_month: ctx.incomeThisMonth,
  };
  const auto = g.metric in autoValues;
  const current = auto ? autoValues[g.metric] : (g.current_value ?? null);
  const target = g.target_value ?? null;
  if (current === null || target === null) return { current, target, pct: null, auto };
  const start = g.start_value ?? (g.metric === 'weight' ? null : 0);
  let pct: number;
  if (start !== null && start !== target) pct = (current - start) / (target - start);
  else pct = target ? current / target : 0;
  return { current, target, pct: Math.max(0, Math.min(1, pct)), auto };
}
