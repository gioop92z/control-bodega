import { describe, it, expect } from 'vitest';
import { recurrenceDays, expandEvents } from './recurrence';
import { gymScore, rankGyms, parseMapsUrl } from './gyms';
import { bestTimes, engagementRate, followerSeries, formatStats, generateInsights, growth, growthAroundPosts, mediaMetric, periodChange, projectFollowers, seriesPerformance, audienceShift } from './analytics';
import { buildMonthReport, transferableGoals, yearSummary } from './journey';
import { productiveDays, streaks } from './streak';
import { goalProgress } from './goals';
import { crc32, makeZip } from './zip';
import { toCsv } from './csv';
import { addDays, addMonths, monthEnd, weekStart } from './dates';
import type { CalEvent, Goal, Gym, IgMedia, ProfileSnapshot, AccountInsight, Series, Month } from './types';

const ev = (p: Partial<CalEvent>): CalEvent => ({ id: 'e', title: 'x', category: 'personal', start_at: new Date(2026, 10, 2, 7, 0).toISOString(), all_day: false, priority: 2, status: 'pendiente', exdates: [], done_dates: [], ...p });
const media = (id: string, p: Partial<IgMedia>): IgMedia => ({ id, ig_user_id: '1', ig_media_id: id, caption: id, media_type: 'VIDEO', media_product_type: 'REELS', permalink: null, media_url: null, thumbnail_url: null, posted_at: null, like_count: null, comments_count: null, is_story: false, insights: {}, insights_fetched_at: null, unavailable_metrics: [], insights_note: null, ...p });

