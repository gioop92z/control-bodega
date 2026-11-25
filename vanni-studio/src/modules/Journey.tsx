import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowRight, BookOpen, ChevronLeft, Lock, Plus } from 'lucide-react';
import { useTable } from '../lib/store';
import { Card, Empty, Kpi, NumberField, PageHeader, SourceBadge, TextArea, TextField } from '../components/ui';
import { BarChart, LineChart } from '../components/charts';
import { Attachments } from '../components/Attachments';
import { useToast, confirmAction } from '../components/toast';
import { buildMonthReport, transferableGoals, yearSummary, type MonthReport } from '../lib/journey';
import { currentMonth, monthLabel, MONTHS_SHORT, relativeTime, shiftMonth } from '../lib/dates';
import { CONTENT_EXPENSE_CATEGORIES, metricLabel } from '../lib/constants';
import { money, n, pct, signed, signedPct, trendClass } from '../lib/format';
import { useProfile } from '../lib/profile';
import { uuid } from '../lib/ids';
import { GoalCard, GoalSheet } from './Goals';
import type { Goal, Month } from '../lib/types';

export function useMonthData() {
  const { currency } = useProfile();
  const snapshots = useTable('ig_profile_snapshots').rows, insights = useTable('ig_account_insights').rows, media = useTable('ig_media').rows;
  const manual = useTable('manual_metrics').rows, episodes = useTable('episodes').rows, gyms = useTable('gyms').rows, workouts = useTable('workouts').rows;
  const bodyLogs = useTable('body_logs').rows, transactions = useTable('transactions').rows, goals = useTable('goals').rows;
  return useMemo(() => ({ snapshots, insights, media, manual, episodes, gyms, workouts, bodyLogs, transactions, goals, currency, contentCategories: CONTENT_EXPENSE_CATEGORIES }), [snapshots, insights, media, manual, episodes, gyms, workouts, bodyLogs, transactions, goals, currency]);
}

export function ReportView({ r, live }: { r: MonthReport; live?: boolean }) {
  const src = r.followers.source === 'instagram' ? 'real' : r.followers.source === 'manual' ? 'manual' : 'na';
  return (
    <div className="stack">
      {live ? <p className="xs faint" style={{ margin: 0 }}>Vista previa en vivo: se congela al cerrar el mes.</p> : <p className="xs faint" style={{ margin: 0 }}><Lock size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> Informe generado {relativeTime(r.generated_at)} con los registros y estadísticas de ese momento.</p>}
      <div className="grid kpis">
        <Kpi label="Seguidores inicio → fin" value={r.followers.end !== null ? n(r.followers.end) : '—'} source={src} sub={r.followers.start !== null ? `Inicio ${n(r.followers.start)}` : undefined} />
        <Kpi label="Crecimiento real" value={signed(r.followers.delta)} deltaClass={trendClass(r.followers.delta)} delta={signedPct(r.followers.pct)} source={src} />
        <Kpi label="Alcance del mes" value={r.account.reach ? n(r.account.reach.value) : '—'} source={r.account.reach ? 'real' : 'na'} sub={r.account.reach ? `${r.account.reach.days} días con datos` : undefined} />
        <Kpi label="Reproducciones" value={r.account.views ? n(r.account.views.value) : '—'} source={r.account.views ? 'real' : 'na'} />
      </div>
      <div className="grid kpis">
        <Kpi label="Publicaciones" value={r.posts_published} />
        <Kpi label="Episodios publicados" value={r.episodes_published.length} />
        <Kpi label="Gimnasios visitados" value={r.gyms_visited.length} />
        <Kpi label="Entrenamientos" value={r.workouts.count} sub={r.workouts.minutes ? `${r.workouts.minutes} min` : undefined} />
      </div>
      <div className="grid kpis">
        <Kpi label="Ingresos" value={money(r.money.income, r.money.currency)} />
        <Kpi label="Gastos" value={money(r.money.expenses, r.money.currency)} sub={`Contenido: ${money(r.money.content_expenses, r.money.currency)}`} />
        <Kpi label="Balance" value={money(r.money.net, r.money.currency)} deltaClass={trendClass(r.money.net)} />
        <Kpi label="Objetivos logrados" value={`${r.goals.done}/${r.goals.total}`} />
      </div>
      {Object.keys(r.account).length > 2 && <div className="chips">{Object.entries(r.account).map(([k, v]) => <span key={k} className="tag">{metricLabel(k)}: <b className="num">{n(v.value)}</b></span>)}</div>}
      {r.top_posts.length > 0 && (
        <Card title="Publicaciones con mejor rendimiento">
          <div className="list">{r.top_posts.map((p) => <a key={p.ig_media_id} className="list-item" href={p.permalink ?? '#'} target="_blank" rel="noreferrer">{p.thumbnail ? <img className="thumb" src={p.thumbnail} alt="" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} /> : <span className="thumb" />}<span className="grow small truncate">{p.caption || 'Sin texto'}</span><span className="xs num">{n(p.reach)} alc. · {pct(p.er)}</span></a>)}</div>
        </Card>
      )}
      {(r.episodes_published.length > 0 || r.gyms_visited.length > 0) && (
        <div className="grid halves">
          {r.episodes_published.length > 0 && <Card title="Episodios">{r.episodes_published.map((e) => <div key={e.id} className="small"><Link to={`/episodios/${e.id}`}>{e.title}</Link> · {e.publish_date}</div>)}</Card>}
          {r.gyms_visited.length > 0 && <Card title="Gimnasios">{r.gyms_visited.map((g) => <div key={g.id} className="small"><Link to={`/gimnasios/${g.id}`}>{g.name}</Link> · {g.visit_date}</div>)}</Card>}
        </div>
      )}
    </div>
  );
}

