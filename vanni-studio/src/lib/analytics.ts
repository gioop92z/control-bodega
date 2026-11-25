// Motor de análisis sobre estadísticas REALES de Instagram.
// Distingue explícitamente observaciones estadísticas, predicciones y recomendaciones,
// e indica el tamaño de muestra para no sobreinterpretar datos escasos.
import type { AccountInsight, Audience, IgMedia, MediaLink, ProfileSnapshot, Series } from './types';
import { addDays, dayOfInstant, diffDays, today as todayFn, WEEKDAYS } from './dates';
import { FORMAT_LABELS } from './constants';

export type InsightKind = 'observacion' | 'prediccion' | 'recomendacion';
export type Confidence = 'baja' | 'media' | 'alta';
export interface Insight { id: string; kind: InsightKind; title: string; detail: string; confidence: Confidence; n: number; link?: string }

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
export function mean(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
export function confidenceFor(n: number): Confidence { return n >= 12 ? 'alta' : n >= 5 ? 'media' : 'baja'; }

/** Valor numérico de una métrica de publicación (insights reales; likes/comentarios desde campos básicos). */
export function mediaMetric(m: IgMedia, key: string): number | null {
  const raw = m.insights?.[key];
  const v = typeof raw === 'object' && raw !== null ? raw.total : raw;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (key === 'likes' && typeof m.like_count === 'number') return m.like_count;
  if (key === 'comments' && typeof m.comments_count === 'number') return m.comments_count;
  if (key === 'saves') return mediaMetric(m, 'saved');
  return null;
}

export function interactions(m: IgMedia): number | null {
  const t = mediaMetric(m, 'total_interactions');
  if (t !== null) return t;
  const parts = ['likes', 'comments', 'shares', 'saved'].map((k) => mediaMetric(m, k));
  return parts.some((x) => x !== null) ? parts.reduce<number>((a, b) => a + (b ?? 0), 0) : null;
}

export function engagementRate(m: IgMedia): number | null {
  const reach = mediaMetric(m, 'reach');
  const inter = interactions(m);
  return reach && reach > 0 && inter !== null ? inter / reach : null;
}

export function formatOf(m: IgMedia): 'REELS' | 'FEED' | 'STORY' {
  if (m.is_story || m.media_product_type === 'STORY') return 'STORY';
  if (m.media_product_type === 'REELS') return 'REELS';
  return 'FEED';
}

export function topMedia(media: IgMedia[], key: string | ((m: IgMedia) => number | null), n = 5): Array<{ media: IgMedia; value: number }> {
  const get = typeof key === 'function' ? key : (m: IgMedia) => mediaMetric(m, key);
  return media
    .map((m) => ({ media: m, value: get(m) }))
    .filter((x): x is { media: IgMedia; value: number } => x.value !== null)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

export interface FormatStat { format: string; label: string; n: number; medianReach: number | null; medianViews: number | null; medianER: number | null; avgShares: number | null; avgSaves: number | null }
export function formatStats(media: IgMedia[]): FormatStat[] {
  const groups = new Map<string, IgMedia[]>();
  for (const m of media) { const f = formatOf(m); if (!groups.has(f)) groups.set(f, []); groups.get(f)!.push(m); }
  return [...groups.entries()].map(([format, list]) => ({
    format, label: FORMAT_LABELS[format] ?? format, n: list.length,
    medianReach: median(list.map((m) => mediaMetric(m, 'reach') ?? NaN)),
    medianViews: median(list.map((m) => mediaMetric(m, 'views') ?? NaN)),
    medianER: median(list.map((m) => engagementRate(m) ?? NaN)),
    avgShares: mean(list.map((m) => mediaMetric(m, 'shares') ?? NaN)),
    avgSaves: mean(list.map((m) => mediaMetric(m, 'saved') ?? NaN)),
  })).sort((a, b) => b.n - a.n);
}

export const HOUR_BLOCKS = [
  { from: 5, to: 9, label: '05–09' }, { from: 9, to: 12, label: '09–12' }, { from: 12, to: 15, label: '12–15' },
  { from: 15, to: 18, label: '15–18' }, { from: 18, to: 21, label: '18–21' }, { from: 21, to: 24, label: '21–24' }, { from: 0, to: 5, label: '00–05' },
];
const blockOf = (h: number) => HOUR_BLOCKS.findIndex((b) => h >= b.from && h < b.to);

export interface TimeCell { weekday: number; block: number; n: number; score: number | null }
/**
 * Mejores horarios históricos: alcance de cada publicación dividido entre la mediana de alcance
 * de su formato (controla la diferencia entre reels y fotos). Índice 1.0 = típico.
 */
export function bestTimes(media: IgMedia[]): { cells: TimeCell[]; top: TimeCell[]; sample: number } {
  const posts = media.filter((m) => !m.is_story && m.posted_at && mediaMetric(m, 'reach') !== null);
  const baseline = new Map<string, number>();
  for (const f of ['REELS', 'FEED']) {
    const md = median(posts.filter((m) => formatOf(m) === f).map((m) => mediaMetric(m, 'reach')!));
    if (md) baseline.set(f, md);
  }
  const buckets = new Map<string, number[]>();
  for (const m of posts) {
    const base = baseline.get(formatOf(m));
    if (!base) continue;
    const d = new Date(m.posted_at!);
    const key = `${(d.getDay() + 6) % 7}|${blockOf(d.getHours())}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(mediaMetric(m, 'reach')! / base);
  }
  const cells: TimeCell[] = [];
  for (let w = 0; w < 7; w++) for (let b = 0; b < HOUR_BLOCKS.length; b++) {
    const v = buckets.get(`${w}|${b}`) ?? [];
    cells.push({ weekday: w, block: b, n: v.length, score: median(v) });
  }
  const top = cells.filter((c) => c.n >= 2 && c.score !== null).sort((a, b) => b.score! - a.score!).slice(0, 3);
  return { cells, top, sample: posts.length };
}
export const cellLabel = (c: TimeCell) => `${WEEKDAYS[c.weekday]} ${HOUR_BLOCKS[c.block].label} h`;

// ───────────────────────── Seguidores
export interface FollowerPoint { day: string; followers: number }
export function followerSeries(snapshots: ProfileSnapshot[]): FollowerPoint[] {
  return snapshots.filter((s) => s.followers_count !== null).map((s) => ({ day: s.day, followers: s.followers_count! })).sort((a, b) => a.day.localeCompare(b.day));
}

/** Valor en o antes de un día (búsqueda en serie ordenada). */
export function valueAtOrBefore(series: FollowerPoint[], day: string): FollowerPoint | null {
  let found: FollowerPoint | null = null;
  for (const p of series) { if (p.day <= day) found = p; else break; }
  return found;
}

export interface Growth { days: number; label: string; delta: number | null; pct: number | null; from: FollowerPoint | null; to: FollowerPoint | null; complete: boolean }
export function growth(series: FollowerPoint[], refDay = todayFn()): Growth[] {
  const last = valueAtOrBefore(series, refDay);
  return [
    { days: 1, label: 'Diario' }, { days: 7, label: 'Semanal' }, { days: 30, label: 'Mensual' }, { days: 365, label: 'Anual' },
  ].map(({ days, label }) => {
    if (!last) return { days, label, delta: null, pct: null, from: null, to: null, complete: false };
    const target = addDays(last.day, -days);
    let from = valueAtOrBefore(series, target);
    const complete = !!from;
    if (!from) from = series[0] && series[0].day < last.day ? series[0] : null; // historial incompleto: desde el primer registro
    if (!from) return { days, label, delta: null, pct: null, from: null, to: last, complete: false };
    const delta = last.followers - from.followers;
    return { days, label, delta, pct: from.followers ? delta / from.followers : null, from, to: last, complete };
  });
}

/** Proyección lineal (mínimos cuadrados) — es una PREDICCIÓN, no un dato. */
export function projectFollowers(series: FollowerPoint[], targetDay: string, window = 30): { value: number; perDay: number; n: number } | null {
  const pts = series.slice(-window);
  if (pts.length < 7) return null;
  const x0 = pts[0].day;
  const xs = pts.map((p) => diffDays(p.day, x0));
  const ys = pts.map((p) => p.followers);
  const mx = mean(xs)!, my = mean(ys)!;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  if (!den) return null;
  const slope = num / den;
  const value = my + slope * (diffDays(targetDay, x0) - mx);
  return { value: Math.round(value), perDay: slope, n: pts.length };
}

/** Crecimiento asociado a cada publicación: Δ seguidores (día previo → 2 días después) frente a la mediana de ventanas sin publicación. Correlación, no causalidad. */
export function growthAroundPosts(media: IgMedia[], series: FollowerPoint[]): Array<{ media: IgMedia; delta: number; excess: number }> {
  if (series.length < 10) return [];
  const byDay = new Map(series.map((p) => [p.day, p.followers]));
  const postDays = new Set(media.filter((m) => m.posted_at && !m.is_story).map((m) => dayOfInstant(m.posted_at!)));
  const windowDelta = (d: string) => {
    const a = byDay.get(addDays(d, -1)), b = byDay.get(addDays(d, 2));
    return a !== undefined && b !== undefined ? b - a : null;
  };
  const quiet: number[] = [];
  for (const p of series) {
    const span = [p.day, addDays(p.day, 1), addDays(p.day, 2)];
    if (span.some((d) => postDays.has(d))) continue;
    const w = windowDelta(p.day);
    if (w !== null) quiet.push(w);
  }
  const baseline = median(quiet) ?? 0;
  return media
    .filter((m) => m.posted_at && !m.is_story)
    .map((m) => { const w = windowDelta(dayOfInstant(m.posted_at!)); return w === null ? null : { media: m, delta: w, excess: w - baseline }; })
    .filter((x): x is { media: IgMedia; delta: number; excess: number } => x !== null)
    .sort((a, b) => b.excess - a.excess);
}

// ───────────────────────── Series
export interface SeriesPerf { series: Series; posts: number; reach: number; views: number; interactions: number; shares: number; saves: number; medianER: number | null; avgReach: number | null }
export function seriesPerformance(series: Series[], links: MediaLink[], media: IgMedia[], episodeSeries: Map<string, string | null>): SeriesPerf[] {
  const byMedia = new Map(media.map((m) => [m.ig_media_id, m]));
  return series.map((s) => {
    const list = links
      .filter((l) => (l.series_id ?? (l.episode_id ? episodeSeries.get(l.episode_id) : null)) === s.id)
      .map((l) => byMedia.get(l.ig_media_id))
      .filter((m): m is IgMedia => !!m);
    const sum = (k: string) => list.reduce((a, m) => a + (mediaMetric(m, k) ?? 0), 0);
    const reachVals = list.map((m) => mediaMetric(m, 'reach')).filter((v): v is number => v !== null);
    return {
      series: s, posts: list.length, reach: sum('reach'), views: sum('views'),
      interactions: list.reduce((a, m) => a + (interactions(m) ?? 0), 0), shares: sum('shares'), saves: sum('saved'),
      medianER: median(list.map((m) => engagementRate(m) ?? NaN)), avgReach: mean(reachVals),
    };
  });
}

// ───────────────────────── Tendencias
export function sumMetric(insights: AccountInsight[], metric: string, from: string, to: string): { value: number; days: number } {
  let value = 0, days = 0;
  for (const r of insights) if (r.metric === metric && r.day >= from && r.day <= to && r.value !== null) { value += Number(r.value); days++; }
  return { value, days };
}

export function periodChange(insights: AccountInsight[], metric: string, days: number, refDay = todayFn()) {
  const end = addDays(refDay, -1);
  const cur = sumMetric(insights, metric, addDays(end, -(days - 1)), end);
  const prev = sumMetric(insights, metric, addDays(end, -(2 * days - 1)), addDays(end, -days));
  const change = prev.days >= days * 0.8 && prev.value > 0 && cur.days >= days * 0.8 ? (cur.value - prev.value) / prev.value : null;
  return { current: cur, previous: prev, change };
}

export function dailySeries(insights: AccountInsight[], metric: string, from: string, to: string): Array<{ day: string; value: number | null }> {
  const map = new Map(insights.filter((r) => r.metric === metric).map((r) => [r.day, r.value === null ? null : Number(r.value)]));
  const out: Array<{ day: string; value: number | null }> = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ day: d, value: map.has(d) ? map.get(d)! : null });
  return out;
}

export function contentTrend(media: IgMedia[], size = 8) {
  const posts = media.filter((m) => !m.is_story && m.posted_at && mediaMetric(m, 'reach') !== null).sort((a, b) => b.posted_at!.localeCompare(a.posted_at!));
  if (posts.length < size * 2) return null;
  const recent = median(posts.slice(0, size).map((m) => mediaMetric(m, 'reach')!))!;
  const before = median(posts.slice(size, size * 2).map((m) => mediaMetric(m, 'reach')!))!;
  return { recent, before, change: before ? (recent - before) / before : null, n: size };
}

// ───────────────────────── Audiencia
export function latestAudience(rows: Audience[], metric: string, breakdown: string): Audience | null {
  return rows.filter((r) => r.metric === metric && r.breakdown === breakdown).sort((a, b) => b.day.localeCompare(a.day))[0] ?? null;
}
export function audienceShares(data: Record<string, number> | null | undefined): Array<{ key: string; value: number; share: number }> {
  if (!data) return [];
  const total = Object.values(data).reduce((a, b) => a + Number(b || 0), 0);
  return Object.entries(data).map(([key, value]) => ({ key, value: Number(value), share: total ? Number(value) / total : 0 })).sort((a, b) => b.value - a.value);
}
export function audienceShift(rows: Audience[], metric: string, breakdown: string, days = 28) {
  const list = rows.filter((r) => r.metric === metric && r.breakdown === breakdown).sort((a, b) => b.day.localeCompare(a.day));
  const latest = list[0];
  if (!latest) return null;
  const older = list.find((r) => diffDays(latest.day, r.day) >= days);
  if (!older) return null;
  const now = new Map(audienceShares(latest.data).map((x) => [x.key, x.share]));
  const then = new Map(audienceShares(older.data).map((x) => [x.key, x.share]));
  const keys = new Set([...now.keys(), ...then.keys()]);
  const changes = [...keys].map((k) => ({ key: k, delta: (now.get(k) ?? 0) - (then.get(k) ?? 0) })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { from: older.day, to: latest.day, changes };
}

// ───────────────────────── Generador de hallazgos
export interface InsightInput {
  media: IgMedia[]; insights: AccountInsight[]; snapshots: ProfileSnapshot[]; audience: Audience[];
  seriesPerf: SeriesPerf[]; today?: string;
}

export function generateInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  const day = input.today ?? todayFn();
  const posts = input.media.filter((m) => !m.is_story);
  const withReach = posts.filter((m) => mediaMetric(m, 'reach') !== null);
  const fmtNum = (v: number) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(v);
  const pctTxt = (v: number) => `${(v * 100).toFixed(0)} %`;

  if (!withReach.length) {
    out.push({ id: 'no-data', kind: 'observacion', title: 'Aún no hay métricas de publicaciones', detail: 'Cuando Instagram entregue el alcance de tus publicaciones (sincronización cada hora), aparecerán aquí los hallazgos.', confidence: 'baja', n: 0 });
    return out;
  }

  // Formatos
  const fmts = formatStats(posts).filter((f) => f.n >= 3 && f.medianER !== null);
  if (fmts.length >= 2) {
    const best = [...fmts].sort((a, b) => b.medianER! - a.medianER!)[0];
    const worst = [...fmts].sort((a, b) => a.medianER! - b.medianER!)[0];
    if (best.format !== worst.format && worst.medianER! > 0) {
      out.push({ id: 'format-er', kind: 'observacion', title: `${best.label}: el formato con más interacción`, detail: `Mediana de interacción por alcance ${pctTxt(best.medianER!)} frente a ${pctTxt(worst.medianER!)} en ${worst.label.toLowerCase()} (${best.n} y ${worst.n} publicaciones).`, confidence: confidenceFor(Math.min(best.n, worst.n)), n: best.n + worst.n, link: '/analisis' });
    }
  }

  // Compartidos y guardados
  const sharesTop = topMedia(posts, 'shares', 1)[0];
  const medShares = median(posts.map((m) => mediaMetric(m, 'shares') ?? NaN));
  if (sharesTop && medShares !== null && sharesTop.value > Math.max(3, medShares * 2)) {
    out.push({ id: 'shares-top', kind: 'observacion', title: 'Publicación con más compartidos', detail: `«${(sharesTop.media.caption ?? 'Sin texto').slice(0, 70)}» suma ${fmtNum(sharesTop.value)} compartidos, ${(sharesTop.value / Math.max(1, medShares)).toFixed(1)}× tu mediana.`, confidence: confidenceFor(posts.length), n: posts.length, link: '/instagram/publicaciones' });
  }

  // Horarios
  const times = bestTimes(posts);
  if (times.top.length) {
    const t = times.top[0];
    out.push({ id: 'best-time', kind: 'observacion', title: `Mejor franja histórica: ${cellLabel(t)}`, detail: `Tus publicaciones en esa franja alcanzan ${t.score!.toFixed(2)}× la mediana de su formato (${t.n} publicaciones de ${times.sample}).`, confidence: confidenceFor(t.n * 2), n: t.n, link: '/analisis' });
    out.push({ id: 'best-time-rec', kind: 'recomendacion', title: 'Prueba repetir tu mejor franja', detail: `Programa tu próximo reel en ${cellLabel(t)} y compara su alcance con la mediana. Con muestras pequeñas, la diferencia puede deberse al azar.`, confidence: 'baja', n: t.n, link: '/agenda' });
  }

  // Series
  const ranked = input.seriesPerf.filter((s) => s.posts >= 2 && s.medianER !== null).sort((a, b) => b.medianER! - a.medianER!);
  if (ranked.length >= 2) {
    const b = ranked[0];
    out.push({ id: 'series-best', kind: 'observacion', title: `${b.series.title}: tu serie con mejor interacción`, detail: `Mediana ${pctTxt(b.medianER!)} con ${b.posts} publicaciones vinculadas; alcance acumulado ${fmtNum(b.reach)}.`, confidence: confidenceFor(b.posts), n: b.posts, link: `/series/${b.series.id}` });
    out.push({ id: 'series-rec', kind: 'recomendacion', title: `Planea un episodio nuevo de ${b.series.title}`, detail: 'Es la serie que mejor responde tu audiencia según tus datos vinculados. Considera una nueva temporada o un episodio especial.', confidence: confidenceFor(b.posts), n: b.posts, link: `/series/${b.series.id}` });
  }

  // Tendencias de cuenta
  for (const metric of ['reach', 'views', 'total_interactions']) {
    const c = periodChange(input.insights, metric, 28, day);
    if (c.change !== null && Math.abs(c.change) >= 0.15) {
      const names: Record<string, string> = { reach: 'alcance', views: 'reproducciones', total_interactions: 'interacciones' };
      out.push({ id: `trend-${metric}`, kind: 'observacion', title: `Tu ${names[metric]} ${c.change > 0 ? 'subió' : 'bajó'} ${pctTxt(Math.abs(c.change))}`, detail: `Últimos 28 días: ${fmtNum(c.current.value)} frente a ${fmtNum(c.previous.value)} en los 28 anteriores (datos diarios de la cuenta).`, confidence: 'alta', n: c.current.days, link: '/instagram' });
    }
  }
  const ct = contentTrend(posts);
  if (ct?.change !== null && ct && Math.abs(ct.change!) >= 0.2) {
    out.push({ id: 'content-trend', kind: 'observacion', title: `Tus últimas ${ct.n} publicaciones ${ct.change! > 0 ? 'alcanzan más' : 'alcanzan menos'}`, detail: `Mediana de alcance ${fmtNum(ct.recent)} frente a ${fmtNum(ct.before)} en las ${ct.n} anteriores.`, confidence: 'media', n: ct.n * 2, link: '/instagram/publicaciones' });
  }

  // Crecimiento asociado
  const series = followerSeries(input.snapshots);
  const assoc = growthAroundPosts(posts, series).filter((x) => x.excess > 0);
  if (assoc.length) {
    const a = assoc[0];
    out.push({ id: 'growth-post', kind: 'observacion', title: 'Publicación asociada a mayor crecimiento', detail: `Alrededor de «${(a.media.caption ?? 'Sin texto').slice(0, 60)}» ganaste ${fmtNum(a.delta)} seguidores en 3 días, ${fmtNum(a.excess)} más que en días sin publicar. Es una asociación, no prueba causalidad.`, confidence: confidenceFor(series.length / 3), n: series.length, link: '/instagram/publicaciones' });
  }

  // Proyección
  const monthEndDay = (() => { const d = new Date(day + 'T12:00:00'); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10); })();
  const proj = projectFollowers(series, monthEndDay);
  if (proj) {
    out.push({ id: 'projection', kind: 'prediccion', title: `Proyección al cierre de mes: ~${fmtNum(proj.value)} seguidores`, detail: `Tendencia lineal de los últimos ${proj.n} días (${proj.perDay >= 0 ? '+' : ''}${proj.perDay.toFixed(1)} por día). Es una estimación: un reel viral o una pausa la cambian.`, confidence: proj.n >= 21 ? 'media' : 'baja', n: proj.n, link: '/instagram' });
  }

  // Ritmo de publicación
  const lastPost = posts.filter((m) => m.posted_at).sort((a, b) => b.posted_at!.localeCompare(a.posted_at!))[0];
  if (lastPost) {
    const gap = diffDays(day, dayOfInstant(lastPost.posted_at!));
    if (gap >= 7) out.push({ id: 'gap', kind: 'recomendacion', title: `Llevas ${gap} días sin publicar en el feed`, detail: 'Revisa tu tablero de producción: hay episodios en edición o programados que podrían salir esta semana.', confidence: 'alta', n: 1, link: '/produccion' });
  }

  // Cambios de audiencia
  const shift = audienceShift(input.audience, 'follower_demographics', 'country');
  if (shift && shift.changes[0] && Math.abs(shift.changes[0].delta) >= 0.03) {
    const c = shift.changes[0];
    out.push({ id: 'aud-country', kind: 'observacion', title: `Cambio de audiencia: ${c.key}`, detail: `Su participación entre tus seguidores ${c.delta > 0 ? 'creció' : 'bajó'} ${(Math.abs(c.delta) * 100).toFixed(1)} puntos entre ${shift.from} y ${shift.to}.`, confidence: 'media', n: 2, link: '/instagram/audiencia' });
  }

  // Guardados → contenido educativo
  const savesTop = topMedia(posts, 'saved', 3);
  if (savesTop.length >= 3) {
    out.push({ id: 'saves-rec', kind: 'recomendacion', title: 'Convierte tus publicaciones más guardadas en una serie', detail: `Tus 3 publicaciones con más guardados suman ${fmtNum(savesTop.reduce((a, b) => a + b.value, 0))}. El contenido que se guarda suele ser de referencia: considera una versión ampliada o una guía.`, confidence: 'media', n: posts.length, link: '/laboratorio' });
  }
  return out;
}