describe('fechas', () => {
  it('opera con meses y semanas', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(weekStart('2026-11-25')).toBe('2026-11-23');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
});

describe('recurrencias', () => {
  it('diaria con intervalo y excepciones', () => {
    const e = ev({ recurrence: { freq: 'daily', interval: 2 }, exdates: ['2026-11-06'] });
    expect(recurrenceDays(e, '2026-11-01', '2026-11-10')).toEqual(['2026-11-02', '2026-11-04', '2026-11-08', '2026-11-10']);
  });
  it('semanal en días específicos con límite de repeticiones', () => {
    const e = ev({ recurrence: { freq: 'weekly', byweekday: [0, 2, 4], count: 4 } }); // 2 nov 2026 es lunes
    expect(recurrenceDays(e, '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09']);
  });
  it('mensual omite meses sin ese día y respeta «hasta»', () => {
    const e = ev({ start_at: new Date(2026, 0, 31, 9).toISOString(), recurrence: { freq: 'monthly', until: '2026-05-31' } });
    expect(recurrenceDays(e, '2026-01-01', '2026-12-31')).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });
  it('anual y evento único', () => {
    const e = ev({ start_at: new Date(2024, 1, 29, 9).toISOString(), recurrence: { freq: 'yearly' } });
    expect(recurrenceDays(e, '2024-01-01', '2028-12-31')).toEqual(['2024-02-29', '2028-02-29']);
    expect(recurrenceDays(ev({}), '2026-11-01', '2026-11-30')).toEqual(['2026-11-02']);
  });
  it('conserva la hora local y marca hechas por fecha', () => {
    const e = ev({ recurrence: { freq: 'daily' }, done_dates: ['2026-11-03'], end_at: new Date(2026, 10, 2, 8, 30).toISOString() });
    const occ = expandEvents([e], '2026-11-03', '2026-11-04');
    expect(occ.map((o) => o.done)).toEqual([true, false]);
    expect(new Date(occ[1].start).getHours()).toBe(7);
    expect((new Date(occ[1].end!).getTime() - new Date(occ[1].start).getTime()) / 60000).toBe(90);
  });
});

describe('gimnasios', () => {
  it('calcula puntuación ponderada y ranking', () => {
    expect(gymScore({ maquinaria: 10, hardcore: 8 })).toBe(9);
    expect(gymScore({ maquinaria: 10, hardcore: 6 }, { maquinaria: 3, hardcore: 1 } as any)).toBe(9);
    expect(gymScore({})).toBeNull();
    const g = (id: string, ratings: Record<string, number>): Gym => ({ id, name: id, currency: 'MXN', status: 'visitado', ratings });
    const r = rankGyms([g('a', { maquinaria: 6 }), g('b', { maquinaria: 9 }), g('c', {})]);
    expect(r.map((x) => [x.gym.id, x.rank])).toEqual([['b', 1], ['a', 2], ['c', null]]);
  });
  it('extrae coordenadas de enlaces de Google Maps', () => {
    expect(parseMapsUrl('https://www.google.com/maps/place/Gym/@19.4326,-99.1332,17z/data=!3d19.4330!4d-99.1340')).toEqual({ lat: 19.433, lng: -99.134 });
    expect(parseMapsUrl('https://www.google.com/maps/@19.4,-99.1,15z')).toEqual({ lat: 19.4, lng: -99.1 });
    expect(parseMapsUrl('https://maps.google.com/?q=20.67,-103.35')).toEqual({ lat: 20.67, lng: -103.35 });
    expect(parseMapsUrl('https://maps.app.goo.gl/abc')).toBeNull();
  });
});

describe('análisis', () => {
  const snaps: ProfileSnapshot[] = Array.from({ length: 40 }, (_, i) => ({ id: String(i), ig_user_id: '1', day: addDays('2026-10-01', i), followers_open: 1000 + i * 10, followers_count: 1000 + i * 10, follows_count: 0, media_count: 0, captured_at: '' }));
  it('crecimiento diario, semanal, mensual y anual (incompleto)', () => {
    const g = growth(followerSeries(snaps), '2026-11-09');
    expect(g[0]).toMatchObject({ label: 'Diario', delta: 10, complete: true });
    expect(g[1]).toMatchObject({ label: 'Semanal', delta: 70 });
    expect(g[2]).toMatchObject({ label: 'Mensual', delta: 300 });
    expect(g[3]).toMatchObject({ label: 'Anual', delta: 390, complete: false });
  });
  it('proyección lineal etiquetable como predicción', () => {
    const p = projectFollowers(followerSeries(snaps), '2026-11-19');
    expect(p!.perDay).toBeCloseTo(10);
    expect(p!.value).toBe(1490);
  });
  it('métricas por publicación y tasa de interacción', () => {
    const m = media('a', { insights: { reach: 1000, total_interactions: 80, saved: 5 }, like_count: 50 });
    expect(engagementRate(m)).toBe(0.08);
    expect(mediaMetric(m, 'likes')).toBe(50);
    expect(mediaMetric(m, 'saves')).toBe(5);
    expect(engagementRate(media('b', {}))).toBeNull();
  });
  it('compara formatos y mejores horarios con muestra mínima', () => {
    const list = [
      ...[1, 2, 3].map((i) => media(`r${i}`, { media_product_type: 'REELS', posted_at: new Date(2026, 10, 5 + i * 7, 20).toISOString(), insights: { reach: 2000 + i, total_interactions: 200 } })),
      ...[1, 2, 3].map((i) => media(`f${i}`, { media_product_type: 'FEED', media_type: 'IMAGE', posted_at: new Date(2026, 10, 3 + i * 7, 10).toISOString(), insights: { reach: 500, total_interactions: 20 } })),
    ];
    const f = formatStats(list);
    expect(f.find((x) => x.format === 'REELS')!.medianER).toBeCloseTo(0.1, 2);
    const t = bestTimes(list);
    expect(t.sample).toBe(6);
    expect(t.top.length).toBeGreaterThan(0);
    const insights = generateInsights({ media: list, insights: [], snapshots: [], audience: [], seriesPerf: [] , today: '2026-12-31' });
    expect(insights.some((i) => i.id === 'format-er' && i.kind === 'observacion')).toBe(true);
    expect(insights.some((i) => i.kind === 'recomendacion')).toBe(true);
    expect(insights.every((i) => ['observacion', 'prediccion', 'recomendacion'].includes(i.kind))).toBe(true);
  });
  it('sin datos reales no inventa hallazgos', () => {
    const r = generateInsights({ media: [], insights: [], snapshots: [], audience: [], seriesPerf: [] });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('no-data');
  });
  it('rendimiento por serie a partir de publicaciones vinculadas', () => {
    const s: Series = { id: 's1', title: 'GYM AFTER DARK', status: 'activa', sort: 0 };
    const list = [media('a', { insights: { reach: 100, views: 300, total_interactions: 10, shares: 2 } }), media('b', { insights: { reach: 300, views: 900, total_interactions: 30, shares: 4 } })];
    const perf = seriesPerformance([s], [{ id: 'l1', ig_media_id: 'a', series_id: 's1', episode_id: null }, { id: 'l2', ig_media_id: 'b', series_id: null, episode_id: 'ep1' }], list, new Map([['ep1', 's1']]));
    expect(perf[0]).toMatchObject({ posts: 2, reach: 400, views: 1200, interactions: 40, shares: 6, avgReach: 200 });
  });
  it('variación entre periodos solo con datos suficientes', () => {
    const rows: AccountInsight[] = Array.from({ length: 56 }, (_, i) => ({ id: String(i), ig_user_id: '1', day: addDays('2026-10-01', i), metric: 'reach', value: i < 28 ? 100 : 150, breakdown: null, fetched_at: '' }));
    const c = periodChange(rows, 'reach', 28, addDays('2026-10-01', 56));
    expect(c.change).toBeCloseTo(0.5);
    expect(periodChange(rows.slice(40), 'reach', 28, addDays('2026-10-01', 56)).change).toBeNull();
  });
  it('crecimiento alrededor de publicaciones contra días sin publicar', () => {
    const s = followerSeries(snaps.map((x, i) => ({ ...x, followers_count: 1000 + i * 2 + (i >= 20 ? 50 : 0) })));
    const r = growthAroundPosts([media('viral', { posted_at: new Date(2026, 9, 20, 12).toISOString() })], s);
    expect(r[0].excess).toBeGreaterThan(40);
  });
  it('detecta cambios de audiencia', () => {
    const rows = [
      { id: '1', ig_user_id: '1', day: '2026-10-01', metric: 'follower_demographics', breakdown: 'country', timeframe: '', data: { MX: 80, US: 20 }, fetched_at: '' },
      { id: '2', ig_user_id: '1', day: '2026-11-01', metric: 'follower_demographics', breakdown: 'country', timeframe: '', data: { MX: 70, US: 30 }, fetched_at: '' },
    ];
    const s = audienceShift(rows, 'follower_demographics', 'country');
    const byKey = Object.fromEntries(s!.changes.map((c) => [c.key, c.delta]));
    expect(byKey.US).toBeCloseTo(0.1);
    expect(byKey.MX).toBeCloseTo(-0.1);
  });
});

describe('journey mensual', () => {
  const base = { insights: [], media: [], manual: [], episodes: [], gyms: [], workouts: [], bodyLogs: [], transactions: [], goals: [], currency: 'MXN', contentCategories: ['produccion'] };
  it('usa el valor de apertura real del primer día y suma finanzas', () => {
    const r = buildMonthReport('2026-11', {
      ...base,
      snapshots: [
        { id: 'a', ig_user_id: '1', day: '2026-10-31', followers_open: 900, followers_count: 950, follows_count: 0, media_count: 0, captured_at: '' },
        { id: 'b', ig_user_id: '1', day: '2026-11-01', followers_open: 960, followers_count: 980, follows_count: 0, media_count: 0, captured_at: '' },
        { id: 'c', ig_user_id: '1', day: '2026-11-30', followers_open: 1090, followers_count: 1100, follows_count: 0, media_count: 0, captured_at: '' },
      ],
      transactions: [
        { id: 't1', day: '2026-11-03', kind: 'ingreso', amount: 5000, currency: 'MXN', category: 'patrocinio' },
        { id: 't2', day: '2026-11-04', kind: 'gasto', amount: 800, currency: 'MXN', category: 'produccion' },
        { id: 't3', day: '2026-12-01', kind: 'gasto', amount: 999, currency: 'MXN', category: 'produccion' },
      ],
      goals: [{ id: 'g', title: 'x', area: 'instagram', metric: 'manual', status: 'logrado', priority: 2, sort: 0, month: '2026-11' } as Goal],
    });
    expect(r.followers).toMatchObject({ start: 960, end: 1100, delta: 140, source: 'instagram' });
    expect(r.money).toMatchObject({ income: 5000, expenses: 800, net: 4200, content_expenses: 800 });
    expect(r.goals.done).toBe(1);
  });
  it('recurre a datos manuales y los etiqueta', () => {
    const r = buildMonthReport('2026-11', { ...base, snapshots: [], manual: [{ id: 'm', day: '2026-11-02', metric: 'followers', value: 500 }, { id: 'n', day: '2026-11-28', metric: 'followers', value: 600 }] });
    expect(r.followers).toMatchObject({ start: 500, end: 600, source: 'manual' });
  });
  it('transfiere solo objetivos abiertos y resume el año', () => {
    const goals = [{ id: '1', month: '2026-11', status: 'pendiente' }, { id: '2', month: '2026-11', status: 'logrado' }, { id: '3', month: '2026-10', status: 'pendiente' }] as Goal[];
    expect(transferableGoals(goals, '2026-11').map((g) => g.id)).toEqual(['1']);
    const rep = (month: string, s: number, e: number) => ({ month, status: 'cerrado', report: buildMonthReport(month, { ...base, snapshots: [{ id: month, ig_user_id: '1', day: `${month}-01`, followers_open: s, followers_count: s, follows_count: 0, media_count: 0, captured_at: '' }, { id: month + 'e', ig_user_id: '1', day: `${month}-28`, followers_open: e, followers_count: e, follows_count: 0, media_count: 0, captured_at: '' }] }) }) as unknown as Month;
    const y = yearSummary([rep('2026-01', 100, 200), rep('2026-02', 200, 260)], 2026);
    expect(y).toMatchObject({ closedMonths: 2, followersStart: 100, followersEnd: 260, followersDelta: 160 });
    expect(y.bestMonth!.month).toBe('2026-01');
  });
});

describe('racha, objetivos, exportación', () => {
  it('racha viva si ayer hubo actividad', () => {
    const days = productiveDays({ tasksDone: [{ done_at: new Date(2026, 10, 24, 10).toISOString() }], workouts: [{ day: '2026-11-23' }, { day: '2026-11-22' }], eventsDone: ['2026-11-20'], ideasCreated: [], bodyLogs: [], episodesPublished: [] });
    const s = streaks(days, '2026-11-25');
    expect(s.current).toBe(3);
    expect(s.best).toBe(3);
    expect(s.last28).toHaveLength(28);
  });
  it('avance de objetivos automático y manual', () => {
    const ctx = { followers: 1500, workoutsThisMonth: 10, episodesPublished: 3, latestWeight: 78, gymsVisited: 4, incomeThisMonth: 0 };
    expect(goalProgress({ metric: 'followers', start_value: 1000, target_value: 2000 } as Goal, ctx)).toMatchObject({ current: 1500, pct: 0.5, auto: true });
    expect(goalProgress({ metric: 'weight', start_value: 80, target_value: 76 } as Goal, ctx).pct).toBeCloseTo(0.5);
    expect(goalProgress({ metric: 'manual', current_value: 3, target_value: 12 } as Goal, ctx)).toMatchObject({ pct: 0.25, auto: false });
  });
  it('genera ZIP válido y CSV con escape', async () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const z = makeZip([{ name: 'a.txt', data: new TextEncoder().encode('hola') }]);
    const buf = new Uint8Array(await z.arrayBuffer());
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(toCsv([{ a: 'x,y', b: 1 }])).toBe('﻿a,b\n"x,y",1');
  });
});
