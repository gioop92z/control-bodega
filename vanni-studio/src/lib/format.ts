const nf = new Intl.NumberFormat('es-MX');
const nf1 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 });

export function n(v: number | null | undefined, fallback = '—'): string { return v === null || v === undefined || Number.isNaN(v) ? fallback : nf.format(Math.round(v)); }
export function n1(v: number | null | undefined, fallback = '—'): string { return v === null || v === undefined || Number.isNaN(v) ? fallback : nf1.format(v); }
export function short(v: number | null | undefined, fallback = '—'): string { return v === null || v === undefined || Number.isNaN(v) ? fallback : Math.abs(v) < 10_000 ? nf.format(Math.round(v)) : compact.format(v); }
export function pct(v: number | null | undefined, digits = 1, fallback = '—'): string { return v === null || v === undefined || !Number.isFinite(v) ? fallback : `${(v * 100).toFixed(digits)} %`; }
export function signed(v: number | null | undefined, fallback = '—'): string { if (v === null || v === undefined || Number.isNaN(v)) return fallback; return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${nf.format(Math.abs(Math.round(v)))}`; }
export function signedPct(v: number | null | undefined, fallback = '—'): string { if (v === null || v === undefined || !Number.isFinite(v)) return fallback; return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v * 100).toFixed(1)} %`; }
export function money(v: number | null | undefined, currency = 'MXN', fallback = '—'): string {
  if (v === null || v === undefined || Number.isNaN(v)) return fallback;
  try { return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v); } catch { return `${nf.format(v)} ${currency}`; }
}
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  if (m < 60) return `${m} min ${s} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
export function bytes(b: number | null | undefined): string {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}
export function trendClass(v: number | null | undefined): string { return v === null || v === undefined || v === 0 ? 'flatline' : v > 0 ? 'up' : 'down'; }
