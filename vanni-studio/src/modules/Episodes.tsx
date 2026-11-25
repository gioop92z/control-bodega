import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CalendarPlus, ChevronLeft, Link2, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { useTable } from '../lib/store';
import { Card, Chips, DateField, Empty, Kpi, NumberField, PageHeader, SaveIndicator, Select, TagInput, TextArea, TextField } from '../components/ui';
import { Attachments, CoverPicker } from '../components/Attachments';
import { CustomFieldsEditor } from '../components/CustomFields';
import { ListEditor } from '../components/ListEditor';
import { Kanban } from '../components/Kanban';
import { Sheet } from '../components/Sheet';
import { useToast, confirmAction } from '../components/toast';
import { EPISODE_STAGES, stageLabel } from '../lib/constants';
import { combine, today } from '../lib/dates';
import { engagementRate, interactions, mediaMetric } from '../lib/analytics';
import { money, n, pct } from '../lib/format';
import { uuid } from '../lib/ids';
import { useProfile } from '../lib/profile';
import { MediaThumb, TemplateMenu } from './shared';
import type { Episode, EpisodeStatus, IgMedia } from '../lib/types';

function PickMediaSheet({ open, onClose, onPick, exclude }: { open: boolean; onClose: () => void; onPick: (m: IgMedia) => void; exclude: Set<string> }) {
  const media = useTable('ig_media').rows.filter((m) => !exclude.has(m.ig_media_id));
  const [q, setQ] = useState('');
  const list = media.filter((m) => !q || (m.caption ?? '').toLowerCase().includes(q.toLowerCase())).slice(0, 80);
  return (
    <Sheet open={open} onClose={onClose} title="Vincular publicación de Instagram">
      <div className="stack">
        <input className="input" placeholder="Buscar por texto…" value={q} onChange={(e) => setQ(e.target.value)} />
        {list.length ? <div className="list">{list.map((m) => <button key={m.id} type="button" className="list-item" onClick={() => { onPick(m); onClose(); }}><MediaThumb m={m} /><span className="grow small truncate">{m.caption || 'Sin texto'}</span><span className="xs faint">{m.posted_at?.slice(0, 10)}</span></button>)}</div> : <p className="muted small">No hay publicaciones importadas disponibles. Conecta Instagram para importarlas.</p>}
      </div>
    </Sheet>
  );
}

