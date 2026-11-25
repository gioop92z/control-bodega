import { useState } from 'react';
import { Pin, Plus, Search, Trash2 } from 'lucide-react';
import { useTable } from '../lib/store';
import { Empty, PageHeader, Select, TagInput, TextArea, TextField, Toggle } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { relativeTime } from '../lib/dates';

export function NotesPage() {
  const t = useTable('notes');
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const folders = [...new Set(t.rows.map((n) => n.folder).filter(Boolean) as string[])].sort();
  const list = t.rows.filter((n) => (!folder || n.folder === folder) && (!q || `${n.title} ${n.body ?? ''} ${(n.tags ?? []).join(' ')}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  const cur = open ? t.byId.get(open) : undefined;
  return (
    <div>
      <PageHeader eyebrow="Privadas" title="Notas" actions={<button className="btn primary" type="button" onClick={() => setOpen(t.insert({ title: '', body: '', folder: folder || null, pinned: false }).id)}><Plus size={16} />Nota</button>} />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 14 }}>
        <label className="field"><span>Buscar</span><div className="row" style={{ gap: 6 }}><Search size={16} color="var(--text-3)" /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} /></div></label>
        <Select label="Carpeta" value={folder} placeholder="Todas" onChange={setFolder} options={folders.map((f) => ({ value: f, label: f }))} />
      </div>
      {list.length ? <div className="grid auto">{list.map((n) => <button key={n.id} type="button" className="card link tight stack tight" style={{ textAlign: 'left', color: 'inherit', cursor: 'pointer' }} onClick={() => setOpen(n.id)}><div className="row between"><b className="truncate">{n.title || 'Sin título'}</b>{n.pinned && <Pin size={14} color="var(--accent)" />}</div><span className="small muted clamp-2">{n.body}</span><span className="xs faint">{n.folder ? `${n.folder} · ` : ''}{relativeTime(n.updated_at)}</span></button>)}</div> : <Empty title="Sin notas" />}
      <Sheet open={!!cur} onClose={() => setOpen(null)} title="Nota" wide footer={cur && <><button className="btn danger" type="button" onClick={() => { t.remove(cur.id); setOpen(null); }}><Trash2 size={15} />Eliminar</button><button className="btn primary" type="button" onClick={() => setOpen(null)}>Listo</button></>}>
        {cur && <div className="stack">
          <TextField label="Título" value={cur.title} onChange={(v) => t.update(cur.id, { title: v })} />
          <TextArea label="Contenido" script value={cur.body} onChange={(v) => t.update(cur.id, { body: v })} />
          <div className="form-grid two"><TextField label="Carpeta" value={cur.folder} onChange={(v) => t.update(cur.id, { folder: v || null })} /><Toggle label="Fijar" checked={cur.pinned} onChange={(v) => t.update(cur.id, { pinned: v })} /></div>
          <TagInput value={cur.tags} onChange={(v) => t.update(cur.id, { tags: v })} />
        </div>}
      </Sheet>
    </div>
  );
}
