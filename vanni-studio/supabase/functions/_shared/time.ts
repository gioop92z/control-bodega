// Fechas locales por zona horaria IANA, sin dependencias.

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function zoned(utcMs: number, tz: string) {
  const parts = partsFormatter(tz).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

/** Diferencia (ms) entre la hora local de `tz` y UTC en el instante dado. */
export function tzOffsetMs(utcMs: number, tz: string): number {
  const z = zoned(utcMs, tz);
  const asUtc = Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, z.s);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Día local «YYYY-MM-DD» del instante dado en la zona `tz`. */
export function localDay(at: Date | number, tz: string): string {
  const z = zoned(typeof at === 'number' ? at : at.getTime(), tz);
  return `${z.y}-${pad(z.m)}-${pad(z.d)}`;
}

/** Hora local (0–23) del instante dado. */
export function localHour(at: Date | number, tz: string): number {
  return zoned(typeof at === 'number' ? at : at.getTime(), tz).h;
}

/** Instante UTC (ms) de la medianoche local del día dado. */
export function zonedMidnightUtc(day: string, tz: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const off1 = tzOffsetMs(guess, tz);
  let t = guess - off1;
  const off2 = tzOffsetMs(t, tz);
  if (off2 !== off1) t = guess - off2;
  return t;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Límites Unix (segundos) del día local, recortando el final a «ahora». */
export function dayBoundsUnix(day: string, tz: string, nowMs = Date.now()): { since: number; until: number } {
  const start = zonedMidnightUtc(day, tz);
  const end = Math.min(zonedMidnightUtc(addDays(day, 1), tz), nowMs);
  return { since: Math.floor(start / 1000), until: Math.floor(end / 1000) };
}
