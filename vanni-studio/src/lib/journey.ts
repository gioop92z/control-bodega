// The VANNI Journey: informe mensual congelado al cerrar el mes y retrospectiva anual.
import type { AccountInsight, BodyLog, Episode, Goal, Gym, IgMedia, ManualMetric, Month, ProfileSnapshot, Transaction, Workout } from './types';
import { monthEnd, monthStart } from './dates';
import { engagementRate, followerSeries, interactions, mediaMetric, sumMetric } from './analytics';

export interface MonthReport {
  version: 1;
  month: string;
  generated_at: string;
  followers: { start: number | null; end: number | null; delta: number | null; pct: number | null; source: 'instagram' | 'manual' | 'none' };
  account: Record<string, { value: number; days: number }>;
  top_posts: Array<{ ig_media_id: string; caption: string | null; permalink: string | null; thumbnail: string | null; reach: number | null; views: number | null; interactions: number | null; er: number | null }>;
  posts_published: number;
  episodes_published: Array<{ id: string; title: string; publish_date: string | null }>;
  gyms_visited: Array<{ id: string; name: string; visit_date: string | null }>;
  workouts: { count: number; minutes: number };
  body: { weight_start: number | null; weight_end: number | null; logs: number };
  money: { income: number; expenses: number; net: number; content_expenses: number; currency: string };
  goals: { total: number; done: number; pending: number; items: Array<{ id: string; title: string; status: string }> };
}

export interface MonthData {
  snapshots: ProfileSnapshot[]; insights: AccountInsight[]; media: IgMedia[]; manual: ManualMetric[]; episodes: Episode[]; gyms: Gym[];
  workouts: Workout[]; bodyLogs: BodyLog[]; transactions: Transaction[]; goals: Goal[]; currency: string; contentCategories: string[];
}

const inMonth = (day: string | null | undefined, month: string) => !!day && day.slice(0, 7) === month;

