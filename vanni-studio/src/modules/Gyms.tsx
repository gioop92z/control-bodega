import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ChevronLeft, Crosshair, ExternalLink, MapPin, Plus, Search, Trash2, Trophy } from 'lucide-react';
import { useTable } from '../lib/store';
import { Card, Chips, DateField, Empty, NumberField, PageHeader, Rating, Select, Spinner, TagInput, TextArea, TextField, Tabs } from '../components/ui';
import { Attachments, CoverPicker, StorageImage } from '../components/Attachments';
import { CustomFieldsEditor } from '../components/CustomFields';
import { useToast, confirmAction } from '../components/toast';
import { GYM_CRITERIA, GYM_STATUSES, stageLabel } from '../lib/constants';
import { DEFAULT_WEIGHTS, gymScore, parseMapsUrl, rankGyms } from '../lib/gyms';
import { money } from '../lib/format';
import { useProfile } from '../lib/profile';
import type { Gym } from '../lib/types';

const GymMap = lazy(() => import('./GymMap'));

export function useGymWeights() {
  const { settings, updateSettings } = useProfile();
  return { weights: { ...DEFAULT_WEIGHTS, ...(settings.gymWeights ?? {}) }, setWeights: (w: Record<string, number>) => updateSettings({ gymWeights: w }) };
}

