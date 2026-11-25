// Racha de productividad: días consecutivos con al menos una acción productiva registrada.
import { addDays, dayOfInstant, today as todayFn } from './dates';

export interface StreakInput {
  tasksDone: Array<{ done_at?: string | null }>;
  workouts: Array<{ day: string }>;
  eventsDone: string[];
  ideasCreated: Array<{ created_at?: string }>;
  bodyLogs: Array<{ day: string }>;
  episodesPublished: Array<{ publish_date?: string | null }>;
}

export function productiveDays(i: StreakInput): Map<string, number> {
  const m = new Map<string, number>();
  const add = (d: string | null | undefined) => { if (d) m.set(d, (m.get(d) ?? 0) + 1); };
  i.tasksDone.forEach((t) => add(t.done_at ? dayOfInstant(t.done_at) : null));
  i.workouts.forEach((w) => add(w.day));
  i.eventsDone.forEach(add);
  i.ideasCreated.forEach((x) => add(x.created_at ? dayOfInstant(x.created_at) : null));
  i.bodyLogs.forEach((b) => add(b.day));
  i.episodesPublished.forEach((e) => add(e.publish_date));
  return m;
}

export function streaks(days: Map<string, number>, ref = todayFn()) {
  // La racha sigue viva si hoy aún no registras nada pero ayer sí.
  let current = 0;
  let cursor = days.has(ref) ? ref : addDays(ref, -1);
  while (days.has(cursor)) { current++; cursor = addDays(cursor, -1); }
  const sorted = [...days.keys()].sort();
  let best = 0, run = 0, prev: string | null = null;
  for (const d of sorted) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  const last28 = Array.from({ length: 28 }, (_, k) => { const d = addDays(ref, -(27 - k)); return { day: d, count: days.get(d) ?? 0 }; });
  return { current, best, last28, activeDays30: Array.from({ length: 30 }, (_, k) => addDays(ref, -k)).filter((d) => days.has(d)).length };
}