export function EpisodeEditorPage() {
  const { id } = useParams();
  const epT = useTable('episodes');
  const seriesT = useTable('series');
  const seasonsT = useTable('seasons');
  const gyms = useTable('gyms').rows;
  const contactsT = useTable('contacts');
  const linksT = useTable('media_links');
  const media = useTable('ig_media').rows;
  const events = useTable('events');
  const { currency } = useProfile();
  const navigate = useNavigate();
  const toast = useToast();
  const [pick, setPick] = useState(false);
  const e = epT.byId.get(id ?? '');
  if (!e) return epT.ready ? <Empty title="Episodio no encontrado" action={<Link className="btn" to="/series">Volver</Link>} /> : null;
  const set = (patch: Partial<Episode>) => epT.update(e.id, patch);
  const series = e.series_id ? seriesT.byId.get(e.series_id) : undefined;
  const seasons = seasonsT.rows.filter((x) => x.series_id === e.series_id).sort((a, b) => a.number - b.number);
  const linked = linksT.rows.filter((l) => l.episode_id === e.id);
  const linkedMedia = linked.map((l) => media.find((m) => m.ig_media_id === l.ig_media_id)).filter((m): m is IgMedia => !!m);
  const sum = (k: string) => linkedMedia.reduce((a, m) => a + (mediaMetric(m, k) ?? 0), 0);
  const collaborators = (e.collaborator_ids ?? []).map((cid) => contactsT.byId.get(cid)).filter(Boolean);

  const link = (m: IgMedia) => {
    const existing = linksT.rows.find((l) => l.ig_media_id === m.ig_media_id);
    if (existing) linksT.update(existing.id, { episode_id: e.id, series_id: e.series_id });
    else linksT.insert({ ig_media_id: m.ig_media_id, episode_id: e.id, series_id: e.series_id });
    toast('Publicación vinculada al episodio', 'success');
  };
  const schedule = (kind: 'grabacion' | 'publicacion') => {
    const day = kind === 'grabacion' ? e.record_date : e.publish_date;
    if (!day) { toast(`Primero indica la fecha de ${kind === 'grabacion' ? 'grabación' : 'publicación'}`, 'error'); return; }
    const time = kind === 'grabacion' ? (e.record_time?.slice(0, 5) || '18:00') : '19:00';
    events.insert({ title: `${kind === 'grabacion' ? 'Grabar' : 'Publicar'}: ${e.title}`, category: kind, start_at: combine(day, time), all_day: false, priority: 1, status: 'pendiente', location: e.location ?? null, linked_type: 'episode', linked_id: e.id, exdates: [], done_dates: [] });
    toast('Agregado a la agenda', 'success');
  };
  const addCollaborator = () => {
    const name = window.prompt('Nombre del colaborador (se guardará en Contactos)');
    if (!name) return;
    const c = contactsT.insert({ name, kind: 'colaborador' });
    set({ collaborator_ids: [...(e.collaborator_ids ?? []), c.id] });
  };

  return (
    <div>
      <div className="row between wrap" style={{ marginBottom: 8 }}>
        <Link to={series ? `/series/${series.id}` : '/produccion'} className="btn ghost sm"><ChevronLeft size={16} />{series?.title ?? 'Producción'}</Link>
        <div className="row"><SaveIndicator /><TemplateMenu target="episodes" current={() => { const { id: _i, series_id: _s, season_id: _se, number: _n, record_date: _r, publish_date: _p, ...rest } = e; return { ...rest } as Record<string, unknown>; }} onApply={(d) => set({ ...(d as Partial<Episode>), title: (d.title as string) || e.title })} /></div>
      </div>
      <div className="stack">
        <TextField label="Título del episodio" value={e.title} onChange={(v) => set({ title: v })} />
        <div className="field"><span className="field-label">Etapa</span><Chips scroll value={e.status} onChange={(v) => set({ status: v as EpisodeStatus, ...(v === 'publicado' && !e.publish_date ? { publish_date: today() } : {}) })} options={EPISODE_STAGES.map((s) => ({ value: s.key, label: s.label }))} /></div>
        <div className="form-grid two">
          <Select label="Serie" value={e.series_id ?? ''} placeholder="— Sin serie —" onChange={(v) => set({ series_id: v || null, season_id: null })} options={seriesT.rows.map((s) => ({ value: s.id, label: s.title }))} />
          <Select label="Temporada" value={e.season_id ?? ''} placeholder="— Sin temporada —" onChange={(v) => set({ season_id: v || null })} options={seasons.map((s) => ({ value: s.id, label: `Temporada ${s.number}${s.title ? ` · ${s.title}` : ''}` }))} />
          <NumberField label="Número de episodio" value={e.number} onChange={(v) => set({ number: v })} />
          <Select label="Gimnasio" value={e.gym_id ?? ''} placeholder="— Ninguno —" onChange={(v) => set({ gym_id: v || null })} options={gyms.map((g) => ({ value: g.id, label: g.name || 'Sin nombre' }))} />
          <TextField className="span-2" label="Ubicación" value={e.location} onChange={(v) => set({ location: v })} placeholder="Dirección o lugar de grabación" />
          <DateField label="Fecha de grabación" value={e.record_date} onChange={(v) => set({ record_date: v })} />
          <DateField label="Hora de grabación" type="time" value={e.record_time?.slice(0, 5)} onChange={(v) => set({ record_time: v })} />
          <DateField label="Fecha de publicación" value={e.publish_date} onChange={(v) => set({ publish_date: v })} />
          <div className="field"><span className="field-label">Agenda</span><div className="row wrap"><button className="btn sm" type="button" onClick={() => schedule('grabacion')}><CalendarPlus size={14} />Grabación</button><button className="btn sm" type="button" onClick={() => schedule('publicacion')}><CalendarPlus size={14} />Publicación</button></div></div>
          <NumberField label="Presupuesto" suffix={currency} value={e.budget} onChange={(v) => set({ budget: v })} />
          <NumberField label="Costo real" suffix={currency} value={e.cost} onChange={(v) => set({ cost: v })} hint={e.budget ? `${money(e.cost ?? 0, currency)} de ${money(e.budget, currency)}` : undefined} />
        </div>
        <TextArea label="Hook (primeros 3 segundos)" value={e.hook} onChange={(v) => set({ hook: v })} rows={2} />
        <TextArea label="Sinopsis" value={e.synopsis} onChange={(v) => set({ synopsis: v })} rows={3} />
        <TextArea label="Guion" script value={e.script} onChange={(v) => set({ script: v })} placeholder={'ESCENA 1 — EXTERIOR NOCHE\nVoz en off: …'} />
        <div className="grid halves">
          <Card><ListEditor label="Lista de tomas" items={e.shotlist} onChange={(v) => set({ shotlist: v })} placeholder="Plano general de la entrada…" /></Card>
          <Card><ListEditor label="Checklist de producción" items={e.checklist} onChange={(v) => set({ checklist: v })} placeholder="Cargar baterías, permiso del gym…" /></Card>
        </div>

        <Card title="Colaboradores" action={<button className="btn sm" type="button" onClick={addCollaborator}><UserPlus size={14} />Nuevo</button>}>
          <div className="chips">
            {collaborators.map((c) => c && <span key={c.id} className="chip active">{c.name}<button type="button" className="icon-btn" style={{ width: 22, height: 22 }} aria-label={`Quitar ${c.name}`} onClick={() => set({ collaborator_ids: e.collaborator_ids.filter((x) => x !== c.id) })}><X size={12} /></button></span>)}
          </div>
          <div style={{ marginTop: 10 }}><Select value="" placeholder="Agregar desde contactos…" onChange={(v) => v && set({ collaborator_ids: [...new Set([...(e.collaborator_ids ?? []), v])] })} options={contactsT.rows.filter((c) => !e.collaborator_ids?.includes(c.id)).map((c) => ({ value: c.id, label: `${c.name}${c.instagram ? ` (@${c.instagram.replace('@', '')})` : ''}` }))} /></div>
        </Card>

        <Card title="Referencias visuales">
          <RefsEditor refs={e.refs ?? []} onChange={(v) => set({ refs: v })} />
          <div style={{ marginTop: 12 }}><Attachments entityType="episode" entityId={e.id} kind="reference" title="Imágenes de referencia" accept="image/*" allowLinks={false} /></div>
        </Card>
        <Card title="Fotos y videos del episodio"><Attachments entityType="episode" entityId={e.id} kind="photo" title="Material" /></Card>
        <div className="grid halves">
          <Card title="Portada"><CoverPicker path={e.cover_path} onChange={(p) => set({ cover_path: p })} folder={`episodes/${e.id}`} poster /></Card>
          <Card title="Notas y etiquetas"><div className="stack"><TextArea label="Notas" value={e.notes} onChange={(v) => set({ notes: v })} /><TagInput value={e.tags} onChange={(v) => set({ tags: v })} /><CustomFieldsEditor entity="episodes" value={e.custom} onChange={(v) => set({ custom: v })} /></div></Card>
        </div>

        <Card title="Publicaciones reales de Instagram" action={<button className="btn sm" type="button" onClick={() => setPick(true)}><Link2 size={14} />Vincular</button>}>
          {linkedMedia.length ? (
            <>
              <div className="grid kpis" style={{ marginBottom: 12 }}>
                <Kpi label="Alcance" value={n(sum('reach'))} source="calc" />
                <Kpi label="Reproducciones" value={n(sum('views'))} source="calc" />
                <Kpi label="Interacciones" value={n(linkedMedia.reduce((a, m) => a + (interactions(m) ?? 0), 0))} source="calc" />
                <Kpi label="Interacción / alcance" value={pct(linkedMedia.length === 1 ? engagementRate(linkedMedia[0]) : sum('reach') ? linkedMedia.reduce((a, m) => a + (interactions(m) ?? 0), 0) / sum('reach') : null)} source="calc" />
              </div>
              <div className="list">{linkedMedia.map((m) => <div key={m.id} className="list-item" style={{ cursor: 'default' }}><MediaThumb m={m} /><span className="grow small truncate">{m.caption || 'Sin texto'}</span><button className="btn sm ghost" type="button" onClick={() => { const l = linked.find((x) => x.ig_media_id === m.ig_media_id); if (l) linksT.remove(l.id); }}>Quitar</button></div>)}</div>
            </>
          ) : <p className="muted small" style={{ margin: 0 }}>Cuando publiques, vincula aquí el reel o la publicación para medir el episodio con datos reales.</p>}
        </Card>
        <button className="btn danger" type="button" onClick={() => { if (confirmAction('¿Eliminar este episodio?')) { epT.remove(e.id); navigate(series ? `/series/${series.id}` : '/produccion'); } }}><Trash2 size={15} />Eliminar episodio</button>
      </div>
      <PickMediaSheet open={pick} onClose={() => setPick(false)} onPick={link} exclude={new Set(linked.map((l) => l.ig_media_id))} />
    </div>
  );
}

