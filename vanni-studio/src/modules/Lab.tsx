import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowRightLeft, ChevronLeft, Pin, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { useTable } from '../lib/store';
import { Card, Chips, Empty, PageHeader, SaveIndicator, Select, TagInput, TextArea, TextField, Toggle } from '../components/ui';
import { Attachments } from '../components/Attachments';
import { CustomFieldsEditor } from '../components/CustomFields';
import { ListEditor } from '../components/ListEditor';
import { Sheet } from '../components/Sheet';
import { useToast, confirmAction } from '../components/toast';
import { IDEA_KINDS, IDEA_STATUSES } from '../lib/constants';
import { bestTimes, cellLabel, formatStats, mediaMetric, topMedia } from '../lib/analytics';
import { combine, relativeTime, today } from '../lib/dates';
import { pct } from '../lib/format';
import { useAnalysis } from './Analysis';
import { useCategoryOptions, TemplateMenu } from './shared';
import type { Episode, Idea } from '../lib/types';

/** Estructuras de hooks probadas como punto de partida. Son plantillas fijas, no texto generado. */
const HOOK_TEMPLATES = [
  'Encontré el gimnasio más {adjetivo} de {ciudad}… y nadie lo conoce.',
  'Pagué {precio} por entrenar aquí. ¿Valió la pena?',
  'Esta máquina tiene {años} años y sigue destruyendo piernas.',
  'Le pregunté a un desconocido cuál es su mejor ejercicio y esto pasó.',
  'Gym barato vs. gym premium: misma rutina, resultados distintos.',
  'Son las {hora} y este gimnasio sigue lleno. Así se entrena de noche.',
  'Nadie entrena aquí. Por eso vine.',
  '3 cosas que no sabías de {tema} (la última me sorprendió).',
];

function useSuggestions() {
  const a = useAnalysis();
  return useMemo(() => {
    const posts = a.media.filter((m) => !m.is_story);
    if (!posts.some((m) => mediaMetric(m, 'reach') !== null)) return [];
    const out: Array<{ id: string; title: string; body: string; basis: string; seriesId?: string }> = [];
    const fmts = formatStats(posts).filter((f) => f.n >= 3 && f.medianER !== null).sort((x, y) => y.medianER! - x.medianER!);
    const bestSeries = a.perf.filter((p) => p.posts >= 2 && p.medianER !== null).sort((x, y) => y.medianER! - x.medianER!)[0];
    const time = bestTimes(posts).top[0];
    const saves = topMedia(posts, 'saved', 1)[0];
    const shares = topMedia(posts, 'shares', 1)[0];
    if (bestSeries) out.push({ id: 'series', seriesId: bestSeries.series.id, title: `Nuevo episodio de ${bestSeries.series.title}`, body: `Formato: ${fmts[0]?.label ?? 'Reel'}.${time ? ` Publicar: ${cellLabel(time)}.` : ''}`, basis: `Serie con mejor interacción (${pct(bestSeries.medianER)} mediana, ${bestSeries.posts} publicaciones).` });
    if (saves) out.push({ id: 'saves', title: 'Versión ampliada de tu publicación más guardada', body: `Retoma el tema de «${(saves.media.caption ?? '').slice(0, 80)}» con más detalle o en formato guía/carrusel.`, basis: `${saves.value} guardados: el valor más alto de tus publicaciones.` });
    if (shares) out.push({ id: 'shares', title: 'Segunda parte del contenido más compartido', body: `Continúa la idea de «${(shares.media.caption ?? '').slice(0, 80)}» y menciónalo en el hook.`, basis: `${shares.value} compartidos.` });
    if (fmts.length >= 2) out.push({ id: 'format', title: `Prioriza ${fmts[0].label.toLowerCase()} esta semana`, body: `Planea 2 piezas en formato ${fmts[0].label.toLowerCase()} y compáralas con tu mediana.`, basis: `${fmts[0].label}: ${pct(fmts[0].medianER)} vs. ${fmts[fmts.length - 1].label}: ${pct(fmts[fmts.length - 1].medianER)} (mediana de interacción).` });
    return out;
  }, [a.media, a.perf]);
}

