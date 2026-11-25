import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Flame, Settings2 } from 'lucide-react';
import { useTable } from '../lib/store';
import { Card, Empty, Kpi, Progress, SourceBadge } from '../components/ui';
import { LineChart, Sparkline } from '../components/charts';
import { useProfile, widgetConfig } from '../lib/profile';
import { addDays, dayLabel, dayOfInstant, today, timeOfInstant, weekStart } from '../lib/dates';
import { dailySeries, growth, mediaMetric, periodChange } from '../lib/analytics';
import { expandEvents } from '../lib/recurrence';
import { productiveDays, streaks } from '../lib/streak';
import { goalProgress } from '../lib/goals';
import { metricLabel, stageLabel } from '../lib/constants';
import { money, n1, short, signed, signedPct, trendClass } from '../lib/format';
import { ConnectionCard } from './Instagram';
import { InsightCard, useAnalysis } from './Analysis';
import { MediaThumb } from './shared';
import { useGoalContext } from './Goals';
import { useBudget } from './Finance';
import { useEventColors } from './Agenda';
import { TaskRow } from './Tasks';

function InstagramWidget() {
  const a = useAnalysis();
  const g = growth(a.followers);
  const last30 = a.followers.slice(-30).map((p) => p.followers);
  if (!a.account || a.account.status === 'disconnected') return <ConnectionCard compact />;
  return (
    <section className="stack">
      <div className="grid kpis">
        <div className="card tight kpi"><div className="kpi-label">Seguidores <SourceBadge kind="real" /></div><div className="row between"><span className="kpi-value">{short(a.account.followers_count)}</span><Sparkline values={last30} label="Tendencia de seguidores 30 días" /></div><span className={`kpi-delta ${trendClass(g[0].delta)}`}>{signed(g[0].delta)} hoy</span></div>
        {g.slice(1).map((x) => <Kpi key={x.days} label={`Crecimiento ${x.label.toLowerCase()}`} value={signed(x.delta)} deltaClass={trendClass(x.delta)} delta={signedPct(x.pct)} sub={x.delta !== null && !x.complete ? `desde ${x.from?.day}` : undefined} />)}
      </div>
      {a.account.status !== 'connected' && <ConnectionCard compact />}
    </section>
  );
}

function PerformanceWidget() {
  const insights = useTable('ig_account_insights').rows;
  const [metric, setMetric] = useState('reach');
  const end = today();
  const from = addDays(end, -29);
  const labels = Array.from({ length: 30 }, (_, i) => dayLabel(addDays(from, i)));
  return (
    <Card title="Alcance, reproducciones e interacciones" action={<Link to="/instagram" className="btn sm ghost">Detalle <ArrowRight size={14} /></Link>}>
      <div className="grid kpis" style={{ marginBottom: 12 }}>
        {['reach', 'views', 'total_interactions', 'accounts_engaged'].map((m) => { const c = periodChange(insights, m, 28); return <button key={m} type="button" className={`card tight kpi ${metric === m ? 'selected' : ''}`} style={{ textAlign: 'left', cursor: 'pointer', color: 'inherit', borderColor: metric === m ? 'var(--accent-line)' : undefined }} onClick={() => setMetric(m)}><span className="kpi-label">{metricLabel(m)} · 28 d</span><span className="kpi-value sm">{c.current.days ? short(c.current.value) : '—'}</span><span className={`kpi-delta ${trendClass(c.change)}`}>{c.change !== null ? signedPct(c.change) : 'sin comparativa'}</span></button>; })}
      </div>
      <LineChart ariaLabel={`${metricLabel(metric)}, últimos 30 días frente a los 30 anteriores`} labels={labels} table={false}
        series={[{ key: 'c', label: 'Últimos 30 días', color: 'var(--accent)', values: dailySeries(insights, metric, from, end).map((x) => x.value) }, { key: 'p', label: '30 días anteriores', color: 'var(--text-3)', dashed: true, values: dailySeries(insights, metric, addDays(from, -30), addDays(from, -1)).map((x) => x.value) }]} />
    </Card>
  );
}

