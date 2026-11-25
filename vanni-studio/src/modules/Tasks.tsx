import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Plus, Trash2 } from 'lucide-react';
import { useTable } from '../lib/store';
import { Chips, DateField, Empty, PageHeader, Select, TagInput, TextArea, TextField } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { addDays, dayLabel, today } from '../lib/dates';
import type { Task } from '../lib/types';

const PRIORITY = [{ value: '1', label: 'Alta' }, { value: '2', label: 'Media' }, { value: '3', label: 'Baja' }];

export function TaskRow({ t, onOpen }: { t: Task; onOpen?: () => void }) {
  const tasks = useTable('tasks');
  const overdue = !t.done && t.due_date && t.due_date < today();
  return (
    <div className="list-item" style={{ cursor: 'default' }}>
      <input type="checkbox" aria-label={`Completar ${t.title}`} checked={t.done} style={{ width: 22, height: 22, accentColor: 'var(--accent)', flex: 'none' }}
        onChange={(e) => tasks.update(t.id, { done: e.target.checked, done_at: e.target.checked ? new Date().toISOString() : null })} />
      <button type="button" className="grow" style={{ background: 'none', border: 0, textAlign: 'left', padding: 0, cursor: 'pointer', minWidth: 0 }} onClick={onOpen}>
        <div className="small" style={{ textDecoration: t.done ? 'line-through' : undefined, opacity: t.done ? 0.6 : 1 }}>{t.title || 'Sin título'}</div>
        <div className={`xs ${overdue ? 'down' : 'faint'}`}>{t.list_name}{t.due_date ? ` · ${overdue ? 'Vencida ' : ''}${dayLabel(t.due_date)}` : ''}</div>
      </button>
      {t.priority === 1 && <span className="badge crit">Alta</span>}
    </div>
  );
}

export function TasksPage() {
  const tasks = useTable('tasks');
  const [list, setList] = useState('all');
  const [filter, setFilter] = useState<'pendientes' | 'hoy' | 'semana' | 'vencidas' | 'hechas'>('pendientes');
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const lists = useMemo(() => [...new Set(['General', 'Contenido', 'Universidad', 'Trabajo', 'Personal', ...tasks.rows.map((t) => t.list_name)])], [tasks.rows]);
  const t0 = today();
  const shown = tasks.rows
    .filter((t) => list === 'all' || t.list_name === list)
    .filter((t) => filter === 'hechas' ? t.done : !t.done && (filter === 'pendientes' || (filter === 'hoy' ? t.due_date === t0 : filter === 'semana' ? !!t.due_date && t.due_date <= addDays(t0, 7) : !!t.due_date && t.due_date < t0)))
    .sort((a, b) => (filter === 'hechas' ? (b.done_at ?? '').localeCompare(a.done_at ?? '') : a.priority - b.priority || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.sort - b.sort));
  const add = (e: React.FormEvent) => { e.preventDefault(); const t = text.trim(); if (!t) return; tasks.insert({ title: t, due_date: due || null, priority: 2, list_name: list === 'all' ? 'General' : list, done: false, sort: 0 }); setText(''); };
  const newList = () => { const name = window.prompt('Nombre de la nueva lista'); if (name?.trim()) setList(name.trim()); };
  const cur = open ? tasks.byId.get(open) : undefined;
  return (
    <div>
      <PageHeader eyebrow="Listas de tareas" title="Tareas" actions={<Link className="btn" to="/agenda">Agenda</Link>} />
      <div className="stack" style={{ marginBottom: 14 }}>
        <div className="chips scroll">
          {[{ value: 'all', label: 'Todas' }, ...lists.map((l) => ({ value: l, label: l }))].map((o) => <button key={o.value} type="button" aria-pressed={list === o.value} className={`chip ${list === o.value ? 'active' : ''}`} onClick={() => setList(o.value)}>{o.label}</button>)}
          <button type="button" className="chip" onClick={newList}><Plus size={14} />Nueva lista</button>
        </div>
        <Chips value={filter} onChange={setFilter} options={[{ value: 'pendientes', label: 'Pendientes' }, { value: 'hoy', label: 'Hoy' }, { value: 'semana', label: '7 días' }, { value: 'vencidas', label: 'Vencidas' }, { value: 'hechas', label: 'Hechas' }]} />
        <form className="stack tight" onSubmit={add}>
          <input className="input" placeholder={`Nueva tarea en ${list === 'all' ? 'General' : list}…`} value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="done" aria-label="Nueva tarea" />
          <div className="row"><input className="input grow" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fecha límite" /><button className="btn primary" type="submit">Agregar</button></div>
        </form>
      </div>
      {shown.length ? <div className="list">{shown.map((t) => <TaskRow key={t.id} t={t} onOpen={() => setOpen(t.id)} />)}</div> : <Empty title="Nada por aquí">Sin tareas en este filtro.</Empty>}
      <Sheet open={!!cur} onClose={() => setOpen(null)} title="Tarea" footer={cur && <><button className="btn danger" type="button" onClick={() => { tasks.remove(cur.id); setOpen(null); }}><Trash2 size={15} />Eliminar</button><button className="btn primary" type="button" onClick={() => setOpen(null)}>Listo</button></>}>
        {cur && (
          <div className="stack">
            <TextField label="Título" value={cur.title} onChange={(v) => tasks.update(cur.id, { title: v })} />
            <div className="form-grid two">
              <DateField label="Fecha límite" value={cur.due_date} onChange={(v) => tasks.update(cur.id, { due_date: v })} />
              <Select label="Prioridad" value={String(cur.priority)} onChange={(v) => tasks.update(cur.id, { priority: Number(v) })} options={PRIORITY} />
              <Select label="Lista" value={cur.list_name} onChange={(v) => tasks.update(cur.id, { list_name: v })} options={lists.map((l) => ({ value: l, label: l }))} />
            </div>
            <TextArea label="Notas" value={cur.notes} onChange={(v) => tasks.update(cur.id, { notes: v })} />
            <TagInput value={cur.tags} onChange={(v) => tasks.update(cur.id, { tags: v })} />
            {cur.linked_type === 'idea' && cur.linked_id && <Link className="btn sm" to={`/laboratorio/${cur.linked_id}`}>Abrir idea de origen</Link>}
          </div>
        )}
      </Sheet>
    </div>
  );
}