export function JourneyPage() {
  const months = useTable('months');
  const navigate = useNavigate();
  const cm = currentMonth();
  const list = [...months.rows].sort((a, b) => b.month.localeCompare(a.month));
  const open = (m: string) => { if (!months.rows.some((x) => x.month === m)) months.insert({ month: m, status: 'abierto', addenda: [] }); navigate(`/journey/${m}`); };
  const years = [...new Set([cm.slice(0, 4), ...list.map((m) => m.month.slice(0, 4))])].sort().reverse();
  return (
    <div>
      <PageHeader eyebrow="The VANNI Journey" title="Capítulos" description="Cada mes es un capítulo de tu historia. Al cerrarlo se genera un informe con tus registros y estadísticas reales, y queda guardado sin sobrescribirse." actions={<>{years.map((y) => <Link key={y} className="btn" to={`/journey/anual/${y}`}>Retrospectiva {y}</Link>)}</>} />
      {!list.some((m) => m.month === cm) && <button className="card link row" type="button" style={{ width: '100%', marginBottom: 12, cursor: 'pointer', color: 'inherit' }} onClick={() => open(cm)}><BookOpen size={20} color="var(--accent)" /><span className="grow" style={{ textAlign: 'left' }}><b>Abrir el capítulo de {monthLabel(cm)}</b><br /><span className="xs faint">Define objetivos y documenta el mes.</span></span><ArrowRight size={18} /></button>}
      {list.length ? <div className="grid auto">{list.map((m) => {
        const r = m.report as MonthReport | null;
        return (
          <Link key={m.id} to={`/journey/${m.month}`} className="card link stack tight">
            <div className="row between"><span className="kicker">{m.month}</span>{m.status === 'cerrado' ? <span className="badge"><Lock size={11} />Cerrado</span> : <span className="badge accent">En curso</span>}</div>
            <h3 style={{ textTransform: 'capitalize' }}>{m.title || monthLabel(m.month)}</h3>
            {r ? <span className="small"><b className={trendClass(r.followers.delta)}>{signed(r.followers.delta)}</b> seguidores · {r.posts_published} publicaciones · {r.workouts.count} entrenos</span> : <span className="small muted clamp-2">{m.objectives || 'Sin objetivos escritos todavía.'}</span>}
          </Link>
        );
      })}</div> : <Empty title="Tu historia empieza aquí" action={<button className="btn primary" type="button" onClick={() => open(cm)}>Abrir capítulo</button>} />}
      <p className="xs faint" style={{ marginTop: 16 }}>¿Te faltó un mes anterior? <button className="btn ghost sm" type="button" onClick={() => { const m = window.prompt('Mes (AAAA-MM)', shiftMonth(cm, -1)); if (m && /^\d{4}-\d{2}$/.test(m)) open(m); }}><Plus size={13} />Crear capítulo de otro mes</button></p>
    </div>
  );
}