function TopPostsWidget() {
  const a = useAnalysis();
  const since = addDays(today(), -45);
  const top = a.media.filter((m) => !m.is_story && m.posted_at && dayOfInstant(m.posted_at) >= since).sort((x, y) => (mediaMetric(y, 'reach') ?? -1) - (mediaMetric(x, 'reach') ?? -1)).slice(0, 4);
  return (
    <Card title="Rendimiento de publicaciones" action={<Link to="/analisis" className="btn sm ghost">Análisis <ArrowRight size={14} /></Link>}>
      {top.length ? <div className="list" style={{ marginBottom: 12 }}>{top.map((m) => <Link key={m.id} to="/instagram/publicaciones" className="list-item"><MediaThumb m={m} size={44} /><span className="grow small truncate">{m.caption || 'Sin texto'}</span><span className="xs num">{short(mediaMetric(m, 'reach'))} alc.</span></Link>)}</div> : <p className="muted small">Sin publicaciones recientes con métricas.</p>}
      <div className="grid auto">{a.insights.filter((i) => i.id !== 'no-data').slice(0, 2).map((i) => <InsightCard key={i.id} i={i} />)}</div>
    </Card>
  );
}

function SeriesWidget() {
  const series = useTable('series').rows.filter((s) => s.status === 'activa').sort((a, b) => a.sort - b.sort);
  const episodes = useTable('episodes').rows;
  return (
    <Card title="Series activas" action={<Link to="/series" className="btn sm ghost">Ver <ArrowRight size={14} /></Link>}>
      {series.length ? <div className="stack">{series.slice(0, 6).map((s) => { const eps = episodes.filter((e) => e.series_id === s.id); const pub = eps.filter((e) => ['publicado', 'analizado'].includes(e.status)).length; const next = eps.filter((e) => !['publicado', 'analizado'].includes(e.status)).sort((a, b) => (a.record_date ?? '9').localeCompare(b.record_date ?? '9'))[0]; return <Link key={s.id} to={`/series/${s.id}`} className="stack tight" style={{ textDecoration: 'none' }}><div className="row between"><span className="row small" style={{ gap: 8 }}><span className="dot" style={{ background: s.color ?? 'var(--accent)' }} /><b className="truncate">{s.title}</b></span><span className="xs faint">{pub}/{eps.length}</span></div><Progress value={eps.length ? pub / eps.length : 0} thin />{next && <span className="xs faint">Siguiente: {next.title} · {stageLabel(next.status)}</span>}</Link>; })}</div> : <Empty title="Sin series activas" />}
    </Card>
  );
}

function RecordingsWidget() {
  const events = useTable('events').rows;
  const episodes = useTable('episodes').rows;
  const t0 = today();
  const occ = expandEvents(events.filter((e) => e.category === 'grabacion'), t0, addDays(t0, 30)).filter((o) => !o.done);
  const linked = new Set(events.filter((e) => e.linked_type === 'episode' && e.category === 'grabacion').map((e) => e.linked_id));
  const eps = episodes.filter((e) => e.record_date && e.record_date >= t0 && !linked.has(e.id));
  const items = [...occ.map((o) => ({ key: o.key, day: o.day, title: o.event.title, sub: o.event.location ?? '', to: o.event.linked_type === 'episode' ? `/episodios/${o.event.linked_id}` : '/agenda' })), ...eps.map((e) => ({ key: e.id, day: e.record_date!, title: e.title, sub: e.location ?? '', to: `/episodios/${e.id}` }))].sort((a, b) => a.day.localeCompare(b.day)).slice(0, 5);
  return (
    <Card title="Próximas grabaciones" action={<Link to="/produccion" className="btn sm ghost">Producción <ArrowRight size={14} /></Link>}>
      {items.length ? <div className="list">{items.map((i) => <Link key={i.key} to={i.to} className="list-item"><span className="badge accent">{dayLabel(i.day)}</span><span className="grow small truncate">{i.title}</span><span className="xs faint truncate" style={{ maxWidth: 120 }}>{i.sub}</span></Link>)}</div> : <p className="muted small" style={{ margin: 0 }}>Nada agendado en los próximos 30 días.</p>}
    </Card>
  );
}

function GoalsWidget() {
  const goals = useTable('goals').rows.filter((g) => ['pendiente', 'en_progreso'].includes(g.status)).sort((a, b) => a.priority - b.priority || (a.due_date ?? '9').localeCompare(b.due_date ?? '9')).slice(0, 5);
  const ctx = useGoalContext();
  return (
    <Card title="Objetivos pendientes" action={<Link to="/objetivos" className="btn sm ghost">Ver <ArrowRight size={14} /></Link>}>
      {goals.length ? <div className="stack">{goals.map((g) => { const p = goalProgress(g, ctx); return <div key={g.id} className="stack tight"><div className="row between small"><span className="truncate">{g.title || 'Sin título'}</span><span className="xs faint num">{p.pct !== null ? `${Math.round(p.pct * 100)} %` : ''}</span></div>{p.pct !== null && <Progress value={p.pct} thin />}</div>; })}</div> : <p className="muted small" style={{ margin: 0 }}>Sin objetivos abiertos.</p>}
    </Card>
  );
}

