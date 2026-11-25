import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Sheet } from './Sheet';
import { Tabs } from './ui';
import { useToast } from './toast';
import { useTable } from '../lib/store';
import { combine, today } from '../lib/dates';
import { EVENT_CATEGORIES, IDEA_KINDS, TX_CATEGORIES } from '../lib/constants';

type Mode = 'idea' | 'tarea' | 'evento' | 'peso' | 'gasto';

/** Captura en segundos: el texto se guarda al pulsar «Guardar» o Enter, sin pasos extra. */
export function QuickCapture({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('idea');
  const [text, setText] = useState('');
  const [kind, setKind] = useState('idea');
  const [day, setDay] = useState(today());
  const [time, setTime] = useState('19:00');
  const [cat, setCat] = useState('grabacion');
  const [amount, setAmount] = useState('');
  const [txCat, setTxCat] = useState('produccion');
  const ideas = useTable('ideas'), tasks = useTable('tasks'), events = useTable('events'), body = useTable('body_logs'), tx = useTable('transactions');
  const toast = useToast();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 60); }, [open, mode]);

  const reset = () => { setText(''); setAmount(''); };
  const save = () => {
    const t = text.trim();
    if (mode === 'idea') { if (!t) return; const row = ideas.insert({ kind, title: t.split('\n')[0].slice(0, 140), body: t.includes('\n') ? t : null, status: 'nueva', priority: 2, items: [], converted: [], pinned: false }); toast('Idea guardada en el Laboratorio', 'success'); reset(); onClose(); navigate(`/laboratorio/${row.id}`); return; }
    if (mode === 'tarea') { if (!t) return; tasks.insert({ title: t, due_date: day || null, priority: 2, list_name: 'General', done: false, sort: 0 }); toast('Tarea agregada', 'success'); }
    if (mode === 'evento') { if (!t) return; events.insert({ title: t, category: cat, start_at: combine(day, time), all_day: false, priority: 2, status: 'pendiente', exdates: [], done_dates: [] }); toast('Evento agregado a la agenda', 'success'); }
    if (mode === 'peso') {
      const v = Number(amount.replace(',', '.'));
      if (!Number.isFinite(v) || v <= 0) { toast('Escribe un peso válido', 'error'); return; }
      const existing = body.rows.find((b) => b.day === day);
      if (existing) body.update(existing.id, { weight: v }); else body.insert({ day, weight: v, measurements: {}, habits: {} });
      toast('Peso registrado', 'success');
    }
    if (mode === 'gasto') {
      const v = Number(amount.replace(',', '.'));
      if (!Number.isFinite(v) || v <= 0) { toast('Escribe un monto válido', 'error'); return; }
      tx.insert({ day, kind: 'gasto', amount: v, currency: 'MXN', category: txCat, description: t || null });
      toast('Gasto registrado', 'success');
    }
    reset();
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Captura rápida" footer={<><button className="btn ghost" type="button" onClick={onClose}>Cancelar</button><button className="btn primary" type="button" onClick={save}>Guardar</button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Tabs value={mode} onChange={setMode} label="Tipo de captura" options={[{ value: 'idea', label: 'Idea' }, { value: 'tarea', label: 'Tarea' }, { value: 'evento', label: 'Evento' }, { value: 'peso', label: 'Peso' }, { value: 'gasto', label: 'Gasto' }]} />
        {mode === 'idea' && (
          <>
            <textarea ref={inputRef as React.RefObject<HTMLTextAreaElement>} className="textarea" rows={4} placeholder="Escribe la idea tal como llegó…" value={text} onChange={(e) => setText(e.target.value)} />
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo de idea">{IDEA_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
          </>
        )}
        {(mode === 'tarea' || mode === 'evento') && <input ref={inputRef as React.RefObject<HTMLInputElement>} className="input" placeholder={mode === 'tarea' ? '¿Qué hay que hacer?' : 'Título del evento'} value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="done" />}
        {mode === 'evento' && <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">{EVENT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>}
        {(mode === 'peso' || mode === 'gasto') && <input ref={inputRef as React.RefObject<HTMLInputElement>} className="input num" inputMode="decimal" placeholder={mode === 'peso' ? 'Peso en kg' : 'Monto en MXN'} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))} enterKeyHint="done" />}
        {mode === 'gasto' && (
          <>
            <select className="select" value={txCat} onChange={(e) => setTxCat(e.target.value)} aria-label="Categoría del gasto">{TX_CATEGORIES.gasto.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <input className="input" placeholder="Descripción (opcional)" value={text} onChange={(e) => setText(e.target.value)} />
          </>
        )}
        {mode !== 'idea' && (
          <div className="grid cols-2">
            <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Fecha" />
            {mode === 'evento' && <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Hora" />}
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