export function buildMonthReport(month: string, d: MonthData, now = new Date()): MonthReport {
  const from = monthStart(month), to = monthEnd(month);
  const series = followerSeries(d.snapshots).filter((p) => p.day >= from && p.day <= to);
  let followers: MonthReport['followers'];
  if (series.length) {
    const firstSnap = d.snapshots.filter((s) => s.day === series[0].day)[0];
    const start = firstSnap?.followers_open ?? series[0].followers;
    const end = series[series.length - 1].followers;
    followers = { start, end, delta: end - start, pct: start ? (end - start) / start : null, source: 'instagram' };
  } else {
    const man = d.manual.filter((m) => m.metric === 'followers' && m.day >= from && m.day <= to).sort((a, b) => a.day.localeCompare(b.day));
    followers = man.length
      ? { start: man[0].value, end: man[man.length - 1].value, delta: man[man.length - 1].value - man[0].value, pct: man[0].value ? (man[man.length - 1].value - man[0].value) / man[0].value : null, source: 'manual' }
      : { start: null, end: null, delta: null, pct: null, source: 'none' };
  }
  const account: MonthReport['account'] = {};
  for (const metric of ['reach', 'views', 'total_interactions', 'accounts_engaged', 'likes', 'comments', 'shares', 'saves', 'profile_views']) {
    const s = sumMetric(d.insights, metric, from, to);
    if (s.days) account[metric] = s;
  }
  const monthPosts = d.media.filter((m) => !m.is_story && m.posted_at && inMonth(m.posted_at.slice(0, 10), month));
  const top = monthPosts
    .map((m) => ({ m, reach: mediaMetric(m, 'reach') }))
    .sort((a, b) => (b.reach ?? -1) - (a.reach ?? -1))
    .slice(0, 5)
    .map(({ m, reach }) => ({ ig_media_id: m.ig_media_id, caption: m.caption?.slice(0, 140) ?? null, permalink: m.permalink, thumbnail: m.thumbnail_url ?? m.media_url, reach, views: mediaMetric(m, 'views'), interactions: interactions(m), er: engagementRate(m) }));
  const txs = d.transactions.filter((t) => inMonth(t.day, month));
  const income = txs.filter((t) => t.kind === 'ingreso').reduce((a, t) => a + Number(t.amount || 0), 0);
  const expenses = txs.filter((t) => t.kind === 'gasto').reduce((a, t) => a + Number(t.amount || 0), 0);
  const content = txs.filter((t) => t.kind === 'gasto' && d.contentCategories.includes(t.category)).reduce((a, t) => a + Number(t.amount || 0), 0);
  const logs = d.bodyLogs.filter((b) => inMonth(b.day, month) && b.weight !== null && b.weight !== undefined).sort((a, b) => a.day.localeCompare(b.day));
  const workouts = d.workouts.filter((w) => inMonth(w.day, month));
  const goals = d.goals.filter((g) => g.month === month);
  return {
    version: 1, month, generated_at: now.toISOString(), followers, account, top_posts: top, posts_published: monthPosts.length,
    episodes_published: d.episodes.filter((e) => inMonth(e.publish_date, month) && (e.status === 'publicado' || e.status === 'analizado')).map((e) => ({ id: e.id, title: e.title, publish_date: e.publish_date ?? null })),
    gyms_visited: d.gyms.filter((g) => inMonth(g.visit_date, month)).map((g) => ({ id: g.id, name: g.name, visit_date: g.visit_date ?? null })),
    workouts: { count: workouts.length, minutes: workouts.reduce((a, w) => a + (w.duration_min ?? 0), 0) },
    body: { weight_start: logs[0]?.weight ?? null, weight_end: logs[logs.length - 1]?.weight ?? null, logs: d.bodyLogs.filter((b) => inMonth(b.day, month)).length },
    money: { income, expenses, net: income - expenses, content_expenses: content, currency: d.currency },
    goals: { total: goals.length, done: goals.filter((g) => g.status === 'logrado').length, pending: goals.filter((g) => g.status === 'pendiente' || g.status === 'en_progreso').length, items: goals.map((g) => ({ id: g.id, title: g.title, status: g.status })) },
  };
}

/** Objetivos que se pueden transferir al mes siguiente (pendientes o en progreso). */
export function transferableGoals(goals: Goal[], month: string): Goal[] {
  return goals.filter((g) => g.month === month && (g.status === 'pendiente' || g.status === 'en_progreso'));
}

export function yearSummary(months: Month[], year: number) {
  const reports = months.filter((m) => m.month.startsWith(`${year}-`) && m.report).map((m) => m.report as MonthReport).sort((a, b) => a.month.localeCompare(b.month));
  const firstF = reports.find((r) => r.followers.start !== null)?.followers.start ?? null;
  const lastF = [...reports].reverse().find((r) => r.followers.end !== null)?.followers.end ?? null;
  const sum = (f: (r: MonthReport) => number) => reports.reduce((a, r) => a + f(r), 0);
  const bestMonth = [...reports].filter((r) => r.followers.delta !== null).sort((a, b) => b.followers.delta! - a.followers.delta!)[0] ?? null;
  return {
    reports, closedMonths: reports.length, followersStart: firstF, followersEnd: lastF, followersDelta: firstF !== null && lastF !== null ? lastF - firstF : null,
    reach: sum((r) => r.account.reach?.value ?? 0), views: sum((r) => r.account.views?.value ?? 0), posts: sum((r) => r.posts_published),
    episodes: sum((r) => r.episodes_published.length), gyms: sum((r) => r.gyms_visited.length), workouts: sum((r) => r.workouts.count),
    income: sum((r) => r.money.income), expenses: sum((r) => r.money.expenses), goalsDone: sum((r) => r.goals.done), bestMonth,
    topPosts: reports.flatMap((r) => r.top_posts).sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0)).slice(0, 6),
  };
}