function AgendaWidget() {
  const events = useTable('events').rows;
  const colors = useEventColors();
  const t0 = today();
  const occ = expandEvents(events, t0, addDays(t0, 6)).filter((o) => o.event.status !== 'cancelado');
  const todays = occ.filter((o) => o.day === t0);
  return (
    <Card title="Hoy y esta semana" action={<Link to="/agenda" className="btn sm ghost">Agenda <ArrowRight size={14} /></Link>}>
      {todays.length ? <div className="stack tight">{todays.map((o) => <Link key={o.key} to={`/agenda?v=dia&d=${t0}`} className={`event-pill ${o.done ? 'done' : ''}`} style={{ ['--ev' as string]: colors.color(o.event.category, o.event.color), textDecoration: 'none' }}><span className="xs faint num" style={{ minWidth: 40 }}>{o.event.all_day ? 'Día' : timeOfInstant(o.start)}</span><span className="small">{o.event.title}</span></Link>)}</div> : <p className="muted small" style={{ margin: 0 }}>Sin actividades hoy.</p>}
      <p className="xs faint" style={{ marginBottom: 0 }}>{occ.length - todays.length} actividades más en los próximos 6 días.</p>
    </Card>
  );
}

function BodyWidget() {
  const logs = useTable('body_logs').rows;
  const workouts = useTable('workouts').rows;
  const w = [...logs].filter((l) => l.weight).sort((a, b) => a.day.localeCompare(b.day));
  const last = w.at(-1);
  const ref = [...w].reverse().find((l) => l.day <= addDays(today(), -30));
  const week = workouts.filter((x) => x.day >= weekStart(today())).length;
  return (
    <Card title="Progreso físico" action={<Link to="/evolucion" className="btn sm ghost">Diario <ArrowRight size={14} /></Link>}>
      <div className="row between"><div className="kpi"><span className="kpi-label">Peso actual</span><span className="kpi-value sm">{last ? `${n1(last.weight)} kg` : '—'}</span>{last && ref && <span className={`kpi-delta ${trendClass(-(last.weight! - ref.weight!))}`}>{last.weight! - ref.weight! > 0 ? '+' : ''}{n1(last.weight! - ref.weight!)} kg en 30 d</span>}</div><Sparkline values={w.slice(-30).map((l) => l.weight!)} label="Tendencia de peso" /></div>
      <p className="small" style={{ marginBottom: 0 }}><b>{week}</b> entrenamientos esta semana</p>
    </Card>
  );
}

function BudgetWidget() {
  const b = useBudget();
  const { currency } = useProfile();
  return (
    <Card title="Presupuesto para contenido" action={<Link to="/finanzas" className="btn sm ghost">Finanzas <ArrowRight size={14} /></Link>}>
      {b.budget !== null ? <div className="stack tight"><div className="row between"><span className="kpi-value sm">{money(b.spent, currency)}</span><span className="xs faint">de {money(b.budget, currency)}</span></div><Progress value={b.spent / Math.max(1, b.budget)} /><span className={`xs ${b.remaining! < 0 ? 'down' : 'faint'}`}>{b.remaining! >= 0 ? `Disponible: ${money(b.remaining, currency)}` : `Excedido por ${money(-b.remaining!, currency)}`}</span></div> : <p className="muted small" style={{ margin: 0 }}>Define tu presupuesto mensual en Finanzas.</p>}
    </Card>
  );
}

function StreakWidget() {
  const tasks = useTable('tasks').rows, workouts = useTable('workouts').rows, events = useTable('events').rows, ideas = useTable('ideas').rows, logs = useTable('body_logs').rows, episodes = useTable('episodes').rows;
  const s = useMemo(() => {
    const eventsDone = [...events.filter((e) => !e.recurrence && e.status === 'hecho').map((e) => dayOfInstant(e.start_at)), ...events.flatMap((e) => e.done_dates ?? [])];
    return streaks(productiveDays({ tasksDone: tasks.filter((t) => t.done), workouts, eventsDone, ideasCreated: ideas, bodyLogs: logs, episodesPublished: episodes.filter((e) => e.status === 'publicado' || e.status === 'analizado') }));
  }, [tasks, workouts, events, ideas, logs, episodes]);
  return (
    <Card title="Racha de productividad">
      <div className="row between"><div className="row"><Flame size={28} color={s.current ? 'var(--accent)' : 'var(--text-3)'} /><span className="kpi-value">{s.current}</span><span className="small muted">días</span></div><span className="xs faint">Mejor racha: {s.best} · {s.activeDays30}/30 días activos</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(14, 1fr)', gap: 3, marginTop: 12 }}>{s.last28.map((d) => <span key={d.day} title={`${d.day}: ${d.count} acciones`} style={{ aspectRatio: '1', borderRadius: 3, background: d.count ? `color-mix(in oklab, var(--accent) ${Math.min(90, 30 + d.count * 15)}%, var(--surface-3))` : 'var(--surface-4)' }} />)}</div>
      <p className="xs faint" style={{ marginBottom: 0 }}>Cuenta tareas completadas, entrenamientos, eventos hechos, ideas, registros del diario y episodios publicados.</p>
    </Card>
  );
}

