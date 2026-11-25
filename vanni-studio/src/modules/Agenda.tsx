import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useTable } from '../lib/store';
import { Chips, DateField, NumberField, PageHeader, Select, TagInput, TextArea, TextField, Toggle, Tabs } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { confirmAction } from '../components/toast';
import { EVENT_CATEGORIES } from '../lib/constants';
import { describeRecurrence, expandEvents, type Occurrence } from '../lib/recurrence';
import { addDays, addMonths, combine, dayLabel, dayOfInstant, monthLabel, MONTHS, parseDay, timeOfInstant, today, toDay, WEEKDAYS_SHORT, weekStart } from '../lib/dates';
import { useCategoryOptions } from './shared';
import type { CalEvent, Recurrence } from '../lib/types';

type View = 'dia' | 'semana' | 'mes' | 'anio';

export function useEventColors() {
  const opts = useCategoryOptions('events', EVENT_CATEGORIES);
  return { options: opts, color: (cat: string, own?: string | null) => own || opts.find((o) => o.value === cat)?.color || '#a9aea7', label: (cat: string) => opts.find((o) => o.value === cat)?.label ?? cat };
}

function Chip({ occ, color, onOpen, draggable }: { occ: Occurrence; color: string; onOpen: () => void; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: occ.key, disabled: !draggable });
  return (
    <span ref={setNodeRef} {...attributes} {...listeners} className="cal-ev" style={{ ['--ev' as string]: color, opacity: isDragging ? 0.4 : occ.done ? 0.5 : 1, textDecoration: occ.done ? 'line-through' : undefined }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}>{occ.event.all_day ? '' : `${timeOfInstant(occ.start)} `}{occ.event.title}</span>
  );
}

function DayCell({ day, children, className, onClick }: { day: string; children: React.ReactNode; className: string; onClick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: day });
  return <div ref={setNodeRef} role="button" tabIndex={0} aria-label={dayLabel(day, { weekday: true })} className={`${className} ${isOver ? 'over' : ''}`} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}>{children}</div>;
}

const RECUR_OPTS = [{ value: 'none', label: 'No se repite' }, { value: 'daily', label: 'Diario' }, { value: 'weekly', label: 'Semanal' }, { value: 'monthly', label: 'Mensual' }, { value: 'yearly', label: 'Anual' }];

