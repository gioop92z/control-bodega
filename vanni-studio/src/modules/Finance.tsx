import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTable } from '../lib/store';
import { Card, Chips, DateField, Empty, Kpi, NumberField, PageHeader, Progress, Select, TextField } from '../components/ui';
import { BarChart } from '../components/charts';
import { Sheet } from '../components/Sheet';
import { CONTENT_EXPENSE_CATEGORIES, TX_CATEGORIES } from '../lib/constants';
import { currentMonth, dayLabel, monthLabel, shiftMonth, today } from '../lib/dates';
import { money } from '../lib/format';
import { useProfile } from '../lib/profile';
import { toCsv, downloadBlob } from '../lib/csv';
import { useCategoryOptions } from './shared';
import type { Transaction } from '../lib/types';

export function useBudget(month = currentMonth()) {
  const months = useTable('months').rows;
  const tx = useTable('transactions').rows;
  const { settings } = useProfile();
  const m = months.find((x) => x.month === month);
  const budget = m?.content_budget ?? settings.monthlyContentBudget ?? null;
  const spent = tx.filter((t) => t.kind === 'gasto' && t.day.startsWith(month) && CONTENT_EXPENSE_CATEGORIES.includes(t.category)).reduce((a, t) => a + Number(t.amount), 0);
  return { budget, spent, remaining: budget !== null ? budget - spent : null };
}

function TxSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useTable('transactions');
  const deals = useTable('deals').rows, series = useTable('series').rows, episodes = useTable('episodes').rows, gyms = useTable('gyms').rows;
  const inc = useCategoryOptions('transactions_ingreso', TX_CATEGORIES.ingreso.map((c) => ({ key: c, label: c })));
  const exp = useCategoryOptions('transactions_gasto', TX_CATEGORIES.gasto.map((c) => ({ key: c, label: c })));
  const x = id ? t.byId.get(id) : undefined;
  if (!x) return null;
  const set = (p: Partial<Transaction>) => t.update(x.id, p);
  return (
    <Sheet open={!!x} onClose={onClose} title={x.kind === 'ingreso' ? 'Ingreso' : 'Gasto'} footer={<><button className="btn danger" type="button" onClick={() => { t.remove(x.id); onClose(); }}><Trash2 size={15} />Eliminar</button><button className="btn primary" type="button" onClick={onClose}>Listo</button></>}>
      <div className="form-grid two">
        <Select label="Tipo" value={x.kind} onChange={(v) => set({ kind: v as Transaction['kind'], category: v === 'ingreso' ? 'patrocinio' : 'produccion' })} options={[{ value: 'ingreso', label: 'Ingreso' }, { value: 'gasto', label: 'Gasto' }]} />
        <DateField label="Fecha" value={x.day} onChange={(v) => v && set({ day: v })} />
        <NumberField label="Monto" suffix={x.currency} value={x.amount} onChange={(v) => set({ amount: v ?? 0 })} />
        <Select label="Categoría" value={x.category} onChange={(v) => set({ category: v })} options={x.kind === 'ingreso' ? inc : exp} />
        <TextField className="span-2" label="Descripción" value={x.description} onChange={(v) => set({ description: v })} />
        <Select label="Colaboración" value={x.deal_id ?? ''} placeholder="—" onChange={(v) => set({ deal_id: v || null })} options={deals.map((d) => ({ value: d.id, label: d.title }))} />
        <Select label="Serie" value={x.series_id ?? ''} placeholder="—" onChange={(v) => set({ series_id: v || null })} options={series.map((s) => ({ value: s.id, label: s.title }))} />
        <Select label="Episodio" value={x.episode_id ?? ''} placeholder="—" onChange={(v) => set({ episode_id: v || null })} options={episodes.map((e) => ({ value: e.id, label: e.title }))} />
        <Select label="Gimnasio" value={x.gym_id ?? ''} placeholder="—" onChange={(v) => set({ gym_id: v || null })} options={gyms.map((g) => ({ value: g.id, label: g.name }))} />
      </div>
    </Sheet>
  );
}