export function LabPage() {
  const ideas = useTable('ideas');
  const series = useTable('series').rows;
  const navigate = useNavigate();
  const toast = useToast();
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('activas');
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState('');
  const [tag, setTag] = useState('');
  const [templates, setTemplates] = useState(false);
  const suggestions = useSuggestions();
  const allTags = [...new Set(ideas.rows.flatMap((i) => i.tags ?? []))].sort();
  const list = ideas.rows
    .filter((i) => kind === 'all' || i.kind === kind)
    .filter((i) => status === 'todas' || (status === 'activas' ? !['usada', 'descartada'].includes(i.status) : i.status === status))
    .filter((i) => !tag || i.tags?.includes(tag))
    .filter((i) => !q || `${i.title} ${i.body ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  const add = (data: Partial<Idea>, open = true) => { const i = ideas.insert({ kind: 'idea', status: 'nueva', priority: 2, items: [], converted: [], pinned: false, ...data }); if (open) navigate(`/laboratorio/${i.id}`); return i; };
  const quickSave = () => { const t = quick.trim(); if (!t) return; add({ title: t.split('\n')[0].slice(0, 140), body: t.includes('\n') ? t : null }, false); setQuick(''); toast('Idea guardada', 'success'); };

  return (
    <div>
      <PageHeader eyebrow="Laboratorio creativo" title="Ideas" description="Banco ilimitado de ideas, hooks, guiones, tomas, storyboards y referencias. Convierte cualquier idea en episodio, publicación o actividad." actions={<><button className="btn" type="button" onClick={() => setTemplates(true)}>Plantillas de hooks</button><TemplateMenu target="ideas" label="Mis plantillas" onApply={(d) => add(d as Partial<Idea>)} /><button className="btn primary" type="button" onClick={() => add({ title: '' })}><Plus size={16} />Nueva</button></>} />
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); quickSave(); }}>
        <span className="kicker">Captura rápida</span>
        <div className="row"><input className="input" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Una idea espontánea… (Enter para guardar)" enterKeyHint="done" /><button className="btn primary" type="submit">Guardar</button></div>
      </form>

      {suggestions.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Sugerencias con tus datos</h2><span className="badge"><Sparkles size={12} />Estadística + plantilla · sin IA</span></div>
          <div className="grid auto">
            {suggestions.map((s) => (
              <div key={s.id} className="card tight stack tight">
                <b>{s.title}</b><span className="small muted">{s.body}</span><span className="xs faint">Basado en: {s.basis}</span>
                <button className="btn sm" type="button" onClick={() => add({ kind: 'reel', title: s.title, body: `${s.body}\n\nBasado en: ${s.basis}`, series_id: s.seriesId ?? null })}>Guardar como idea</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="stack" style={{ marginBottom: 12 }}>
          <Chips scroll value={kind} onChange={setKind} options={[{ value: 'all', label: 'Todo' }, ...IDEA_KINDS.map((k) => ({ value: k.key, label: k.label }))]} />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <label className="field"><span>Buscar</span><div className="row" style={{ gap: 6 }}><Search size={16} color="var(--text-3)" /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Texto…" /></div></label>
            <Select label="Estado" value={status} onChange={setStatus} options={[{ value: 'activas', label: 'Activas' }, { value: 'todas', label: 'Todas' }, ...IDEA_STATUSES.map((s) => ({ value: s.key, label: s.label }))]} />
            <Select label="Etiqueta" value={tag} placeholder="Todas" onChange={setTag} options={allTags.map((t) => ({ value: t, label: `#${t}` }))} />
          </div>
        </div>
        {!list.length ? <Empty title="Sin ideas en esta vista">Captura la primera arriba o con el botón «+».</Empty> : (
          <div className="grid auto">
            {list.map((i) => (
              <Link key={i.id} to={`/laboratorio/${i.id}`} className="card link tight stack tight">
                <div className="row between"><span className="badge">{IDEA_KINDS.find((k) => k.key === i.kind)?.label ?? i.kind}</span>{i.pinned && <Pin size={14} color="var(--accent)" />}</div>
                <b className="clamp-2">{i.title || 'Sin título'}</b>
                {i.body && <span className="small muted clamp-2">{i.body}</span>}
                <span className="xs faint">{IDEA_STATUSES.find((s) => s.key === i.status)?.label} · {relativeTime(i.created_at)}{i.series_id ? ` · ${series.find((s) => s.id === i.series_id)?.title ?? ''}` : ''}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
      <Sheet open={templates} onClose={() => setTemplates(false)} title="Plantillas de hooks">
        <div className="stack">
          <p className="xs faint" style={{ margin: 0 }}>Estructuras para adaptar con tus datos. Sustituye lo que está entre llaves.</p>
          {HOOK_TEMPLATES.map((h) => <div key={h} className="row between card tight"><span className="small">{h}</span><button className="btn sm" type="button" onClick={() => { add({ kind: 'hook', title: h }); setTemplates(false); }}>Usar</button></div>)}
        </div>
      </Sheet>
    </div>
  );
}

export function IdeaEditorPage() {
  const { id } = useParams();
  const ideas = useTable('ideas');
  const series = useTable('series').rows;
  const episodes = useTable('episodes');
  const events = useTable('events');
  const tasks = useTable('tasks');
  const navigate = useNavigate();
  const toast = useToast();
  const [convert, setConvert] = useState(false);
  const [targetSeries, setTargetSeries] = useState('');
  const [when, setWhen] = useState(today());
  const kinds = useCategoryOptions('ideas', IDEA_KINDS);
  const i = ideas.byId.get(id ?? '');
  if (!i) return ideas.ready ? <Empty title="Idea no encontrada" action={<Link className="btn" to="/laboratorio">Volver</Link>} /> : null;
  const set = (patch: Partial<Idea>) => ideas.update(i.id, patch);
  const isList = IDEA_KINDS.find((k) => k.key === i.kind)?.list;
  const mark = (type: string, newId: string) => set({ converted: [...(i.converted ?? []), { type, id: newId, at: new Date().toISOString() }], status: 'usada' });

  const toEpisode = () => {
    const isHook = i.kind === 'hook';
    const e = episodes.insert({ series_id: targetSeries || i.series_id || null, title: isHook ? 'Nuevo episodio' : i.title || 'Nuevo episodio', hook: isHook ? i.title : null, synopsis: !isHook ? i.body ?? null : null, script: i.kind === 'guion' ? i.body ?? null : null, status: 'idea', refs: i.source_url ? [{ id: crypto.randomUUID(), url: i.source_url }] : [], collaborator_ids: [], shotlist: i.kind === 'tomas' ? i.items : [], checklist: i.kind === 'checklist' ? i.items : [], sort: 0, tags: i.tags ?? [] } as Partial<Episode>);
    mark('episode', e.id);
    toast('Episodio creado', 'success');
    navigate(`/episodios/${e.id}`);
  };
  const toEvent = (category: string) => {
    const ev = events.insert({ title: i.title || 'Idea', category, start_at: combine(when, '19:00'), all_day: false, priority: 2, status: 'pendiente', notes: i.body ?? null, linked_type: 'idea', linked_id: i.id, exdates: [], done_dates: [] });
    mark(category === 'publicacion' ? 'publication' : 'event', ev.id);
    toast(category === 'publicacion' ? 'Publicación programada en la agenda' : 'Evento creado', 'success');
    setConvert(false);
  };
  const toTask = () => {
    const t = tasks.insert({ title: i.title || 'Idea', notes: i.body ?? null, due_date: when, priority: i.priority, list_name: 'Contenido', done: false, linked_type: 'idea', linked_id: i.id, sort: 0 });
    mark('task', t.id);
    toast('Actividad creada en Tareas', 'success');
    setConvert(false);
  };

  return (
    <div>
      <div className="row between wrap" style={{ marginBottom: 8 }}>
        <Link to="/laboratorio" className="btn ghost sm"><ChevronLeft size={16} />Laboratorio</Link>
        <div className="row"><SaveIndicator /><TemplateMenu target="ideas" current={() => ({ kind: i.kind, title: i.title, body: i.body, items: i.items, music: i.music, tags: i.tags })} onApply={(d) => set(d as Partial<Idea>)} /><button className="btn primary sm" type="button" onClick={() => setConvert(true)}><ArrowRightLeft size={15} />Convertir</button></div>
      </div>
      <div className="stack">
        <div className="form-grid two">
          <Select label="Tipo" value={i.kind} onChange={(v) => set({ kind: v })} options={kinds} />
          <Select label="Estado" value={i.status} onChange={(v) => set({ status: v })} options={IDEA_STATUSES.map((s) => ({ value: s.key, label: s.label }))} />
        </div>
        <TextField label="Título" value={i.title} onChange={(v) => set({ title: v })} />
        <TextArea label={i.kind === 'guion' ? 'Guion' : i.kind === 'descripcion' ? 'Descripción (caption)' : 'Desarrollo'} script={i.kind === 'guion'} value={i.body} onChange={(v) => set({ body: v })} rows={6} />
        {isList && <Card><ListEditor label={i.kind === 'storyboard' ? 'Cuadros del storyboard' : i.kind === 'tomas' ? 'Tomas' : 'Checklist'} items={i.items} onChange={(v) => set({ items: v })} checkable={i.kind !== 'storyboard'} /></Card>}
        {i.kind === 'storyboard' && <Card title="Imágenes del storyboard"><Attachments entityType="idea" entityId={i.id} kind="storyboard" title="Cuadros" accept="image/*" allowLinks={false} /></Card>}
        <div className="form-grid two">
          <Select label="Serie" value={i.series_id ?? ''} placeholder="— Ninguna —" onChange={(v) => set({ series_id: v || null })} options={series.map((s) => ({ value: s.id, label: s.title }))} />
          <Select label="Prioridad" value={String(i.priority)} onChange={(v) => set({ priority: Number(v) })} options={[{ value: '1', label: 'Alta' }, { value: '2', label: 'Media' }, { value: '3', label: 'Baja' }]} />
          <TextField label="Referencia de tendencia (URL)" type="url" inputMode="url" value={i.source_url} onChange={(v) => set({ source_url: v || null })} placeholder="https://www.instagram.com/reel/…" />
          <TextField label="Referencia musical" value={i.music} onChange={(v) => set({ music: v || null })} placeholder="Canción · artista · enlace" />
        </div>
        <Toggle label="Fijar arriba" checked={i.pinned} onChange={(v) => set({ pinned: v })} />
        <TagInput value={i.tags} onChange={(v) => set({ tags: v })} />
        <CustomFieldsEditor entity="ideas" value={i.custom} onChange={(v) => set({ custom: v })} />
        <Card title="Referencias visuales"><Attachments entityType="idea" entityId={i.id} kind="reference" title="Archivos y enlaces" /></Card>
        {i.converted?.length > 0 && <Card title="Convertida en">{i.converted.map((c) => <div key={c.id} className="small"><Link to={c.type === 'episode' ? `/episodios/${c.id}` : c.type === 'task' ? '/tareas' : '/agenda'}>{({ episode: 'Episodio', task: 'Actividad', event: 'Evento', publication: 'Publicación programada' } as Record<string, string>)[c.type] ?? c.type}</Link> · {relativeTime(c.at)}</div>)}</Card>}
        <button className="btn danger" type="button" onClick={() => { if (confirmAction('¿Eliminar esta idea?')) { ideas.remove(i.id); navigate('/laboratorio'); } }}><Trash2 size={15} />Eliminar</button>
      </div>
      <Sheet open={convert} onClose={() => setConvert(false)} title="Convertir idea">
        <div className="stack">
          <Card title="En episodio">
            <div className="stack"><Select label="Serie" value={targetSeries || i.series_id || ''} placeholder="— Sin serie —" onChange={setTargetSeries} options={series.map((s) => ({ value: s.id, label: s.title }))} /><button className="btn primary" type="button" onClick={toEpisode}>Crear episodio</button></div>
          </Card>
          <Card title="En publicación, evento o actividad">
            <div className="stack">
              <label className="field"><span>Fecha</span><input className="input" type="date" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
              <div className="row wrap"><button className="btn" type="button" onClick={() => toEvent('publicacion')}>Publicación programada</button><button className="btn" type="button" onClick={() => toEvent('grabacion')}>Grabación</button><button className="btn" type="button" onClick={toTask}>Actividad (tarea)</button></div>
            </div>
          </Card>
        </div>
      </Sheet>
    </div>
  );
}
