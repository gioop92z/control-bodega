// Fechas locales del dispositivo («YYYY-MM-DD») sin dependencias.
const pad = (n: number) => String(n).padStart(2, '0');

export function toDay(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function today(): string { return toDay(new Date()); }
export function parseDay(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(day: string, n: number): string { const d = parseDay(day); d.setDate(d.getDate() + n); return toDay(d); }
export function addMonths(day: string, n: number): string { const d = parseDay(day); const target = new Date(d.getFullYear(), d.getMonth() + n, 1); const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate(); target.setDate(Math.min(d.getDate(), last)); return toDay(target); }
export function diffDays(a: string, b: string): number { return Math.round((parseDay(a).getTime() - parseDay(b).getTime()) / 86_400_000); }
export function monthKey(day: string): string { return day.slice(0, 7); }
export function currentMonth(): string { return monthKey(today()); }
export function monthStart(month: string): string { return `${month}-01`; }
export function monthEnd(month: string): string { const [y, m] = month.split('-').map(Number); return toDay(new Date(y, m, 0)); }
export function shiftMonth(month: string, n: number): string { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
export function daysInRange(from: string, to: string): string[] { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }
/** Lunes de la semana del día dado. */
export function weekStart(day: string): string { const d = parseDay(day); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return toDay(d); }
export function weekday(day: string): number { return (parseDay(day).getDay() + 6) % 7; }
export function dayOfInstant(iso: string): string { return toDay(new Date(iso)); }
export function timeOfInstant(iso: string): string { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
/** Combina día y hora locales en ISO UTC. */
export function combine(day: string, time = '00:00'): string { const [h, mi] = time.split(':').map(Number); const d = parseDay(day); d.setHours(h || 0, mi || 0, 0, 0); return d.toISOString(); }
export function isoMinutesBetween(a: string, b: string): number { return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000); }
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
export const WEEKDAYS_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export function monthLabel(month: string): string { const [y, m] = month.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; }
export function dayLabel(day: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const d = parseDay(day);
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  const wd = opts.weekday ? `${WEEKDAYS[(d.getDay() + 6) % 7]} ` : '';
  return `${wd}${base}${opts.year ? ` ${d.getFullYear()}` : ''}`;
}
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (Math.abs(m) < 1) return 'justo ahora';
  if (m < 60 && m > 0) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24 && h > 0) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d > 0 && d < 30) return `hace ${d} d`;
  if (m < 0) { const fm = -m; if (fm < 60) return `en ${fm} min`; if (fm < 1440) return `en ${Math.round(fm / 60)} h`; return `en ${Math.round(fm / 1440)} d`; }
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}