export function EventSheet({ eventId, occurrenceDay, onClose }: { eventId: string | null; occurrenceDay?: string | null; onClose: () => void }) {
  const t = useTable('events');
  const colors = useEventColors();
  const ev = eventId ? t.byId.get(eventId) : undefined;
  if (!ev) return null;
  const set = (patch: Partial<CalEvent>) => t.update(ev.id, patch);
  const day = dayOfInstant(ev.start_at);
  const startTime = timeOfInstant(ev.start_at);
  const endTime = ev.end_at ? timeOfInstant(ev.end_at) : '';
  const r = ev.recurrence;
  const setRec = (patch: Partial<Recurrence> | null) => set({ recurrence: patch === null ? null : { ...(r ?? { freq: 'weekly' }), ...patch } as Recurrence });
  const occ = occurrenceDay && r ? occurrenceDay : null;
  const durationMin = ev.end_at ? Math.round((new Date(ev.end_at).getTime() - new Date(ev.start_at).getTime()) / 60000) : null;
  return (
    <Sheet open={!!ev} onClose={onClose} title={ev.title || 'Evento'} footer={
      <>
        {occ ? <>
          <button className="btn" type="button" onClick={() => { set({ exdates: [...(ev.exdates ?? []), occ] }); onClose(); }}>Omitir este día</button>
          <button className="btn danger" type="button" onClick={() => { if (confirmAction('¿Eliminar toda la serie de repeticiones?')) { t.remove(ev.id); onClose(); } }}><Trash2 size={15} />Serie</button>
        </> : <button className="btn danger" type="button" onClick={() => { if (confirmAction('¿Eliminar este evento?')) { t.remove(ev.id); onClose(); } }}><Trash2 size={15} />Eliminar</button>}
        <button className="btn primary" type="button" onClick={onClose}>Listo</button>
      </>
    }>
      <div className="stack">
        {occ && <div className="notice">Repetición del {dayLabel(occ, { weekday: true })}. Los cambios de abajo aplican a toda la serie. <button type="button" className="btn sm" style={{ marginLeft: 8 }} onClick={() => { const dd = ev.done_dates ?? []; set({ done_dates: dd.includes(occ) ? dd.filter((d) => d !== occ) : [...dd, occ] }); }}>{(ev.done_dates ?? []).includes(occ) ? 'Marcar pendiente' : 'Marcar hecha'}</button></div>}
        <TextField label="Título" value={ev.title} onChange={(v) => set({ title: v })} />
        <div className="form-grid two">
          <Select label="Categoría" value={ev.category} onChange={(v) => set({ category: v })} options={colors.options} />
          <Select label="Prioridad" value={String(ev.priority)} onChange={(v) => set({ priority: Number(v) })} options={[{ value: '1', label: 'Alta' }, { value: '2', label: 'Media' }, { value: '3', label: 'Baja' }]} />
          <DateField label="Fecha" value={day} onChange={(v) => { if (!v) return; const start = combine(v, startTime); set({ start_at: start, end_at: durationMin !== null ? new Date(new Date(start).getTime() + durationMin * 60000).toISOString() : null }); }} />
          <Toggle label="Todo el día" checked={ev.all_day} onChange={(v) => set({ all_day: v })} />
          {!ev.all_day && <DateField label="Inicio" type="time" value={startTime} onChange={(v) => { if (!v) return; const start = combine(day, v); set({ start_at: start, end_at: durationMin !== null ? new Date(new Date(start).getTime() + durationMin * 60000).toISOString() : null }); }} />}
          {!ev.all_day && <DateField label="Fin" type="time" value={endTime} onChange={(v) => set({ end_at: v ? combine(day, v) : null })} />}
          {!r && <Select label="Estado" value={ev.status} onChange={(v) => set({ status: v })} options={[{ value: 'pendiente', label: 'Pendiente' }, { value: 'hecho', label: 'Hecho' }, { value: 'cancelado', label: 'Cancelado' }]} />}
          <TextField label="Lugar" value={ev.location} onChange={(v) => set({ location: v })} />
        </div>
        <div className="card tight stack">
          <Select label="Repetición" value={r?.freq ?? 'none'} onChange={(v) => setRec(v === 'none' ? null : { freq: v as Recurrence['freq'] })} options={RECUR_OPTS} />
          {r && (
            <>
              <div className="form-grid two">
                <NumberField label="Cada (intervalo)" value={r.interval ?? 1} onChange={(v) => setRec({ interval: Math.max(1, v ?? 1) })} />
                <DateField label="Hasta (opcional)" value={r.until} onChange={(v) => setRec({ until: v })} />
                <NumberField label="Número de veces (opcional)" value={r.count ?? null} onChange={(v) => setRec({ count: v })} />
              </div>
              {r.freq === 'weekly' && <div className="chips">{WEEKDAYS_SHORT.map((d, i) => { const on = (r.byweekday ?? []).includes(i); return <button key={i} type="button" className={`chip ${on ? 'active' : ''}`} onClick={() => setRec({ byweekday: on ? (r.byweekday ?? []).filter((x) => x !== i) : [...(r.byweekday ?? []), i] })}>{d}</button>; })}</div>}
              <span className="xs faint">{describeRecurrence(r)}{ev.exdates?.length ? ` · ${ev.exdates.length} días omitidos` : ''}</span>
            </>
          )}
        </div>
        <TextArea label="Notas" value={ev.notes} onChange={(v) => set({ notes: v })} />
        <label className="field"><span>Color propio (opcional)</span><input className="input" type="color" value={ev.color ?? colors.color(ev.category)} onChange={(e) => set({ color: e.target.value })} style={{ padding: 4 }} /></label>
        <TagInput value={ev.tags} onChange={(v) => set({ tags: v })} />
        {ev.linked_type === 'episode' && ev.linked_id && <Link className="btn sm" to={`/episodios/${ev.linked_id}`} onClick={onClose}>Abrir episodio vinculado</Link>}
        {ev.linked_type === 'idea' && ev.linked_id && <Link className="btn sm" to={`/laboratorio/${ev.linked_id}`} onClick={onClose}>Abrir idea vinculada</Link>}
      </div>
    </Sheet>
  );
}

