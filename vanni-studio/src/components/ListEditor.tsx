import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { uuid } from '../lib/ids';
import type { ListItem } from '../lib/types';

/** Lista editable (tomas, checklist, storyboard). Guarda en cuanto cambias algo. */
export function ListEditor({ items, onChange, placeholder = 'Agregar elemento', checkable = true, label }: { items: ListItem[] | null | undefined; onChange: (v: ListItem[]) => void; placeholder?: string; checkable?: boolean; label?: string }) {
  const list = items ?? [];
  const [text, setText] = useState('');
  const add = () => { const t = text.trim(); if (!t) return; onChange([...list, { id: uuid(), text: t, done: false }]); setText(''); };
  const set = (id: string, patch: Partial<ListItem>) => onChange(list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const move = (idx: number, dir: -1 | 1) => { const next = [...list]; const j = idx + dir; if (j < 0 || j >= next.length) return; [next[idx], next[j]] = [next[j], next[idx]]; onChange(next); };
  const done = list.filter((i) => i.done).length;
  return (
    <div className="stack tight">
      {label && <div className="row between"><span className="field-label">{label}</span>{checkable && list.length > 0 && <span className="xs faint">{done}/{list.length}</span>}</div>}
      {list.map((i, idx) => (
        <div key={i.id} className="row" style={{ gap: 6 }}>
          {checkable && <input type="checkbox" checked={!!i.done} onChange={(e) => set(i.id, { done: e.target.checked })} aria-label="Hecho" style={{ width: 20, height: 20, accentColor: 'var(--accent)', flex: 'none' }} />}
          <input className="input" value={i.text} onChange={(e) => set(i.id, { text: e.target.value })} style={{ textDecoration: i.done ? 'line-through' : undefined, opacity: i.done ? 0.6 : 1 }} aria-label="Texto" />
          <button type="button" className="icon-btn" aria-label="Subir" onClick={() => move(idx, -1)}><ArrowUp size={15} /></button>
          <button type="button" className="icon-btn" aria-label="Bajar" onClick={() => move(idx, 1)}><ArrowDown size={15} /></button>
          <button type="button" className="icon-btn" aria-label="Eliminar" onClick={() => onChange(list.filter((x) => x.id !== i.id))}><Trash2 size={15} /></button>
        </div>
      ))}
      <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} enterKeyHint="done" />
        <button type="submit" className="icon-btn bordered" aria-label="Agregar"><Plus size={18} /></button>
      </form>
    </div>
  );
}