export function GymsPage() {
  const gyms = useTable('gyms');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [tab, setTab] = useState<'lista' | 'mapa' | 'ranking'>(pathname.endsWith('/ranking') ? 'ranking' : 'lista');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const { weights, setWeights } = useGymWeights();
  const { currency } = useProfile();
  const ranked = useMemo(() => rankGyms(gyms.rows, weights), [gyms.rows, weights]);
  const scores = useMemo(() => new Map(ranked.map((r) => [r.gym.id, r.score])), [ranked]);
  const list = ranked.filter((r) => (status === 'all' || r.gym.status === status) && (!q || `${r.gym.name} ${r.gym.city ?? ''} ${r.gym.address ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const create = () => navigate(`/gimnasios/${gyms.insert({ name: '', status: 'pendiente', currency, ratings: {} }).id}`);
  const openGym = useCallback((id: string) => navigate(`/gimnasios/${id}`), [navigate]);
  return (
    <div>
      <PageHeader eyebrow="Explorador" title="Gimnasios" description="Base de datos personal de gimnasios visitados y pendientes, con puntuación, ranking dinámico y mapa." actions={<button className="btn primary" type="button" onClick={create}><Plus size={16} />Gimnasio</button>} />
      <div className="stack" style={{ marginBottom: 14 }}>
        <Tabs value={tab} onChange={setTab} options={[{ value: 'lista', label: 'Lista' }, { value: 'mapa', label: 'Mapa' }, { value: 'ranking', label: 'Ranking' }]} />
        {tab !== 'ranking' && <><Chips value={status} onChange={setStatus} options={[{ value: 'all', label: `Todos (${gyms.rows.length})` }, ...GYM_STATUSES.map((s) => ({ value: s.key, label: s.label }))]} />
          <div className="row" style={{ gap: 6 }}><Search size={16} color="var(--text-3)" /><input className="input" placeholder="Buscar por nombre o ciudad" value={q} onChange={(e) => setQ(e.target.value)} /></div></>}
      </div>
      {tab === 'lista' && (list.length ? (
        <div className="grid auto">
          {list.map(({ gym: g, score }) => (
            <Link key={g.id} to={`/gimnasios/${g.id}`} className="card link stack tight" style={{ padding: 0, overflow: 'hidden' }}>
              <StorageImage path={g.cover_path} alt="" className="cover" style={{ borderRadius: 0, border: 0, aspectRatio: '16 / 8' }} />
              <div className="row between" style={{ padding: '10px 14px 14px' }}>
                <div className="grow" style={{ minWidth: 0 }}><b className="truncate" style={{ display: 'block' }}>{g.name || 'Sin nombre'}</b><span className="xs faint">{g.city || g.address || 'Sin ubicación'} · {GYM_STATUSES.find((s) => s.key === g.status)?.label}{g.price_visit ? ` · visita ${money(g.price_visit, g.currency)}` : ''}</span></div>
                <span className="score">{score !== null ? score.toFixed(1) : '—'}<small>/10</small></span>
              </div>
            </Link>
          ))}
        </div>
      ) : <Empty title="Sin gimnasios" action={<button className="btn primary" type="button" onClick={create}>Registrar gimnasio</button>}>Registra los que visitas y los que tienes pendientes.</Empty>)}
      {tab === 'mapa' && <Suspense fallback={<Spinner label="Cargando mapa…" />}><GymMap gyms={list.map((r) => r.gym)} scores={scores} onOpen={openGym} /><p className="xs faint">{list.filter((r) => r.gym.lat !== null && r.gym.lat !== undefined).length} de {list.length} gimnasios con coordenadas. Agrega el enlace de Google Maps o usa «Buscar coordenadas» en cada ficha.</p></Suspense>}
      {tab === 'ranking' && (
        <div className="grid split">
          <div className="list">
            {ranked.filter((r) => r.score !== null).map((r) => (
              <Link key={r.gym.id} to={`/gimnasios/${r.gym.id}`} className="list-item">
                <span className="score" style={{ fontSize: 22, minWidth: 34, color: r.rank === 1 ? 'var(--accent)' : undefined }}>{r.rank}</span>
                <div className="grow"><b>{r.gym.name}</b><div className="xs faint">{r.gym.city ?? ''} · {r.rated}/{GYM_CRITERIA.length} criterios calificados</div></div>
                <span className="score">{r.score!.toFixed(1)}</span>
              </Link>
            ))}
            {!ranked.some((r) => r.score !== null) && <div className="list-item"><Trophy size={18} /><span className="muted small">Califica tus gimnasios para generar el ranking.</span></div>}
          </div>
          <Card title="Ponderación del ranking">
            <p className="xs faint" style={{ marginTop: 0 }}>Ajusta cuánto pesa cada criterio en la puntuación general (0 = no cuenta).</p>
            {GYM_CRITERIA.map((c) => (
              <label key={c.key} className="field" style={{ marginBottom: 8 }}><span className="row between">{c.label}<output>{weights[c.key]}×</output></span>
                <input className="range" type="range" min={0} max={3} step={0.5} value={weights[c.key]} onChange={(e) => setWeights({ ...weights, [c.key]: Number(e.target.value) })} /></label>
            ))}
            <button className="btn sm ghost" type="button" onClick={() => setWeights(DEFAULT_WEIGHTS)}>Restablecer</button>
          </Card>
        </div>
      )}
    </div>
  );
}

export function GymDetailPage() {
  const { id } = useParams();
  const gyms = useTable('gyms');
  const episodes = useTable('episodes').rows;
  const navigate = useNavigate();
  const toast = useToast();
  const { weights } = useGymWeights();
  const [busy, setBusy] = useState(false);
  const g = gyms.byId.get(id ?? '');
  if (!g) return gyms.ready ? <Empty title="Gimnasio no encontrado" action={<Link className="btn" to="/gimnasios">Volver</Link>} /> : null;
  const set = (patch: Partial<Gym>) => gyms.update(g.id, patch);
  const score = gymScore(g.ratings, weights);
  const related = episodes.filter((e) => e.gym_id === g.id);
  const fromMaps = () => { const c = parseMapsUrl(g.maps_url); if (c) { set({ lat: c.lat, lng: c.lng }); toast('Coordenadas tomadas del enlace', 'success'); } else toast('El enlace no contiene coordenadas (los enlaces cortos maps.app.goo.gl no las incluyen). Usa «Buscar coordenadas».', 'error'); };
  const geocode = async () => {
    const qtext = [g.name, g.address, g.city].filter(Boolean).join(', ');
    if (!qtext) { toast('Escribe la dirección o la ciudad', 'error'); return; }
    setBusy(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&q=${encodeURIComponent(qtext)}`);
      const data = await res.json();
      if (data[0]) { set({ lat: Number(data[0].lat), lng: Number(data[0].lon) }); toast('Ubicación encontrada', 'success'); } else toast('No se encontró la dirección. Prueba con calle y ciudad.', 'error');
    } catch { toast('No se pudo consultar el buscador de mapas', 'error'); } finally { setBusy(false); }
  };
  const here = () => navigator.geolocation?.getCurrentPosition((p) => { set({ lat: p.coords.latitude, lng: p.coords.longitude }); toast('Ubicación actual guardada', 'success'); }, () => toast('No se pudo obtener tu ubicación', 'error'), { enableHighAccuracy: true, timeout: 10_000 });
  const mapsLink = g.maps_url || (g.lat !== null && g.lat !== undefined ? `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}` : null);
  return (
    <div>
      <Link to="/gimnasios" className="btn ghost sm" style={{ marginBottom: 8 }}><ChevronLeft size={16} />Gimnasios</Link>
      <div className="grid split">
        <div className="stack">
          <TextField label="Nombre" value={g.name} onChange={(v) => set({ name: v })} />
          <div className="form-grid two">
            <Select label="Estado" value={g.status} onChange={(v) => set({ status: v })} options={GYM_STATUSES.map((s) => ({ value: s.key, label: s.label }))} />
            <DateField label="Fecha de visita" value={g.visit_date} onChange={(v) => set({ visit_date: v, ...(v && g.status === 'pendiente' ? { status: 'visitado' } : {}) })} />
            <TextField className="span-2" label="Dirección" value={g.address} onChange={(v) => set({ address: v })} />
            <TextField label="Ciudad" value={g.city} onChange={(v) => set({ city: v })} />
            <TextField label="Enlace de Google Maps" type="url" inputMode="url" value={g.maps_url} onChange={(v) => set({ maps_url: v || null })} />
            <NumberField label="Latitud" value={g.lat} onChange={(v) => set({ lat: v })} />
            <NumberField label="Longitud" value={g.lng} onChange={(v) => set({ lng: v })} />
          </div>
          <div className="row wrap">
            <button className="btn sm" type="button" onClick={fromMaps}><MapPin size={14} />Desde el enlace</button>
            <button className="btn sm" type="button" disabled={busy} onClick={() => void geocode()}><Search size={14} />Buscar coordenadas</button>
            <button className="btn sm" type="button" onClick={here}><Crosshair size={14} />Estoy aquí</button>
            {mapsLink && <a className="btn sm" href={mapsLink} target="_blank" rel="noreferrer"><ExternalLink size={14} />Abrir en Google Maps</a>}
          </div>
          <div className="form-grid two">
            <NumberField label="Precio por visita" suffix={g.currency} value={g.price_visit} onChange={(v) => set({ price_visit: v })} />
            <NumberField label="Mensualidad" suffix={g.currency} value={g.price_month} onChange={(v) => set({ price_month: v })} />
          </div>
          <TextArea label="Experiencia personal" value={g.experience} onChange={(v) => set({ experience: v })} rows={4} />
          <TextArea label="Máquinas destacadas" value={g.machines} onChange={(v) => set({ machines: v })} rows={3} />
          <TagInput value={g.tags} onChange={(v) => set({ tags: v })} />
          <CustomFieldsEditor entity="gyms" value={g.custom} onChange={(v) => set({ custom: v })} />
        </div>
        <div className="stack">
          <Card title="Puntuación general" action={<span className="score">{score !== null ? score.toFixed(1) : '—'}<small>/10</small></span>}>
            <div className="stack">{GYM_CRITERIA.map((c) => <Rating key={c.key} label={c.label} value={g.ratings?.[c.key]} onChange={(v) => { const r = { ...(g.ratings ?? {}) }; if (v) r[c.key] = v; else delete r[c.key]; set({ ratings: r }); }} />)}</div>
          </Card>
          <Card title="Portada"><CoverPicker path={g.cover_path} onChange={(p) => set({ cover_path: p })} folder={`gyms/${g.id}`} /></Card>
        </div>
      </div>
      <section className="section"><Card title="Fotografías"><Attachments entityType="gym" entityId={g.id} title="Fotos y videos del gimnasio" /></Card></section>
      <section className="section">
        <Card title="Episodios relacionados">
          {related.length ? <div className="list">{related.map((e) => <Link key={e.id} className="list-item" to={`/episodios/${e.id}`}><span className="grow">{e.title}</span><span className="badge">{stageLabel(e.status)}</span></Link>)}</div> : <p className="muted small" style={{ margin: 0 }}>Asigna este gimnasio en un episodio para relacionarlo.</p>}
        </Card>
      </section>
      <button className="btn danger" type="button" onClick={() => { if (confirmAction('¿Eliminar este gimnasio?')) { gyms.remove(g.id); navigate('/gimnasios'); } }}><Trash2 size={15} />Eliminar gimnasio</button>
    </div>
  );
}
