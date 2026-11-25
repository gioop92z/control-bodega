import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { useTable } from '../lib/store';
import { Card, Empty, PageHeader, Select, TextArea, TextField, Toggle, Tabs } from '../components/ui';
import { Kanban } from '../components/Kanban';
import { Sheet } from '../components/Sheet';
import { renderCustomInput } from '../components/CustomFields';
import { BarChart } from '../components/charts';
import { confirmAction } from '../components/toast';
import { addDays, dayLabel, today } from '../lib/dates';
import type { Collection, CollectionField, CollectionItem, CustomFieldType } from '../lib/types';

const FIELD_TYPES: Array<{ value: CustomFieldType; label: string }> = [
  { value: 'text', label: 'Texto' }, { value: 'textarea', label: 'Texto largo' }, { value: 'number', label: 'Número' }, { value: 'date', label: 'Fecha' },
  { value: 'select', label: 'Opciones' }, { value: 'checkbox', label: 'Sí / No' }, { value: 'url', label: 'Enlace' }, { value: 'rating', label: 'Calificación 1–10' },
];
const KIND_LABEL = { list: 'Lista', tracker: 'Seguimiento diario', board: 'Tablero' } as const;

export function FieldsEditor({ fields, onChange }: { fields: CollectionField[]; onChange: (f: CollectionField[]) => void }) {
  return (
    <div className="stack tight">
      {fields.map((f, i) => (
        <div key={f.key} className="grid" style={{ gridTemplateColumns: '1fr 150px auto', gap: 6 }}>
          <input className="input" value={f.label} onChange={(e) => onChange(fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Nombre del campo" />
          <select className="select" value={f.type} onChange={(e) => onChange(fields.map((x, j) => (j === i ? { ...x, type: e.target.value as CustomFieldType } : x)))} aria-label="Tipo">{FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
          <button className="icon-btn" type="button" aria-label="Quitar campo" onClick={() => onChange(fields.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
          {f.type === 'select' && <input className="input" style={{ gridColumn: '1 / -1' }} placeholder="Opciones separadas por coma" value={(f.options ?? []).join(', ')} onChange={(e) => onChange(fields.map((x, j) => (j === i ? { ...x, options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } : x)))} />}
        </div>
      ))}
      <button className="btn sm" type="button" onClick={() => onChange([...fields, { key: `f${Date.now().toString(36)}`, label: 'Nuevo campo', type: 'text' }])}><Plus size={14} />Campo</button>
    </div>
  );
}

export function CollectionsPage() {
  const t = useTable('collections');
  const items = useTable('collection_items').rows;
  const navigate = useNavigate();
  const create = (kind: Collection['kind']) => {
    const presets: Record<string, Partial<Collection>> = {
      list: { name: 'Nueva lista', fields: [{ key: 'nota', label: 'Nota', type: 'text' }] },
      tracker: { name: 'Nuevo seguimiento', fields: [{ key: 'valor', label: 'Valor', type: 'number' }, { key: 'nota', label: 'Nota', type: 'text' }] },
      board: { name: 'Nuevo tablero', columns: [{ key: 'pendiente', label: 'Pendiente' }, { key: 'en_curso', label: 'En curso' }, { key: 'hecho', label: 'Hecho' }], fields: [] },
    };
    const c = t.insert({ kind, fields: [], columns: [], sort: t.rows.length, ...presets[kind] });
    navigate(`/colecciones/${c.id}`);
  };
  return (
    <div>
      <PageHeader eyebrow="Personalización" title="Colecciones" description="Crea tus propias listas, seguimientos de actividades y tableros con los campos que necesites, sin tocar código. No se limita al fitness." actions={<><button className="btn" type="button" onClick={() => create('list')}><Plus size={16} />Lista</button><button className="btn" type="button" onClick={() => create('tracker')}><Plus size={16} />Seguimiento</button><button className="btn primary" type="button" onClick={() => create('board')}><Plus size={16} />Tablero</button></>} />
      {t.rows.length ? <div className="grid auto">{t.rows.sort((a, b) => a.sort - b.sort).map((c) => <Link key={c.id} to={`/colecciones/${c.id}`} className="card link stack tight"><span className="badge">{KIND_LABEL[c.kind]}</span><b>{c.name}</b><span className="xs faint">{items.filter((i) => i.collection_id === c.id).length} elementos · {c.fields.length} campos</span></Link>)}</div>
        : <Empty title="Sin colecciones">Ejemplos: «Libros por leer», «Seguimiento de agua», «Tablero de la universidad», «Equipo de grabación».</Empty>}
    </div>
  );
}

function ItemSheet({ item, collection, onClose }: { item: CollectionItem | null; collection: Collection; onClose: () => void }) {
  const t = useTable('collection_items');
  const live = item ? t.byId.get(item.id) : undefined;
  if (!live) return null;
  const set = (p: Partial<CollectionItem>) => t.update(live.id, p);
  return (
    <Sheet open={!!live} onClose={onClose} title={live.title || 'Elemento'} footer={<><button className="btn danger" type="button" onClick={() => { t.remove(live.id); onClose(); }}><Trash2 size={15} />Eliminar</button><button className="btn primary" type="button" onClick={onClose}>Listo</button></>}>
      <div className="form-grid two">
        <TextField className="span-2" label="Título" value={live.title} onChange={(v) => set({ title: v })} />
        {collection.kind === 'tracker' && <label className="field"><span>Día</span><input className="input" type="date" value={live.day ?? ''} onChange={(e) => set({ day: e.target.value || null })} /></label>}
        {collection.kind === 'board' && <Select label="Columna" value={live.column_key ?? collection.columns[0]?.key} onChange={(v) => set({ column_key: v })} options={collection.columns.map((c) => ({ value: c.key, label: c.label }))} />}
        {collection.kind === 'list' && <Toggle label="Hecho" checked={live.done} onChange={(v) => set({ done: v })} />}
        {collection.fields.map((f) => renderCustomInput(f, live.data?.[f.key], (v) => set({ data: { ...(live.data ?? {}), [f.key]: v } })))}
      </div>
    </Sheet>
  );
}

export function CollectionDetailPage() {
  const { id } = useParams();
  const t = useTable('collections');
  const itemsT = useTable('collection_items');
  const navigate = useNavigate();
  const [open, setOpen] = useState<CollectionItem | null>(null);
  const [tab, setTab] = useState<'items' | 'config'>('items');
  const [text, setText] = useState('');
  const c = t.byId.get(id ?? '');
  if (!c) return t.ready ? <Empty title="Colección no encontrada" action={<Link className="btn" to="/colecciones">Volver</Link>} /> : null;
  const set = (p: Partial<Collection>) => t.update(c.id, p);
  const items = itemsT.rows.filter((i) => i.collection_id === c.id).sort((a, b) => (c.kind === 'tracker' ? (b.day ?? '').localeCompare(a.day ?? '') : a.sort - b.sort || (a.created_at ?? '').localeCompare(b.created_at ?? '')));
  const add = (extra: Partial<CollectionItem> = {}) => { const it = itemsT.insert({ collection_id: c.id, title: text.trim(), data: {}, done: false, sort: items.length, day: c.kind === 'tracker' ? today() : null, column_key: c.kind === 'board' ? c.columns[0]?.key ?? null : null, ...extra }); setText(''); return it; };
  const numField = c.fields.find((f) => f.type === 'number');
  const last30 = Array.from({ length: 30 }, (_, i) => addDays(today(), i - 29));
  return (
    <div>
      <Link to="/colecciones" className="btn ghost sm" style={{ marginBottom: 8 }}><ChevronLeft size={16} />Colecciones</Link>
      <PageHeader eyebrow={KIND_LABEL[c.kind]} title={c.name} description={c.description ?? undefined} />
      <div style={{ marginBottom: 14 }}><Tabs value={tab} onChange={setTab} options={[{ value: 'items', label: 'Elementos' }, { value: 'config', label: 'Configurar' }]} /></div>
      {tab === 'config' ? (
        <div className="stack">
          <TextField label="Nombre" value={c.name} onChange={(v) => set({ name: v })} />
          <TextArea label="Descripción" value={c.description} onChange={(v) => set({ description: v })} rows={2} />
          <Card title="Campos"><FieldsEditor fields={c.fields} onChange={(f) => set({ fields: f })} /></Card>
          {c.kind === 'board' && <Card title="Columnas"><FieldsEditor fields={c.columns.map((x) => ({ key: x.key, label: x.label, type: 'text' as const }))} onChange={(f) => set({ columns: f.map((x) => ({ key: x.key, label: x.label })) })} /></Card>}
          <button className="btn danger" type="button" onClick={() => { if (confirmAction('¿Eliminar la colección y sus elementos?')) { t.remove(c.id); navigate('/colecciones'); } }}><Trash2 size={15} />Eliminar colección</button>
        </div>
      ) : (
        <div className="stack">
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (text.trim() || c.kind === 'tracker') setOpen(add()); }}>
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={c.kind === 'tracker' ? 'Registro de hoy (opcional)' : 'Nuevo elemento…'} />
            <button className="btn primary" type="submit"><Plus size={16} />Agregar</button>
          </form>
          {c.kind === 'tracker' && numField && (
            <Card title={`${numField.label} · últimos 30 días`}>
              <BarChart ariaLabel={`${numField.label} por día`} labels={last30.map((d) => dayLabel(d))} values={last30.map((d) => { const v = items.filter((i) => i.day === d).reduce((a, i) => a + (Number(i.data?.[numField.key]) || 0), 0); return v || null; })} seriesLabel={numField.label} />
            </Card>
          )}
          {c.kind === 'board' ? (
            <Kanban columns={c.columns} items={items} columnOf={(i) => i.column_key ?? c.columns[0]?.key ?? ''} onMove={(i, col) => itemsT.update(i.id, { column_key: col })} onOpen={setOpen} renderCard={(i) => <span className="title">{i.title || 'Sin título'}</span>} />
          ) : items.length ? (
            <div className="list">{items.map((i) => (
              <div key={i.id} className="list-item">
                {c.kind === 'list' && <input type="checkbox" checked={i.done} aria-label="Hecho" style={{ width: 22, height: 22, accentColor: 'var(--accent)' }} onChange={(e) => itemsT.update(i.id, { done: e.target.checked })} />}
                <button type="button" className="grow" style={{ background: 'none', border: 0, textAlign: 'left', color: 'inherit', cursor: 'pointer', padding: 0 }} onClick={() => setOpen(i)}>
                  <span className="small" style={{ textDecoration: i.done ? 'line-through' : undefined }}>{c.kind === 'tracker' && i.day ? `${dayLabel(i.day)} · ` : ''}{i.title || 'Sin título'}</span>
                  <br /><span className="xs faint">{c.fields.slice(0, 3).map((f) => (i.data?.[f.key] !== undefined && i.data?.[f.key] !== '' ? `${f.label}: ${String(i.data[f.key])}` : null)).filter(Boolean).join(' · ')}</span>
                </button>
              </div>
            ))}</div>
          ) : <Empty title="Sin elementos" />}
        </div>
      )}
      <ItemSheet item={open} collection={c} onClose={() => setOpen(null)} />
    </div>
  );
}