function RefsEditor({ refs, onChange }: { refs: Episode['refs']; onChange: (v: Episode['refs']) => void }) {
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  return (
    <div className="stack tight">
      {refs.map((r) => <div key={r.id} className="row" style={{ gap: 6 }}><a className="grow small truncate" href={r.url} target="_blank" rel="noreferrer">{r.note || r.url}</a><button type="button" className="icon-btn" aria-label="Quitar" onClick={() => onChange(refs.filter((x) => x.id !== r.id))}><X size={15} /></button></div>)}
      <form className="grid" style={{ gridTemplateColumns: '1fr 1fr auto', gap: 6 }} onSubmit={(ev) => { ev.preventDefault(); if (!/^https?:\/\//.test(url)) return; onChange([...refs, { id: uuid(), url, note: note || undefined }]); setUrl(''); setNote(''); }}>
        <input className="input" type="url" inputMode="url" placeholder="https://…" value={url} onChange={(ev) => setUrl(ev.target.value)} />
        <input className="input" placeholder="Nota" value={note} onChange={(ev) => setNote(ev.target.value)} />
        <button className="icon-btn bordered" type="submit" aria-label="Agregar referencia"><Plus size={18} /></button>
      </form>
    </div>
  );
}

export function ProductionPage() {
  const epT = useTable('episodes');
  const seriesT = useTable('series');
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const items = useMemo(() => epT.rows.filter((e) => !filter || e.series_id === filter).sort((a, b) => a.sort - b.sort || (a.created_at ?? '').localeCompare(b.created_at ?? '')), [epT.rows, filter]);
  const create = (status: EpisodeStatus) => { const e = epT.insert({ series_id: filter || null, title: 'Nuevo episodio', status, refs: [], collaborator_ids: [], shotlist: [], checklist: [], sort: epT.rows.length } as Partial<Episode>); navigate(`/episodios/${e.id}`); };
  return (
    <div>
      <PageHeader eyebrow="Kanban" title="Producción" description="Idea → Planeación → Grabación → Edición → Programado → Publicado → Analizado. Mantén pulsada una tarjeta para moverla." actions={<Select value={filter} placeholder="Todas las series" onChange={setFilter} options={seriesT.rows.map((s) => ({ value: s.id, label: s.title }))} />} />
      <Kanban
        columns={EPISODE_STAGES}
        items={items}
        columnOf={(e) => e.status}
        onMove={(e, col) => epT.update(e.id, { status: col as EpisodeStatus, ...(col === 'publicado' && !e.publish_date ? { publish_date: today() } : {}) })}
        onOpen={(e) => navigate(`/episodios/${e.id}`)}
        renderCard={(e) => {
          const s = e.series_id ? seriesT.byId.get(e.series_id) : undefined;
          const checks = e.checklist ?? [];
          return (
            <div className="stack tight">
              <div className="row" style={{ gap: 6 }}><span className="dot" style={{ background: s?.color ?? 'var(--text-3)' }} /><span className="xs faint truncate">{s?.title ?? 'Sin serie'}{e.number ? ` · #${e.number}` : ''}</span></div>
              <span className="title">{e.title || 'Sin título'}</span>
              <span className="xs faint">{e.record_date ? `🎬 ${e.record_date}` : ''}{e.publish_date ? `  📅 ${e.publish_date}` : ''}{checks.length ? `  ✓ ${checks.filter((c) => c.done).length}/${checks.length}` : ''}</span>
              <select className="select" style={{ minHeight: 34, fontSize: 13, padding: '4px 28px 4px 8px' }} aria-label="Mover a etapa" value={e.status}
                onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => ev.stopPropagation()} onKeyDown={(ev) => ev.stopPropagation()}
                onChange={(ev) => epT.update(e.id, { status: ev.target.value as EpisodeStatus })}>{EPISODE_STAGES.map((st) => <option key={st.key} value={st.key}>{stageLabel(st.key)}</option>)}</select>
            </div>
          );
        }}
        columnFooter={(c) => <button className="btn sm ghost" type="button" onClick={() => create(c.key as EpisodeStatus)}><Plus size={14} />Agregar</button>}
      />
    </div>
  );
}
