import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import { useTable } from '../lib/store';
import { Card, DateField, Empty, Kpi, NumberField, PageHeader, Select, TextArea, TextField, Toggle, Tabs } from '../components/ui';
import { LineChart } from '../components/charts';
import { Attachments, StorageImage } from '../components/Attachments';
import { CustomFieldsEditor } from '../components/CustomFields';
import { Sheet } from '../components/Sheet';
import { confirmAction } from '../components/toast';
import { MEASUREMENTS } from '../lib/constants';
import { addDays, dayLabel, monthLabel, today, weekStart } from '../lib/dates';
import { n1 } from '../lib/format';
import { uuid } from '../lib/ids';
import { TemplateMenu } from './shared';
import type { BodyLog, Routine, Workout } from '../lib/types';

type Tab = 'diario' | 'entrenos' | 'records' | 'rutinas' | 'habitos' | 'progreso';

/** 1RM estimado (Epley) — una estimación, no una medición. */
export const epley = (w: number, reps: number) => (reps <= 1 ? w : w * (1 + reps / 30));

function DiaryTab() {
  const logs = useTable('body_logs');
  const habits = useTable('habits').rows.filter((h) => h.active).sort((a, b) => a.sort - b.sort);
  const [day, setDay] = useState(today());
  const log = logs.rows.find((l) => l.day === day);
  const ensure = (patch: Partial<BodyLog>) => { if (log) logs.update(log.id, patch); else logs.insert({ day, measurements: {}, habits: {}, ...patch }); };
  const recent = [...logs.rows].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 10);
  return (
    <div className="stack">
      <div className="row between"><button className="icon-btn bordered" type="button" aria-label="Día anterior" onClick={() => setDay(addDays(day, -1))}><ChevronLeft size={18} /></button><DateField value={day} onChange={(v) => v && setDay(v)} /><button className="icon-btn bordered" type="button" aria-label="Día siguiente" onClick={() => setDay(addDays(day, 1))}><ChevronRight size={18} /></button></div>
      <h3>{dayLabel(day, { weekday: true, year: true })}</h3>
      <div className="form-grid two">
        <NumberField label="Peso corporal" suffix="kg" value={log?.weight} onChange={(v) => ensure({ weight: v })} />
        <NumberField label="Grasa corporal (opcional)" suffix="%" value={log?.body_fat} onChange={(v) => ensure({ body_fat: v })} />
        <NumberField label="Horas de sueño" value={log?.sleep_hours} onChange={(v) => ensure({ sleep_hours: v })} />
        <NumberField label="Calidad del sueño (1–10)" value={log?.sleep_quality} onChange={(v) => ensure({ sleep_quality: v === null ? null : Math.max(1, Math.min(10, Math.round(v))) })} />
        <NumberField label="Energía (1–10)" value={log?.energy} onChange={(v) => ensure({ energy: v === null ? null : Math.max(1, Math.min(10, Math.round(v))) })} />
        <NumberField label="Ánimo (1–10)" value={log?.mood} onChange={(v) => ensure({ mood: v === null ? null : Math.max(1, Math.min(10, Math.round(v))) })} />
      </div>
      <details className="card tight"><summary className="field-label" style={{ cursor: 'pointer' }}>Medidas corporales (cm, opcional)</summary>
        <div className="form-grid two" style={{ marginTop: 10 }}>{MEASUREMENTS.map((m) => <NumberField key={m.key} label={m.label} value={log?.measurements?.[m.key]} onChange={(v) => { const next = { ...(log?.measurements ?? {}) }; if (v === null) delete next[m.key]; else next[m.key] = v; ensure({ measurements: next }); }} />)}</div>
      </details>
      {habits.length > 0 && <Card title="Hábitos">{habits.map((h) => <Toggle key={h.id} label={h.name} checked={!!log?.habits?.[h.id]} onChange={(v) => ensure({ habits: { ...(log?.habits ?? {}), [h.id]: v } })} />)}</Card>}
      <TextArea label="Reflexión del día" value={log?.reflection} onChange={(v) => ensure({ reflection: v })} />
      <TextArea label="Logros" value={log?.achievements} onChange={(v) => ensure({ achievements: v })} rows={2} />
      {log && <CustomFieldsEditor entity="body_logs" value={log.custom} onChange={(v) => ensure({ custom: v })} />}
      {log ? <Card title="Fotos de evolución"><Attachments entityType="body_log" entityId={log.id} kind="progress" title="Fotos del día (privadas)" accept="image/*" allowLinks={false} /></Card> : <p className="xs faint">Registra cualquier dato del día para poder adjuntar fotos.</p>}
      <Card title="Registros recientes">{recent.length ? <div className="list">{recent.map((l) => <button type="button" key={l.id} className="list-item" onClick={() => setDay(l.day)}><span className="grow small">{dayLabel(l.day, { weekday: true })}</span><span className="xs faint num">{l.weight ? `${n1(l.weight)} kg` : ''}{l.sleep_hours ? ` · ${n1(l.sleep_hours)} h sueño` : ''}{l.energy ? ` · energía ${l.energy}` : ''}</span></button>)}</div> : <p className="muted small">Sin registros.</p>}</Card>
    </div>
  );
}

function WorkoutSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const workouts = useTable('workouts');
  const sets = useTable('workout_sets');
  const gyms = useTable('gyms').rows;
  const w = id ? workouts.byId.get(id) : undefined;
  if (!w) return null;
  const set = (patch: Partial<Workout>) => workouts.update(w.id, patch);
  const list = sets.rows.filter((s) => s.workout_id === w.id).sort((a, b) => a.exercise.localeCompare(b.exercise) || a.set_index - b.set_index || (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  const exercises = [...new Set(list.map((s) => s.exercise))];
  const addSet = (exercise = '', base?: { reps?: number | null; weight?: number | null }) => sets.insert({ workout_id: w.id, exercise, set_index: list.filter((s) => s.exercise === exercise).length + 1, reps: base?.reps ?? null, weight: base?.weight ?? null, unit: 'kg' });
  const volume = list.reduce((a, s) => a + (s.reps ?? 0) * (s.weight ?? 0), 0);
  return (
    <Sheet open={!!w} onClose={onClose} title={w.title || 'Entrenamiento'} wide footer={<><button className="btn danger" type="button" onClick={() => { if (confirmAction('¿Eliminar este entrenamiento?')) { workouts.remove(w.id); onClose(); } }}><Trash2 size={15} />Eliminar</button><button className="btn primary" type="button" onClick={onClose}>Listo</button></>}>
      <div className="stack">
        <div className="form-grid two">
          <TextField label="Rutina / nombre" value={w.title} onChange={(v) => set({ title: v })} />
          <DateField label="Fecha" value={w.day} onChange={(v) => v && set({ day: v })} />
          <NumberField label="Duración" suffix="min" value={w.duration_min} onChange={(v) => set({ duration_min: v })} />
          <NumberField label="Esfuerzo percibido (RPE 1–10)" value={w.rpe} onChange={(v) => set({ rpe: v })} />
          <Select label="Gimnasio" value={w.gym_id ?? ''} placeholder="— Ninguno —" onChange={(v) => set({ gym_id: v || null })} options={gyms.map((g) => ({ value: g.id, label: g.name }))} />
          <div className="kpi"><span className="kpi-label">Volumen total</span><span className="kpi-value sm">{n1(volume)} kg</span></div>
        </div>
        {exercises.map((ex) => (
          <Card key={list.find((s) => s.exercise === ex)!.id} tight title={<TextField value={ex} placeholder="Ejercicio" onChange={(v) => list.filter((s) => s.exercise === ex).forEach((s) => sets.update(s.id, { exercise: v }))} />}>
            <div className="stack tight">
              {list.filter((s) => s.exercise === ex).map((s, i) => (
                <div key={s.id} className="grid" style={{ gridTemplateColumns: '32px 1fr 1fr auto', gap: 6, alignItems: 'center' }}>
                  <span className="xs faint">#{i + 1}</span>
                  <NumberField value={s.reps} placeholder="Reps" onChange={(v) => sets.update(s.id, { reps: v })} />
                  <NumberField value={s.weight} placeholder="kg" onChange={(v) => sets.update(s.id, { weight: v })} />
                  <button className="icon-btn" type="button" aria-label="Eliminar serie" onClick={() => sets.remove(s.id)}><Trash2 size={15} /></button>
                </div>
              ))}
              <button className="btn sm" type="button" onClick={() => { const last = list.filter((s) => s.exercise === ex).at(-1); addSet(ex, last); }}><Copy size={14} />Repetir serie</button>
            </div>
          </Card>
        ))}
        <button className="btn" type="button" onClick={() => { const name = window.prompt('Nombre del ejercicio'); if (name) addSet(name.trim()); }}><Plus size={15} />Agregar ejercicio</button>
        <TextArea label="Notas" value={w.notes} onChange={(v) => set({ notes: v })} />
      </div>
    </Sheet>
  );
}

function WorkoutsTab() {
  const workouts = useTable('workouts');
  const sets = useTable('workout_sets');
  const routines = useTable('routines').rows;
  const [open, setOpen] = useState<string | null>(null);
  const [routine, setRoutine] = useState('');
  const start = () => {
    const r = routines.find((x) => x.id === routine);
    const w = workouts.insert({ day: today(), title: r?.name ?? 'Entrenamiento', routine_id: r?.id ?? null });
    r?.exercises.forEach((ex) => { for (let i = 1; i <= (ex.sets ?? 3); i++) sets.insert({ workout_id: w.id, exercise: ex.name, set_index: i, reps: Number(String(ex.reps ?? '').split('-')[0]) || null, unit: 'kg' }); });
    setOpen(w.id);
  };
  const list = [...workouts.rows].sort((a, b) => b.day.localeCompare(a.day));
  return (
    <div className="stack">
      <div className="row wrap"><Select value={routine} placeholder="Sin rutina (libre)" onChange={setRoutine} options={routines.map((r) => ({ value: r.id, label: r.name }))} /><button className="btn primary" type="button" onClick={start}><Plus size={16} />Iniciar entrenamiento</button></div>
      {list.length ? <div className="list">{list.map((w) => { const s = sets.rows.filter((x) => x.workout_id === w.id); return <button key={w.id} type="button" className="list-item" onClick={() => setOpen(w.id)}><span className="badge">{dayLabel(w.day)}</span><span className="grow"><span className="title">{w.title}</span><br /><span className="xs faint">{new Set(s.map((x) => x.exercise)).size} ejercicios · {s.length} series · {n1(s.reduce((a, x) => a + (x.reps ?? 0) * (x.weight ?? 0), 0))} kg{w.duration_min ? ` · ${w.duration_min} min` : ''}</span></span></button>; })}</div> : <Empty title="Sin entrenamientos">Inicia uno libre o desde una rutina.</Empty>}
      <WorkoutSheet id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function RecordsTab() {
  const sets = useTable('workout_sets').rows;
  const workouts = useTable('workouts').byId;
  const prs = useMemo(() => {
    const m = new Map<string, { exercise: string; weight: number; reps: number; day: string; e1rm: number; e1day: string }>();
    for (const s of sets) {
      if (!s.exercise || !s.weight || !s.reps) continue;
      const key = s.exercise.trim().toLowerCase();
      const day = workouts.get(s.workout_id)?.day ?? '';
      const e1 = epley(s.weight, s.reps);
      const cur = m.get(key);
      if (!cur) m.set(key, { exercise: s.exercise.trim(), weight: s.weight, reps: s.reps, day, e1rm: e1, e1day: day });
      else {
        if (s.weight > cur.weight || (s.weight === cur.weight && s.reps > cur.reps)) Object.assign(cur, { weight: s.weight, reps: s.reps, day });
        if (e1 > cur.e1rm) Object.assign(cur, { e1rm: e1, e1day: day });
      }
    }
    return [...m.values()].sort((a, b) => b.e1rm - a.e1rm);
  }, [sets, workouts]);
  return prs.length ? (
    <div className="table-wrap"><table className="table"><thead><tr><th>Ejercicio</th><th className="r">Mejor carga</th><th>Fecha</th><th className="r">1RM estimado</th><th>Fecha</th></tr></thead>
      <tbody>{prs.map((p) => <tr key={p.exercise}><td>{p.exercise}</td><td className="r">{n1(p.weight)} kg × {p.reps}</td><td>{p.day}</td><td className="r">{n1(p.e1rm)} kg</td><td>{p.e1day}</td></tr>)}</tbody></table>
      <p className="xs faint" style={{ padding: '0 12px' }}>Récords calculados de tus series registradas. 1RM estimado con la fórmula de Epley.</p></div>
  ) : <Empty title="Sin récords todavía">Se calculan automáticamente cuando registras series con peso y repeticiones.</Empty>;
}

function RoutinesTab() {
  const t = useTable('routines');
  const [open, setOpen] = useState<string | null>(null);
  const r = open ? t.byId.get(open) : undefined;
  const setEx = (list: Routine['exercises']) => r && t.update(r.id, { exercises: list });
  return (
    <div className="stack">
      <button className="btn primary" type="button" onClick={() => setOpen(t.insert({ name: 'Nueva rutina', exercises: [] }).id)}><Plus size={16} />Nueva rutina</button>
      {t.rows.length ? <div className="list">{t.rows.map((x) => <button key={x.id} type="button" className="list-item" onClick={() => setOpen(x.id)}><span className="grow title">{x.name}</span><span className="xs faint">{x.exercises.length} ejercicios</span></button>)}</div> : <Empty title="Sin rutinas">Crea rutinas para iniciar entrenamientos con sus ejercicios precargados.</Empty>}
      <Sheet open={!!r} onClose={() => setOpen(null)} title="Rutina" footer={r && <button className="btn danger" type="button" onClick={() => { t.remove(r.id); setOpen(null); }}>Eliminar</button>}>
        {r && <div className="stack">
          <TextField label="Nombre" value={r.name} onChange={(v) => t.update(r.id, { name: v })} />
          <TextArea label="Descripción" value={r.description} onChange={(v) => t.update(r.id, { description: v })} rows={2} />
          {r.exercises.map((ex, i) => (
            <div key={ex.id} className="grid" style={{ gridTemplateColumns: '1fr 70px 90px auto', gap: 6 }}>
              <input className="input" value={ex.name} placeholder="Ejercicio" onChange={(e) => setEx(r.exercises.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="input num" inputMode="numeric" value={ex.sets ?? ''} placeholder="Series" onChange={(e) => setEx(r.exercises.map((x, j) => (j === i ? { ...x, sets: Number(e.target.value) || undefined } : x)))} />
              <input className="input" value={ex.reps ?? ''} placeholder="Reps (8-12)" onChange={(e) => setEx(r.exercises.map((x, j) => (j === i ? { ...x, reps: e.target.value } : x)))} />
              <button className="icon-btn" type="button" aria-label="Quitar" onClick={() => setEx(r.exercises.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
            </div>
          ))}
          <button className="btn" type="button" onClick={() => setEx([...r.exercises, { id: uuid(), name: '', sets: 3, reps: '10' }])}><Plus size={15} />Ejercicio</button>
          <TemplateMenu target="routines" current={() => ({ name: r.name, description: r.description, exercises: r.exercises })} onApply={(d) => t.update(r.id, d as Partial<Routine>)} />
        </div>}
      </Sheet>
    </div>
  );
}

function HabitsTab() {
  const t = useTable('habits');
  const logs = useTable('body_logs').rows;
  const ws = weekStart(today());
  const week = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const add = () => { const name = window.prompt('Nuevo hábito (p. ej. 3 L de agua, 10k pasos, leer 20 min)'); if (name) t.insert({ name, target_per_week: 7, active: true, sort: t.rows.length }); };
  return (
    <div className="stack">
      <button className="btn primary" type="button" onClick={add}><Plus size={16} />Nuevo hábito</button>
      {t.rows.length ? t.rows.sort((a, b) => a.sort - b.sort).map((h) => {
        const done = week.filter((d) => logs.find((l) => l.day === d)?.habits?.[h.id]).length;
        return (
          <Card key={h.id} tight title={<TextField value={h.name} onChange={(v) => t.update(h.id, { name: v })} />} action={<button className="icon-btn" type="button" aria-label="Eliminar hábito" onClick={() => { if (confirmAction('¿Eliminar este hábito?')) t.remove(h.id); }}><Trash2 size={15} /></button>}>
            <div className="row between wrap"><span className="small">Esta semana: <b>{done}</b> / {h.target_per_week}</span><Toggle label="Activo" checked={h.active} onChange={(v) => t.update(h.id, { active: v })} /></div>
            <NumberField label="Meta por semana" value={h.target_per_week} onChange={(v) => t.update(h.id, { target_per_week: Math.max(1, Math.min(7, v ?? 7)) })} />
          </Card>
        );
      }) : <Empty title="Sin hábitos">Los hábitos se marcan cada día en el Diario.</Empty>}
    </div>
  );
}

function ProgressTab() {
  const logs = useTable('body_logs').rows;
  const workouts = useTable('workouts').rows;
  const sets = useTable('workout_sets').rows;
  const attachments = useTable('attachments').rows;
  const [measure, setMeasure] = useState('cintura');
  const [compare, setCompare] = useState<string[]>([]);
  const sorted = [...logs].sort((a, b) => a.day.localeCompare(b.day));
  const weights = sorted.filter((l) => l.weight);
  const months = useMemo(() => {
    const m = new Map<string, { w: number[]; sleep: number[]; energy: number[]; workouts: number; volume: number }>();
    const get = (k: string) => { if (!m.has(k)) m.set(k, { w: [], sleep: [], energy: [], workouts: 0, volume: 0 }); return m.get(k)!; };
    for (const l of logs) { const g = get(l.day.slice(0, 7)); if (l.weight) g.w.push(l.weight); if (l.sleep_hours) g.sleep.push(l.sleep_hours); if (l.energy) g.energy.push(l.energy); }
    for (const w of workouts) { const g = get(w.day.slice(0, 7)); g.workouts++; g.volume += sets.filter((s) => s.workout_id === w.id).reduce((a, s) => a + (s.reps ?? 0) * (s.weight ?? 0), 0); }
    const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, v]) => ({ month: k, weight: avg(v.w), sleep: avg(v.sleep), energy: avg(v.energy), workouts: v.workouts, volume: v.volume }));
  }, [logs, workouts, sets]);
  const photos = attachments.filter((a) => a.entity_type === 'body_log' && a.kind === 'progress').map((a) => ({ a, day: logs.find((l) => l.id === a.entity_id)?.day ?? (a.created_at ?? '').slice(0, 10) })).sort((x, y) => x.day.localeCompare(y.day));
  const byMonth = new Map<string, typeof photos>();
  photos.forEach((p) => { const k = p.day.slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k)!.push(p); });
  const first = weights[0]?.weight, last = weights.at(-1)?.weight;
  return (
    <div className="stack">
      <div className="grid kpis">
        <Kpi label="Peso actual" value={last ? `${n1(last)} kg` : '—'} source={last ? 'manual' : 'na'} />
        <Kpi label="Cambio total" value={first && last ? `${last - first > 0 ? '+' : ''}${n1(last - first)} kg` : '—'} sub={weights[0] ? `Desde ${weights[0].day}` : undefined} />
        <Kpi label="Entrenamientos (30 d)" value={workouts.filter((w) => w.day >= addDays(today(), -30)).length} />
        <Kpi label="Sueño medio (30 d)" value={(() => { const v = logs.filter((l) => l.day >= addDays(today(), -30) && l.sleep_hours).map((l) => l.sleep_hours!); return v.length ? `${n1(v.reduce((a, b) => a + b, 0) / v.length)} h` : '—'; })()} />
      </div>
      <Card title="Peso corporal">{weights.length > 1 ? <LineChart ariaLabel="Peso corporal" minZero={false} labels={weights.map((l) => dayLabel(l.day))} series={[{ key: 'w', label: 'Peso (kg)', color: 'var(--accent)', values: weights.map((l) => l.weight!) }]} fmt={(v) => `${n1(v)}`} /> : <p className="muted small">Registra tu peso al menos dos días para ver la tendencia.</p>}</Card>
      <Card title="Medidas" action={<Select value={measure} onChange={setMeasure} options={MEASUREMENTS.map((m) => ({ value: m.key, label: m.label }))} />}>
        {(() => { const pts = sorted.filter((l) => l.measurements?.[measure]); return pts.length > 1 ? <LineChart ariaLabel={`Medida: ${measure}`} minZero={false} labels={pts.map((l) => dayLabel(l.day))} series={[{ key: 'm', label: `${measure} (cm)`, color: 'var(--series-1)', values: pts.map((l) => l.measurements[measure]) }]} /> : <p className="muted small">Sin suficientes registros de esta medida.</p>; })()}
      </Card>
      <Card title="Comparativa mensual">
        {months.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Mes</th><th className="r">Peso medio</th><th className="r">Entrenos</th><th className="r">Volumen</th><th className="r">Sueño</th><th className="r">Energía</th></tr></thead><tbody>{months.map((m) => <tr key={m.month}><td>{monthLabel(m.month)}</td><td className="r">{m.weight ? `${n1(m.weight)} kg` : '—'}</td><td className="r">{m.workouts}</td><td className="r">{n1(m.volume)} kg</td><td className="r">{m.sleep ? `${n1(m.sleep)} h` : '—'}</td><td className="r">{m.energy ? n1(m.energy) : '—'}</td></tr>)}</tbody></table></div> : <p className="muted small">Sin datos.</p>}
      </Card>
      <Card title="Línea temporal de fotos">
        {compare.length === 2 && <div className="grid cols-2" style={{ marginBottom: 12 }}>{compare.map((id) => { const p = photos.find((x) => x.a.id === id)!; return <div key={id} className="stack tight"><StorageImage path={p.a.storage_path} alt={`Foto ${p.day}`} className="cover poster" /><span className="xs faint">{dayLabel(p.day, { year: true })}</span></div>; })}</div>}
        {photos.length ? [...byMonth.entries()].reverse().map(([m, list]) => (
          <div key={m} style={{ marginBottom: 12 }}><div className="kicker" style={{ marginBottom: 6 }}>{monthLabel(m)}</div>
            <div className="gallery">{list.map((p) => <button key={p.a.id} type="button" className="gallery-item" style={{ padding: 0, outline: compare.includes(p.a.id) ? '2px solid var(--accent)' : undefined }} onClick={() => setCompare((c) => (c.includes(p.a.id) ? c.filter((x) => x !== p.a.id) : [...c.slice(-1), p.a.id]))}><StorageImage path={p.a.storage_path} alt={`Foto ${p.day}`} /><span className="cap">{dayLabel(p.day)}</span></button>)}</div>
          </div>
        )) : <p className="muted small">Sube fotos desde el Diario. Toca dos para compararlas lado a lado.</p>}
      </Card>
    </div>
  );
}

export function BodyPage() {
  const [tab, setTab] = useState<Tab>('diario');
  return (
    <div>
      <PageHeader eyebrow="Diario privado" title="Evolución" description="Peso, medidas, fotos, rutinas, cargas, récords, sueño, energía, hábitos y reflexiones. Solo tú puedes verlo." />
      <div style={{ marginBottom: 16 }}><Tabs value={tab} onChange={setTab} options={[{ value: 'diario', label: 'Diario' }, { value: 'entrenos', label: 'Entrenos' }, { value: 'records', label: 'Récords' }, { value: 'rutinas', label: 'Rutinas' }, { value: 'habitos', label: 'Hábitos' }, { value: 'progreso', label: 'Progreso' }]} /></div>
      {tab === 'diario' && <DiaryTab />}
      {tab === 'entrenos' && <WorkoutsTab />}
      {tab === 'records' && <RecordsTab />}
      {tab === 'rutinas' && <RoutinesTab />}
      {tab === 'habitos' && <HabitsTab />}
      {tab === 'progreso' && <ProgressTab />}
    </div>
  );
}
