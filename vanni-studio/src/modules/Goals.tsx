import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTable } from '../lib/store';
import { Chips, DateField, Empty, NumberField, PageHeader, Progress, Select, SourceBadge, TagInput, TextArea, TextField } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { confirmAction } from '../components/toast';
import { GOAL_AREAS, GOAL_METRICS, GOAL_STATUSES } from '../lib/constants';
import { goalProgress, type GoalContext } from '../lib/goals';
import { currentMonth, monthLabel } from '../lib/dates';
import { n1 } from '../lib/format';
import { useCategoryOptions } from './shared';
import type { Goal } from '../lib/types';

export function useGoalContext(): GoalContext {
  const account = useTable('ig_accounts').rows[0];
  const manual = useTable('manual_metrics').rows;
  const workouts = useTable('workouts').rows;
  const episodes = useTable('episodes').rows;
  const logs = useTable('body_logs').rows;
  const gyms = useTable('gyms').rows;
  const tx = useTable('transactions').rows;
  return useMemo(() => {
    const m = currentMonth();
    const manualFollowers = [...manual].filter((x) => x.metric === 'followers').sort((a, b) => b.day.localeCompare(a.day))[0]?.value ?? null;
    return {
      followers: account?.followers_count ?? manualFollowers,
      workoutsThisMonth: workouts.filter((w) => w.day.startsWith(m)).length,
      episodesPublished: episodes.filter((e) => e.status === 'publicado' || e.status === 'analizado').length,
      latestWeight: [...logs].filter((l) => l.weight).sort((a, b) => b.day.localeCompare(a.day))[0]?.weight ?? null,
      gymsVisited: gyms.filter((g) => g.status !== 'pendiente').length,
      incomeThisMonth: tx.filter((t) => t.kind === 'ingreso' && t.day.startsWith(m)).reduce((a, t) => a + Number(t.amount), 0),
    };
  }, [account, manual, workouts, episodes, logs, gyms, tx]);
}

export function GoalCard({ g, onOpen }: { g: Goal; onOpen: () => void }) {
  const ctx = useGoalContext();
  const p = goalProgress(g, ctx);
  return (
    <button type="button" className="card tight stack tight" style={{ textAlign: 'left', cursor: 'pointer', color: 'inherit' }} onClick={onOpen}>
      <div className="row between"><span className="badge">{GOAL_AREAS.find((a) => a.key === g.area)?.label ?? g.area}</span><span className={`badge ${g.status === 'logrado' ? 'accent' : ''}`}>{GOAL_STATUSES.find((s) => s.key === g.status)?.label}</span></div>
      <b>{g.title || 'Objetivo sin título'}</b>
      {p.target !== null && <><Progress value={p.pct} /><span className="xs faint num">{p.current !== null ? n1(p.current) : '—'} / {n1(p.target)} {g.unit ?? ''} {p.auto && <SourceBadge kind="calc" />}</span></>}
      <span className="xs faint">{g.month ? monthLabel(g.month) : 'Sin mes'}{g.due_date ? ` · vence ${g.due_date}` : ''}</span>
    </button>
  );
}

export function GoalSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useTable('goals');
  const areas = useCategoryOptions('goals', GOAL_AREAS);
  const g = id ? t.byId.get(id) : undefined;
  if (!g) return null;
  const set = (patch: Partial<Goal>) => t.update(g.id, patch);
  return (
    <Sheet open={!!g} onClose={onClose} title="Objetivo" footer={<><button className="btn danger" type="button" onClick={() => { if (confirmAction('¿Eliminar este objetivo?')) { t.remove(g.id); onClose(); } }}><Trash2 size={15} />Eliminar</button><button className="btn primary" type="button" onClick={onClose}>Listo</button></>}>
      <div className="stack">
        <TextField label="Objetivo" value={g.title} onChange={(v) => set({ title: v })} />
        <TextArea label="Descripción" value={g.description} onChange={(v) => set({ description: v })} rows={2} />
        <div className="form-grid two">
          <Select label="Área" value={g.area} onChange={(v) => set({ area: v })} options={areas} />
          <Select label="Estado" value={g.status} onChange={(v) => set({ status: v, completed_at: v === 'logrado' ? new Date().toISOString() : null })} options={GOAL_STATUSES.map((s) => ({ value: s.key, label: s.label }))} />
          <Select className="span-2" label="Medición" value={g.metric} onChange={(v) => set({ metric: v })} options={GOAL_METRICS.map((m) => ({ value: m.key, label: m.label }))} />
          <NumberField label="Valor inicial" value={g.start_value} onChange={(v) => set({ start_value: v })} />
          <NumberField label="Meta" value={g.target_value} onChange={(v) => set({ target_value: v })} />
          {g.metric === 'manual' && <NumberField label="Avance actual" value={g.current_value} onChange={(v) => set({ current_value: v })} />}
          <TextField label="Unidad" value={g.unit} onChange={(v) => set({ unit: v })} placeholder="seguidores, kg, episodios…" />
          <DateField label="Mes del Journey" type="month" value={g.month} onChange={(v) => set({ month: v })} />
          <DateField label="Fecha límite" value={g.due_date} onChange={(v) => set({ due_date: v })} />
        </div>
        <TagInput value={g.tags} onChange={(v) => set({ tags: v })} />
      </div>
    </Sheet>
  );
}

export function GoalsPage() {
  const t = useTable('goals');
  const [filter, setFilter] = useState('abiertos');
  const [area, setArea] = useState('all');
  const [open, setOpen] = useState<string | null>(null);
  const list = t.rows.filter((g) => (filter === 'todos' || (filter === 'abiertos' ? ['pendiente', 'en_progreso'].includes(g.status) : g.status === filter)) && (area === 'all' || g.area === area)).sort((a, b) => a.priority - b.priority || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  const add = () => setOpen(t.insert({ title: '', area: area === 'all' ? 'personal' : area, metric: 'manual', status: 'pendiente', priority: 2, month: currentMonth(), sort: t.rows.length }).id);
  return (
    <div>
      <PageHeader eyebrow="Metas personalizadas" title="Objetivos" description="Instagram, contenido, físico, personal o lo que quieras medir. Los ligados a datos reales se actualizan solos." actions={<button className="btn primary" type="button" onClick={add}><Plus size={16} />Objetivo</button>} />
      <div className="stack" style={{ marginBottom: 14 }}>
        <Chips value={filter} onChange={setFilter} options={[{ value: 'abiertos', label: 'Abiertos' }, { value: 'logrado', label: 'Logrados' }, { value: 'transferido', label: 'Transferidos' }, { value: 'todos', label: 'Todos' }]} />
        <Chips scroll value={area} onChange={setArea} options={[{ value: 'all', label: 'Todas las áreas' }, ...GOAL_AREAS.map((a) => ({ value: a.key, label: a.label }))]} />
      </div>
      {list.length ? <div className="grid auto">{list.map((g) => <GoalCard key={g.id} g={g} onOpen={() => setOpen(g.id)} />)}</div> : <Empty title="Sin objetivos aquí" action={<button className="btn primary" type="button" onClick={add}>Crear objetivo</button>} />}
      <GoalSheet id={open} onClose={() => setOpen(null)} />
    </div>
  );
}