export function AgendaPage() {
  const events = useTable('events');
  const tasks = useTable('tasks');
  const episodes = useTable('episodes').rows;
  const colors = useEventColors();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = (params.get('v') as View) || 'mes';
  const cursor = params.get('d') || today();
  const setView = (v: View) => { params.set('v', v); setParams(params, { replace: true }); };
  const setCursor = (d: string) => { params.set('d', d); setParams(params, { replace: true }); };
  const [cat, setCat] = useState('all');
  const [showDone, setShowDone] = useState(true);
  const [selected, setSelected] = useState(cursor);
  const [open, setOpen] = useState<{ id: string; day?: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }));

  const range = useMemo(() => {
    if (view === 'dia') return { from: cursor, to: cursor };
    if (view === 'semana') { const s = weekStart(cursor); return { from: s, to: addDays(s, 6) }; }
    if (view === 'mes') { const first = `${cursor.slice(0, 7)}-01`; const s = weekStart(first); return { from: s, to: addDays(s, 41) }; }
    return { from: `${cursor.slice(0, 4)}-01-01`, to: `${cursor.slice(0, 4)}-12-31` };
  }, [view, cursor]);

  const occs = useMemo(() => {
    const list = expandEvents(events.rows, range.from, range.to).filter((o) => (cat === 'all' || o.event.category === cat) && (showDone || !o.done) && o.event.status !== 'cancelado');
    // Grabaciones y publicaciones de episodios que aún no tienen evento en la agenda
    const linked = new Set(events.rows.filter((e) => e.linked_type === 'episode').map((e) => `${e.linked_id}|${e.category}`));
    const virtual: Occurrence[] = [];
    for (const ep of episodes) {
      for (const [kind, d] of [['grabacion', ep.record_date], ['publicacion', ep.publish_date]] as const) {
        if (!d || d < range.from || d > range.to || linked.has(`${ep.id}|${kind}`) || (cat !== 'all' && cat !== kind)) continue;
        const fake: CalEvent = { id: `ep-${ep.id}-${kind}`, title: `${kind === 'grabacion' ? 'Grabar' : 'Publicar'}: ${ep.title}`, category: kind, start_at: combine(d, kind === 'grabacion' ? ep.record_time?.slice(0, 5) || '00:00' : '00:00'), all_day: kind === 'publicacion' || !ep.record_time, priority: 2, status: 'pendiente', exdates: [], done_dates: [], linked_type: 'episode', linked_id: ep.id };
        virtual.push({ event: fake, day: d, start: fake.start_at, end: null, key: fake.id, done: false, recurring: false });
      }
    }
    return [...list, ...virtual];
  }, [events.rows, episodes, range, cat, showDone]);
  const byDay = useMemo(() => { const m = new Map<string, Occurrence[]>(); for (const o of occs) { if (!m.has(o.day)) m.set(o.day, []); m.get(o.day)!.push(o); } return m; }, [occs]);

  const createAt = (day: string, time = '09:00', allDay = false) => {
    const e = events.insert({ title: 'Nuevo evento', category: cat === 'all' ? 'personal' : cat, start_at: combine(day, time), end_at: allDay ? null : new Date(new Date(combine(day, time)).getTime() + 3600_000).toISOString(), all_day: allDay, priority: 2, status: 'pendiente', exdates: [], done_dates: [] });
    setOpen({ id: e.id });
  };
  const openOcc = (o: Occurrence) => { if (o.event.id.startsWith('ep-')) { navigate(`/episodios/${o.event.linked_id}`); return; } setOpen({ id: o.event.id, day: o.recurring ? o.day : undefined }); };

  const onDragEnd = (e: DragEndEvent) => {
    const to = e.over?.id as string | undefined;
    const occ = occs.find((o) => o.key === e.active.id);
    if (!to || !occ || occ.day === to || occ.event.id.startsWith('ep-')) return;
    const ev = occ.event;
    const shift = (iso: string) => { const d = new Date(iso); const target = parseDay(to); d.setFullYear(target.getFullYear(), target.getMonth(), target.getDate()); return d.toISOString(); };
    if (occ.recurring) {
      // Mueve solo esta repetición: la omite en la serie y crea un evento único en el nuevo día.
      events.update(ev.id, { exdates: [...(ev.exdates ?? []), occ.day] });
      events.insert({ ...ev, id: undefined, recurrence: null, exdates: [], done_dates: [], start_at: shift(occ.start), end_at: occ.end ? shift(occ.end) : null, status: occ.done ? 'hecho' : 'pendiente', created_at: undefined, updated_at: undefined } as Partial<CalEvent>);
    } else {
      events.update(ev.id, { start_at: shift(ev.start_at), end_at: ev.end_at ? shift(ev.end_at) : null });
    }
  };

  const step = (dir: 1 | -1) => setCursor(view === 'dia' ? addDays(cursor, dir) : view === 'semana' ? addDays(cursor, 7 * dir) : view === 'mes' ? addMonths(cursor, dir) : addMonths(cursor, 12 * dir));
  const title = view === 'dia' ? dayLabel(cursor, { weekday: true, year: true }) : view === 'semana' ? `Semana del ${dayLabel(range.from)} al ${dayLabel(range.to, { year: true })}` : view === 'mes' ? monthLabel(cursor.slice(0, 7)) : cursor.slice(0, 4);
  const dayTasks = (d: string) => tasks.rows.filter((t) => t.due_date === d && (showDone || !t.done));
  const t0 = today();

  const DayList = ({ d }: { d: string }) => {
    const list = byDay.get(d) ?? [];
    const tl = dayTasks(d);
    return (
      <div className="stack tight">
        {list.map((o) => <button key={o.key} type="button" className={`event-pill ${o.done ? 'done' : ''}`} style={{ ['--ev' as string]: colors.color(o.event.category, o.event.color) }} onClick={() => openOcc(o)}>
          <span className="xs faint num" style={{ minWidth: 42 }}>{o.event.all_day ? 'Día' : timeOfInstant(o.start)}</span><span className="grow small">{o.event.title}</span>{o.event.priority === 1 && <span className="badge crit">Alta</span>}
        </button>)}
        {tl.map((t) => <label key={t.id} className="check small"><input type="checkbox" checked={t.done} onChange={(e) => tasks.update(t.id, { done: e.target.checked, done_at: e.target.checked ? new Date().toISOString() : null })} /><span style={{ textDecoration: t.done ? 'line-through' : undefined }}>{t.title}</span><span className="xs faint">· {t.list_name}</span></label>)}
        {!list.length && !tl.length && <span className="xs faint">Sin actividades.</span>}
      </div>
    );
  };

  return (
    <div>
      <PageHeader eyebrow="Calendario editorial y personal" title="Agenda" actions={<><Link className="btn" to="/tareas">Tareas</Link><button className="btn primary" type="button" onClick={() => createAt(view === 'mes' ? selected : cursor)}><Plus size={16} />Evento</button></>} />
      <div className="stack" style={{ marginBottom: 14 }}>
        <Tabs value={view} onChange={setView} options={[{ value: 'dia', label: 'Día' }, { value: 'semana', label: 'Semana' }, { value: 'mes', label: 'Mes' }, { value: 'anio', label: 'Año' }]} />
        <div className="row between">
          <div className="row"><button className="icon-btn bordered" type="button" aria-label="Anterior" onClick={() => step(-1)}><ChevronLeft size={18} /></button><button className="btn sm" type="button" onClick={() => { setCursor(t0); setSelected(t0); }}>Hoy</button><button className="icon-btn bordered" type="button" aria-label="Siguiente" onClick={() => step(1)}><ChevronRight size={18} /></button></div>
          <h3 style={{ textAlign: 'right' }}>{title}</h3>
        </div>
        <Chips scroll value={cat} onChange={setCat} options={[{ value: 'all', label: 'Todo' }, ...colors.options.map((o) => ({ value: o.value, label: o.label }))]} />
        <Toggle label="Mostrar completadas" checked={showDone} onChange={setShowDone} />
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {view === 'mes' && (
          <>
            <div className="cal-grid" role="grid" aria-label={title}>
              {WEEKDAYS_SHORT.map((d) => <div key={d} className="cal-dow">{d}</div>)}
              {Array.from({ length: 42 }, (_, i) => addDays(range.from, i)).map((d) => {
                const list = byDay.get(d) ?? [];
                return (
                  <DayCell key={d} day={d} className={`cal-cell ${d.slice(0, 7) !== cursor.slice(0, 7) ? 'out' : ''} ${d === t0 ? 'today' : ''} ${d === selected ? 'selected' : ''}`} onClick={() => setSelected(d)}>
                    <span className="cal-num">{parseDay(d).getDate()}</span>
                    {list.slice(0, 3).map((o) => <Chip key={o.key} occ={o} color={colors.color(o.event.category, o.event.color)} onOpen={() => openOcc(o)} draggable={!o.event.id.startsWith('ep-')} />)}
                    {list.length > 3 && <span className="xs faint">+{list.length - 3}</span>}
                  </DayCell>
                );
              })}
            </div>
            <section className="section">
              <div className="section-head"><h3>{dayLabel(selected, { weekday: true })}</h3><button className="btn sm" type="button" onClick={() => createAt(selected)}><Plus size={14} />Agregar</button></div>
              <DayList d={selected} />
            </section>
          </>
        )}
        {view === 'semana' && (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            {Array.from({ length: 7 }, (_, i) => addDays(range.from, i)).map((d) => (
              <DayCell key={d} day={d} className={`card tight stack tight ${d === t0 ? 'selected' : ''}`} onClick={() => undefined}>
                <div className="row between"><b className={d === t0 ? 'up' : ''}>{dayLabel(d, { weekday: true })}</b><button type="button" className="icon-btn" aria-label="Agregar evento" onClick={(e) => { e.stopPropagation(); createAt(d); }}><Plus size={15} /></button></div>
                {(byDay.get(d) ?? []).map((o) => <Chip key={o.key} occ={o} color={colors.color(o.event.category, o.event.color)} onOpen={() => openOcc(o)} draggable={!o.event.id.startsWith('ep-')} />)}
                {dayTasks(d).map((t) => <span key={t.id} className="xs" style={{ textDecoration: t.done ? 'line-through' : undefined }}>☐ {t.title}</span>)}
              </DayCell>
            ))}
          </div>
        )}
      </DndContext>
      {view === 'dia' && (
        <div className="stack">
          {(byDay.get(cursor) ?? []).filter((o) => o.event.all_day).map((o) => <button key={o.key} type="button" className="event-pill" style={{ ['--ev' as string]: colors.color(o.event.category, o.event.color) }} onClick={() => openOcc(o)}>Todo el día · {o.event.title}</button>)}
          <div className="timeline">
            {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => {
              const list = (byDay.get(cursor) ?? []).filter((o) => !o.event.all_day && new Date(o.start).getHours() === h);
              return (
                <div key={h} className="timeline-hour">
                  <span>{String(h).padStart(2, '0')}:00</span>
                  <div onClick={() => !list.length && createAt(cursor, `${String(h).padStart(2, '0')}:00`)} style={{ cursor: list.length ? 'default' : 'pointer', minHeight: 40 }}>
                    {list.map((o) => <button key={o.key} type="button" className={`event-pill ${o.done ? 'done' : ''}`} style={{ ['--ev' as string]: colors.color(o.event.category, o.event.color) }} onClick={(e) => { e.stopPropagation(); openOcc(o); }}><span className="xs faint num">{timeOfInstant(o.start)}{o.end ? `–${timeOfInstant(o.end)}` : ''}</span><span className="small">{o.event.title}</span></button>)}
                  </div>
                </div>
              );
            })}
          </div>
          <section className="section"><h3 style={{ marginBottom: 8 }}>Tareas del día</h3><DayList d={cursor} /></section>
        </div>
      )}
      {view === 'anio' && (
        <div className="year-grid">
          {MONTHS.map((m, mi) => {
            const month = `${cursor.slice(0, 4)}-${String(mi + 1).padStart(2, '0')}`;
            const first = parseDay(`${month}-01`);
            const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
            const lead = (first.getDay() + 6) % 7;
            const count = Array.from({ length: days }, (_, i) => (byDay.get(toDay(new Date(first.getFullYear(), first.getMonth(), i + 1))) ?? []).length);
            const total = count.reduce((a, b) => a + b, 0);
            return (
              <button key={m} type="button" className="mini-month" onClick={() => { setCursor(`${month}-01`); setView('mes'); }}>
                <div className="row between"><b style={{ textTransform: 'capitalize' }}>{m}</b><span className="xs faint">{total}</span></div>
                <div className="mini-days">{Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}{count.map((c, i) => <span key={i} className="mini-day" style={{ background: c ? `color-mix(in oklab, var(--accent) ${Math.min(90, 25 + c * 20)}%, var(--surface-3))` : undefined }} title={`${i + 1} ${m}: ${c} actividades`} />)}</div>
              </button>
            );
          })}
        </div>
      )}
      <EventSheet eventId={open?.id ?? null} occurrenceDay={open?.day} onClose={() => setOpen(null)} />
    </div>
  );
}
