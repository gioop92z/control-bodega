// Expansión de eventos recurrentes (diaria, semanal, mensual, anual) en un rango de días locales.
import type { CalEvent } from './types';
import { addDays, dayOfInstant, parseDay, toDay, weekday, weekStart } from './dates';

export interface Occurrence { event: CalEvent; day: string; start: string; end: string | null; key: string; done: boolean; recurring: boolean }

function shiftInstant(iso: string, toDayStr: string): string {
  const d = new Date(iso);
  const to = parseDay(toDayStr);
  const out = new Date(d);
  out.setFullYear(to.getFullYear(), to.getMonth(), to.getDate());
  // Conserva la hora local aunque cambie el horario de verano.
  out.setHours(d.getHours(), d.getMinutes(), 0, 0);
  return out.toISOString();
}

function occurrence(ev: CalEvent, day: string): Occurrence {
  const recurring = !!ev.recurrence;
  const start = recurring ? shiftInstant(ev.start_at, day) : ev.start_at;
  let end: string | null = null;
  if (ev.end_at) {
    const dur = new Date(ev.end_at).getTime() - new Date(ev.start_at).getTime();
    end = new Date(new Date(start).getTime() + Math.max(0, dur)).toISOString();
  }
  const done = recurring ? (ev.done_dates ?? []).includes(day) : ev.status === 'hecho';
  return { event: ev, day, start, end, key: `${ev.id}|${day}`, done, recurring };
}

export function recurrenceDays(ev: CalEvent, from: string, to: string): string[] {
  const base = dayOfInstant(ev.start_at);
  const r = ev.recurrence;
  if (!r) return base >= from && base <= to ? [base] : [];
  const interval = Math.max(1, Math.floor(r.interval ?? 1));
  const until = r.until && r.until < to ? r.until : to;
  const limit = r.count && r.count > 0 ? r.count : Infinity;
  const ex = new Set(ev.exdates ?? []);
  const out: string[] = [];
  let produced = 0;
  const push = (d: string) => {
    if (d < base) return true;
    if (d > until || produced >= limit) return false;
    produced++;
    if (d >= from && !ex.has(d)) out.push(d);
    return true;
  };
  if (r.freq === 'daily') {
    for (let d = base; d <= until && produced < limit; d = addDays(d, interval)) push(d);
  } else if (r.freq === 'weekly') {
    const days = (r.byweekday && r.byweekday.length ? [...r.byweekday] : [weekday(base)]).sort((a, b) => a - b);
    outer: for (let w = weekStart(base); w <= until; w = addDays(w, 7 * interval)) {
      for (const wd of days) { if (!push(addDays(w, wd))) break outer; }
    }
  } else if (r.freq === 'monthly') {
    const b = parseDay(base);
    for (let i = 0; ; i += interval) {
      const t = new Date(b.getFullYear(), b.getMonth() + i, 1);
      const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
      if (toDay(t) > until) break;
      if (b.getDate() > last) continue;
      t.setDate(b.getDate());
      if (!push(toDay(t))) break;
    }
  } else if (r.freq === 'yearly') {
    const b = parseDay(base);
    for (let i = 0; ; i += interval) {
      const t = new Date(b.getFullYear() + i, b.getMonth(), b.getDate());
      if (t.getMonth() !== b.getMonth()) continue; // 29 de febrero
      const d = toDay(t);
      if (d > until) break;
      if (!push(d)) break;
    }
  }
  return out;
}

export function expandEvents(events: CalEvent[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ev of events) {
    if (!ev.start_at) continue;
    for (const d of recurrenceDays(ev, from, to)) out.push(occurrence(ev, d));
  }
  return out.sort((a, b) => (a.event.all_day === b.event.all_day ? a.start.localeCompare(b.start) : a.event.all_day ? -1 : 1));
}

export function describeRecurrence(r: CalEvent['recurrence']): string {
  if (!r) return 'No se repite';
  const every = (r.interval ?? 1) > 1 ? `cada ${r.interval} ` : '';
  const names = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  const base = r.freq === 'daily' ? (every ? `${every}días` : 'Diario')
    : r.freq === 'weekly' ? `${every ? every + 'semanas' : 'Semanal'}${r.byweekday?.length ? ` (${r.byweekday.map((d) => names[d]).join(', ')})` : ''}`
    : r.freq === 'monthly' ? (every ? `${every}meses` : 'Mensual') : (every ? `${every}años` : 'Anual');
  return `${base}${r.until ? ` hasta ${r.until}` : ''}${r.count ? ` · ${r.count} veces` : ''}`;
}