function TasksWidget() {
  const t0 = today();
  const tasks = useTable('tasks').rows.filter((t) => !t.done && (!t.due_date || t.due_date <= addDays(t0, 2))).sort((a, b) => a.priority - b.priority || (a.due_date ?? '9').localeCompare(b.due_date ?? '9')).slice(0, 6);
  return <Card title="Tareas" action={<Link to="/tareas" className="btn sm ghost">Todas <ArrowRight size={14} /></Link>}>{tasks.length ? <div className="list">{tasks.map((t) => <TaskRow key={t.id} t={t} />)}</div> : <p className="muted small" style={{ margin: 0 }}>Sin tareas urgentes.</p>}</Card>;
}

function IdeasWidget() {
  const ideas = useTable('ideas').rows.filter((i) => !['usada', 'descartada'].includes(i.status)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.created_at ?? '').localeCompare(a.created_at ?? '')).slice(0, 4);
  return <Card title="Ideas recientes" action={<Link to="/laboratorio" className="btn sm ghost">Laboratorio <ArrowRight size={14} /></Link>}>{ideas.length ? <div className="list">{ideas.map((i) => <Link key={i.id} className="list-item" to={`/laboratorio/${i.id}`}><span className="grow small truncate">{i.title || 'Sin título'}</span></Link>)}</div> : <p className="muted small" style={{ margin: 0 }}>Captura ideas con el botón «+».</p>}</Card>;
}

function TrackersWidget() {
  const cols = useTable('collections').rows.filter((c) => c.kind === 'tracker');
  const items = useTable('collection_items').rows;
  if (!cols.length) return null;
  return <Card title="Seguimientos personalizados">{cols.map((c) => <Link key={c.id} to={`/colecciones/${c.id}`} className="row between small" style={{ padding: '6px 0', textDecoration: 'none' }}><span>{c.name}</span><span className="xs faint">{items.filter((i) => i.collection_id === c.id && i.day === today()).length} registros hoy</span></Link>)}</Card>;
}

const RENDER: Record<string, () => React.ReactNode> = {
  instagram: () => <InstagramWidget />, performance: () => <PerformanceWidget />, top_posts: () => <TopPostsWidget />, series: () => <SeriesWidget />,
  recordings: () => <RecordingsWidget />, goals: () => <GoalsWidget />, agenda: () => <AgendaWidget />, body: () => <BodyWidget />, budget: () => <BudgetWidget />,
  streak: () => <StreakWidget />, tasks: () => <TasksWidget />, ideas: () => <IdeasWidget />, trackers: () => <TrackersWidget />,
};
const FULL = new Set(['instagram', 'performance', 'top_posts']);

export function DashboardPage() {
  const { profile, settings } = useProfile();
  const widgets = widgetConfig(settings).filter((w) => w.visible);
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  return (
    <div>
      <header className="page-header">
        <div className="titles"><div className="eyebrow">{dayLabel(today(), { weekday: true, year: true })}</div><h1>{hello}, {profile?.display_name ?? 'VANNI'}</h1><p className="motto" style={{ marginTop: 8 }}>Build yourself. Build your legacy.</p></div>
        <Link to="/ajustes" className="btn sm ghost" aria-label="Configurar widgets"><Settings2 size={16} />Widgets</Link>
      </header>
      <div className="stack" style={{ gap: 14 }}>
        {widgets.filter((w) => FULL.has(w.key)).map((w) => <div key={w.key}>{RENDER[w.key]()}</div>)}
        <div className="grid halves" style={{ gap: 14 }}>
          {widgets.filter((w) => !FULL.has(w.key)).map((w) => <div key={w.key}>{RENDER[w.key]()}</div>)}
        </div>
      </div>
    </div>
  );
}