export function MonthPage() {
  const { month = currentMonth() } = useParams();
  const months = useTable('months');
  const goalsT = useTable('goals');
  const data = useMonthData();
  const toast = useToast();
  const [goalOpen, setGoalOpen] = useState<string | null>(null);
  const [addendum, setAddendum] = useState('');
  const m = months.rows.find((x) => x.month === month);
  const live = useMemo(() => buildMonthReport(month, data), [month, data]);
  if (!m) return months.ready ? <Empty title="Capítulo no encontrado" action={<Link className="btn" to="/journey">Volver</Link>} /> : null;
  const closed = m.status === 'cerrado';
  const set = (patch: Partial<Month>) => months.update(m.id, patch);
  const goals = goalsT.rows.filter((g) => g.month === month);
  const pending = transferableGoals(goalsT.rows, month);
  const prevPending = transferableGoals(goalsT.rows, shiftMonth(month, -1));
  const transfer = (list: Goal[], to: string) => {
    for (const g of list) {
      const { id: _id, created_at: _c, updated_at: _u, user_id: _uid, ...rest } = g;
      goalsT.insert({ ...rest, month: to, status: 'pendiente', carried_from: g.id, completed_at: null } as Partial<Goal>);
      goalsT.update(g.id, { status: 'transferido' });
    }
    toast(`${list.length} objetivo(s) transferido(s) a ${monthLabel(to)}`, 'success');
  };
  const close = () => {
    if (!confirmAction(`¿Cerrar ${monthLabel(month)}? El informe se congelará con los datos actuales y los textos quedarán protegidos. Podrás agregar complementos.`)) return;
    set({ report: buildMonthReport(month, data), status: 'cerrado', closed_at: new Date().toISOString() });
    if (pending.length && confirmAction(`Hay ${pending.length} objetivo(s) pendiente(s). ¿Transferirlos a ${monthLabel(shiftMonth(month, 1))}?`)) transfer(pending, shiftMonth(month, 1));
    toast('Mes cerrado. Informe guardado.', 'success');
  };
  const fields: Array<[keyof Month, string]> = [['objectives', 'Objetivos del mes'], ['achievements', 'Logros personales'], ['difficulties', 'Dificultades'], ['learnings', 'Aprendizajes'], ['improvements', 'Aspectos por mejorar'], ['next_strategy', 'Estrategia del siguiente mes']];
  return (
    <div>
      <Link to="/journey" className="btn ghost sm" style={{ marginBottom: 8 }}><ChevronLeft size={16} />Capítulos</Link>
      <PageHeader eyebrow={`Capítulo · ${month}`} title={<span style={{ textTransform: 'capitalize' }}>{m.title || monthLabel(month)}</span>} actions={!closed ? <button className="btn primary" type="button" onClick={close}><Lock size={15} />Cerrar mes</button> : <span className="badge"><Lock size={12} />Cerrado {relativeTime(m.closed_at)}</span>} />
      <div className="stack">
        {!closed ? (
          <>
            <TextField label="Título del capítulo" value={m.title} onChange={(v) => set({ title: v })} placeholder="Ej. El mes de la primera colaboración" />
            <div className="form-grid two">{fields.map(([k, label]) => <TextArea key={k} label={label} value={m[k] as string} onChange={(v) => set({ [k]: v } as Partial<Month>)} rows={3} />)}</div>
            <NumberField label="Presupuesto de contenido del mes" suffix={data.currency} value={m.content_budget} onChange={(v) => set({ content_budget: v })} />
          </>
        ) : (
          <div className="grid halves">{fields.map(([k, label]) => (m[k] ? <Card key={k} title={label}><p className="small pre-wrap" style={{ margin: 0 }}>{m[k] as string}</p></Card> : null))}</div>
        )}

        <Card title="Metas con seguimiento" action={<div className="row">{prevPending.length > 0 && !closed && <button className="btn sm" type="button" onClick={() => transfer(prevPending, month)}>Traer {prevPending.length} pendiente(s) del mes anterior</button>}<button className="btn sm" type="button" onClick={() => setGoalOpen(goalsT.insert({ title: '', area: 'personal', metric: 'manual', status: 'pendiente', priority: 2, month, sort: goals.length }).id)}><Plus size={14} />Objetivo</button></div>}>
          {goals.length ? <div className="grid auto">{goals.map((g) => <GoalCard key={g.id} g={g} onOpen={() => setGoalOpen(g.id)} />)}</div> : <p className="muted small" style={{ margin: 0 }}>Sin objetivos para este mes.</p>}
          {closed && pending.length > 0 && <button className="btn sm" style={{ marginTop: 10 }} type="button" onClick={() => transfer(pending, shiftMonth(month, 1))}>Transferir {pending.length} pendiente(s) a {monthLabel(shiftMonth(month, 1))}</button>}
        </Card>

        <Card title={closed ? 'Informe del mes' : 'Informe (vista previa)'}><ReportView r={closed && m.report ? (m.report as MonthReport) : live} live={!closed} /></Card>
        <Card title="Fotografías destacadas"><Attachments entityType="month" entityId={m.id} kind="highlight" title="Momentos del mes" /></Card>
        {closed && (
          <Card title="Complementos">
            <div className="stack">
              {(m.addenda ?? []).map((a) => <div key={a.id} className="card tight"><span className="xs faint">{new Date(a.at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</span><p className="small pre-wrap" style={{ margin: '4px 0 0' }}>{a.text}</p></div>)}
              <textarea className="textarea" rows={3} value={addendum} onChange={(e) => setAddendum(e.target.value)} placeholder="Algo que quieras añadir a este capítulo sin modificar lo escrito…" />
              <button className="btn" type="button" disabled={!addendum.trim()} onClick={() => { set({ addenda: [...(m.addenda ?? []), { id: uuid(), at: new Date().toISOString(), text: addendum.trim() }] }); setAddendum(''); }}>Agregar complemento</button>
            </div>
          </Card>
        )}
      </div>
      <GoalSheet id={goalOpen} onClose={() => setGoalOpen(null)} />
    </div>
  );
}

export function YearPage() {
  const { year = currentMonth().slice(0, 4) } = useParams();
  const months = useTable('months').rows;
  const data = useMonthData();
  const y = Number(year);
  const summary = useMemo(() => yearSummary(months, y), [months, y]);
  const monthKeys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const reports = monthKeys.map((k) => { const closed = months.find((m) => m.month === k && m.status === 'cerrado')?.report as MonthReport | undefined; return closed ?? (k <= currentMonth() ? buildMonthReport(k, data) : null); });
  const learnings = months.filter((m) => m.month.startsWith(year) && m.learnings).sort((a, b) => a.month.localeCompare(b.month));
  return (
    <div>
      <Link to="/journey" className="btn ghost sm" style={{ marginBottom: 8 }}><ChevronLeft size={16} />Capítulos</Link>
      <PageHeader eyebrow="Retrospectiva anual" title={`${year}`} description={`${summary.closedMonths} meses cerrados. Los meses abiertos se calculan en vivo con tus registros.`} />
      <div className="grid kpis">
        <Kpi label="Seguidores" value={n(reports.filter(Boolean).at(-1)?.followers.end ?? null)} sub={summary.followersStart !== null ? `Inicio del año: ${n(summary.followersStart)}` : undefined} source={reports.some((r) => r?.followers.source === 'instagram') ? 'real' : 'na'} />
        <Kpi label="Alcance del año" value={n(reports.reduce((a, r) => a + (r?.account.reach?.value ?? 0), 0))} source="real" />
        <Kpi label="Publicaciones" value={reports.reduce((a, r) => a + (r?.posts_published ?? 0), 0)} />
        <Kpi label="Entrenamientos" value={reports.reduce((a, r) => a + (r?.workouts.count ?? 0), 0)} />
        <Kpi label="Episodios" value={reports.reduce((a, r) => a + (r?.episodes_published.length ?? 0), 0)} />
        <Kpi label="Gimnasios" value={reports.reduce((a, r) => a + (r?.gyms_visited.length ?? 0), 0)} />
        <Kpi label="Ingresos" value={money(reports.reduce((a, r) => a + (r?.money.income ?? 0), 0), data.currency)} />
        <Kpi label="Gastos" value={money(reports.reduce((a, r) => a + (r?.money.expenses ?? 0), 0), data.currency)} />
      </div>
      <section className="section grid halves">
        <Card title="Seguidores al cierre de cada mes"><LineChart ariaLabel="Seguidores por mes" minZero={false} labels={MONTHS_SHORT} series={[{ key: 'f', label: 'Seguidores', color: 'var(--accent)', values: reports.map((r) => r?.followers.end ?? null) }]} /></Card>
        <Card title="Crecimiento neto por mes"><BarChart ariaLabel="Crecimiento neto por mes" labels={MONTHS_SHORT} values={reports.map((r) => (r?.followers.delta !== null && r?.followers.delta !== undefined ? Math.max(0, r.followers.delta) : null))} seriesLabel="Seguidores ganados" /></Card>
      </section>
      {summary.bestMonth && <Card title="Mejor mes"><p className="small" style={{ margin: 0 }}><b style={{ textTransform: 'capitalize' }}>{monthLabel(summary.bestMonth.month)}</b>: {signed(summary.bestMonth.followers.delta)} seguidores <SourceBadge kind={summary.bestMonth.followers.source === 'instagram' ? 'real' : 'manual'} /></p></Card>}
      {learnings.length > 0 && <section className="section"><h2 style={{ marginBottom: 12 }}>Lo que aprendiste</h2><div className="grid auto">{learnings.map((m) => <Card key={m.id} title={monthLabel(m.month)}><p className="small pre-wrap" style={{ margin: 0 }}>{m.learnings}</p></Card>)}</div></section>}
    </div>
  );
}