export function FinancePage() {
  const t = useTable('transactions');
  const months = useTable('months');
  const { currency, settings, updateSettings } = useProfile();
  const [month, setMonth] = useState(currentMonth());
  const [kind, setKind] = useState<'all' | 'ingreso' | 'gasto'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const b = useBudget(month);
  const list = t.rows.filter((x) => x.day.startsWith(month) && (kind === 'all' || x.kind === kind)).sort((a, b2) => b2.day.localeCompare(a.day));
  const sum = (k: 'ingreso' | 'gasto') => t.rows.filter((x) => x.day.startsWith(month) && x.kind === k).reduce((a, x) => a + Number(x.amount), 0);
  const last12 = useMemo(() => Array.from({ length: 12 }, (_, i) => shiftMonth(currentMonth(), i - 11)), []);
  const net = last12.map((m) => t.rows.filter((x) => x.day.startsWith(m)).reduce((a, x) => a + (x.kind === 'ingreso' ? 1 : -1) * Number(x.amount), 0));
  const byCat = Object.entries(t.rows.filter((x) => x.day.startsWith(month) && x.kind === 'gasto').reduce<Record<string, number>>((acc, x) => { acc[x.category] = (acc[x.category] ?? 0) + Number(x.amount); return acc; }, {})).sort((a, c) => c[1] - a[1]);
  const add = (k: 'ingreso' | 'gasto') => setOpen(t.insert({ day: month === currentMonth() ? today() : `${month}-01`, kind: k, amount: 0, currency, category: k === 'ingreso' ? 'patrocinio' : 'produccion' }).id);
  const monthRow = months.rows.find((m) => m.month === month);
  return (
    <div>
      <PageHeader eyebrow="Ingresos, gastos y presupuesto" title="Finanzas" actions={<><button className="btn" type="button" onClick={() => add('gasto')}><Plus size={16} />Gasto</button><button className="btn primary" type="button" onClick={() => add('ingreso')}><Plus size={16} />Ingreso</button></>} />
      <div className="row between" style={{ marginBottom: 12 }}><button className="btn sm" type="button" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button><h3 style={{ textTransform: 'capitalize' }}>{monthLabel(month)}</h3><button className="btn sm" type="button" onClick={() => setMonth(shiftMonth(month, 1))}>›</button></div>
      <div className="grid kpis">
        <Kpi label="Ingresos" value={money(sum('ingreso'), currency)} />
        <Kpi label="Gastos" value={money(sum('gasto'), currency)} />
        <Kpi label="Balance" value={money(sum('ingreso') - sum('gasto'), currency)} deltaClass={sum('ingreso') - sum('gasto') >= 0 ? 'up' : 'down'} />
        <div className="card tight kpi"><div className="kpi-label">Presupuesto de contenido</div><div className="kpi-value sm">{b.budget !== null ? money(b.spent, currency) : '—'}</div>{b.budget !== null && <><Progress value={b.spent / Math.max(1, b.budget)} thin /><span className="xs faint">de {money(b.budget, currency)} · quedan {money(b.remaining, currency)}</span></>}</div>
      </div>
      <Card className="section" title="Presupuesto para contenido">
        <div className="form-grid two">
          <NumberField label="Presupuesto mensual predeterminado" suffix={currency} value={settings.monthlyContentBudget ?? null} onChange={(v) => updateSettings({ monthlyContentBudget: v ?? undefined })} />
          <NumberField label={`Presupuesto de ${monthLabel(month)}`} suffix={currency} value={monthRow?.content_budget ?? null} hint="Sobrescribe el predeterminado para este mes" onChange={(v) => { if (monthRow) months.update(monthRow.id, { content_budget: v }); else months.insert({ month, status: 'abierto', content_budget: v, addenda: [] }); }} />
        </div>
        <p className="xs faint">Cuentan como gasto de contenido: {CONTENT_EXPENSE_CATEGORIES.join(', ')}.</p>
      </Card>
      <section className="section grid halves">
        <Card title="Balance de los últimos 12 meses"><BarChart ariaLabel="Balance mensual" labels={last12.map((m) => m.slice(5))} values={net.map((v) => (v > 0 ? v : 0))} seriesLabel="Balance positivo" fmt={(v) => money(v, currency)} /><p className="xs faint">Meses con balance negativo se muestran en cero; consulta la tabla para el detalle.</p></Card>
        <Card title="Gastos por categoría">{byCat.length ? byCat.map(([c, v]) => <div key={c} className="row between small"><span>{c}</span><b className="num">{money(v, currency)}</b></div>) : <p className="muted small">Sin gastos este mes.</p>}</Card>
      </section>
      <div className="row between" style={{ marginBottom: 8 }}><Chips value={kind} onChange={setKind} options={[{ value: 'all', label: 'Todo' }, { value: 'ingreso', label: 'Ingresos' }, { value: 'gasto', label: 'Gastos' }]} /><button className="btn sm" type="button" onClick={() => downloadBlob(new Blob([toCsv(t.rows.map(({ user_id: _u, ...r }) => r))], { type: 'text/csv' }), 'vanni-finanzas.csv')}>CSV</button></div>
      {list.length ? <div className="list">{list.map((x) => <button key={x.id} type="button" className="list-item" onClick={() => setOpen(x.id)}><span className="badge">{dayLabel(x.day)}</span><span className="grow"><span className="small">{x.description || x.category}</span><br /><span className="xs faint">{x.category}</span></span><b className={`num ${x.kind === 'ingreso' ? 'up' : ''}`}>{x.kind === 'ingreso' ? '+' : '−'}{money(Number(x.amount), x.currency)}</b></button>)}</div> : <Empty title="Sin movimientos este mes" />}
      <TxSheet id={open} onClose={() => setOpen(null)} />
    </div>
  );
}
