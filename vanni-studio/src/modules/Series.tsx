import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { useTable } from '../lib/store';
import { Card, Chips, DateField, Empty, Kpi, NumberField, PageHeader, Progress, Select, TagInput, TextArea, TextField } from '../components/ui';
import { CoverPicker, StorageImage } from '../components/Attachments';
import { CustomFieldsEditor } from '../components/CustomFields';
import { Sheet } from '../components/Sheet';
import { confirmAction } from '../components/toast';
import { EPISODE_STAGES, stageLabel } from '../lib/constants';
import { seriesPerformance } from '../lib/analytics';
import { money, n, pct } from '../lib/format';
import { useProfile } from '../lib/profile';
import { MediaThumb, useEpisodeSeriesMap } from './shared';
import type { Episode, Season } from '../lib/types';

const PUBLISHED = new Set(['publicado', 'analizado']);

export function SeriesListPage() {
  const series = useTable('series');
  const episodes = useTable('episodes').rows;
  const links = useTable('media_links').rows;
  const media = useTable('ig_media').rows;
  const epMap = useEpisodeSeriesMap();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'activa' | 'pausada' | 'archivada' | 'todas'>('activa');
  const perf = useMemo(() => new Map(seriesPerformance(series.rows, links, media, epMap).map((p) => [p.series.id, p])), [series.rows, links, media, epMap]);
  const list = series.rows.filter((s) => status === 'todas' || s.status === status).sort((a, b) => a.sort - b.sort);
  const create = () => { const s = series.insert({ title: 'NUEVA SERIE', status: 'activa', sort: series.rows.length }); navigate(`/series/${s.id}`); };
  return (
    <div>
      <PageHeader eyebrow="Estudio" title="Series" description="Temporadas y episodios ilimitados, guiones, ubicaciones, presupuesto y métricas reales de cada serie." actions={<><Link className="btn" to="/produccion">Tablero de producción</Link><button className="btn primary" type="button" onClick={create}><Plus size={16} />Nueva serie</button></>} />
      <div style={{ marginBottom: 16 }}><Chips value={status} onChange={setStatus} options={[{ value: 'activa', label: 'Activas' }, { value: 'pausada', label: 'Pausadas' }, { value: 'archivada', label: 'Archivadas' }, { value: 'todas', label: 'Todas' }]} /></div>
      {!list.length ? <Empty title="Sin series en esta vista" action={<button className="btn primary" type="button" onClick={create}>Crear serie</button>} /> : (
        <div className="grid auto">
          {list.map((s) => {
            const eps = episodes.filter((e) => e.series_id === s.id);
            const pub = eps.filter((e) => PUBLISHED.has(e.status)).length;
            const p = perf.get(s.id);
            return (
              <Link key={s.id} to={`/series/${s.id}`} className="card link stack tight" style={{ padding: 0, overflow: 'hidden' }}>
                <StorageImage path={s.cover_path} alt="" className="cover" style={{ borderRadius: 0, border: 0, aspectRatio: '16 / 8' }} />
                <div className="stack tight" style={{ padding: 14 }}>
                  <div className="row" style={{ gap: 8 }}><span className="dot" style={{ background: s.color ?? 'var(--accent)' }} /><h3 className="truncate">{s.title}</h3></div>
                  <span className="small muted clamp-2">{s.tagline}</span>
                  <Progress value={eps.length ? pub / eps.length : 0} thin />
                  <div className="row between xs faint"><span>{pub}/{eps.length} episodios publicados</span><span>{p?.posts ? `Alcance ${n(p.reach)}` : 'Sin publicaciones vinculadas'}</span></div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SeasonSheet({ season, onClose }: { season: Season | null; onClose: () => void }) {
  const t = useTable('seasons');
  const live = season ? t.byId.get(season.id) ?? season : null;
  if (!live) return null;
  const set = (patch: Partial<Season>) => t.update(live.id, patch);
  return (
    <Sheet open={!!season} onClose={onClose} title={`Temporada ${live.number}`} footer={<button className="btn danger" type="button" onClick={() => { if (confirmAction('¿Eliminar esta temporada? Los episodios quedarán sin temporada.')) { t.remove(live.id); onClose(); } }}><Trash2 size={15} />Eliminar</button>}>
      <div className="form-grid two">
        <NumberField label="Número" value={live.number} onChange={(v) => set({ number: v ?? 1 })} />
        <TextField label="Título" value={live.title} onChange={(v) => set({ title: v })} />
        <Select label="Estado" value={live.status} onChange={(v) => set({ status: v })} options={[{ value: 'planeacion', label: 'Planeación' }, { value: 'produccion', label: 'En producción' }, { value: 'emision', label: 'En emisión' }, { value: 'terminada', label: 'Terminada' }]} />
        <NumberField label="Presupuesto" value={live.budget} onChange={(v) => set({ budget: v })} />
        <DateField label="Inicio" value={live.start_date} onChange={(v) => set({ start_date: v })} />
        <DateField label="Fin" value={live.end_date} onChange={(v) => set({ end_date: v })} />
        <TextArea className="span-2" label="Descripción" value={live.description} onChange={(v) => set({ description: v })} />
        <div className="span-2"><CoverPicker path={live.cover_path} onChange={(p) => set({ cover_path: p })} folder={`seasons/${live.id}`} /></div>
      </div>
    </Sheet>
  );
}

export function SeriesDetailPage() {
  const { id } = useParams();
  const seriesT = useTable('series');
  const seasonsT = useTable('seasons');
  const episodesT = useTable('episodes');
  const links = useTable('media_links').rows;
  const media = useTable('ig_media').rows;
  const tx = useTable('transactions').rows;
  const epMap = useEpisodeSeriesMap();
  const { currency } = useProfile();
  const navigate = useNavigate();
  const [season, setSeason] = useState<Season | null>(null);
  const s = seriesT.byId.get(id ?? '');
  if (!s) return seriesT.ready ? <Empty title="Serie no encontrada" action={<Link className="btn" to="/series">Volver</Link>} /> : null;
  const set = (patch: Partial<typeof s>) => seriesT.update(s.id, patch);
  const seasons = seasonsT.rows.filter((x) => x.series_id === s.id).sort((a, b) => a.number - b.number);
  const eps = episodesT.rows.filter((e) => e.series_id === s.id).sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || a.sort - b.sort);
  const perf = seriesPerformance([s], links, media, epMap)[0];
  const linkedMedia = links.filter((l) => (l.series_id ?? epMap.get(l.episode_id ?? '')) === s.id).map((l) => media.find((m) => m.ig_media_id === l.ig_media_id)).filter(Boolean);
  const budget = seasons.reduce((a, x) => a + (x.budget ?? 0), 0) || eps.reduce((a, e) => a + (e.budget ?? 0), 0);
  const spent = eps.reduce((a, e) => a + (e.cost ?? 0), 0) + tx.filter((t) => t.kind === 'gasto' && (t.series_id === s.id || eps.some((e) => e.id === t.episode_id))).reduce((a, t) => a + Number(t.amount), 0);
  const addSeason = () => { const x = seasonsT.insert({ series_id: s.id, number: (seasons[seasons.length - 1]?.number ?? 0) + 1, status: 'planeacion', sort: seasons.length }); setSeason(x); };
  const addEpisode = (seasonId: string | null) => { const e = episodesT.insert({ series_id: s.id, season_id: seasonId, title: 'Nuevo episodio', status: 'idea', number: eps.filter((x) => x.season_id === seasonId).length + 1, refs: [], collaborator_ids: [], shotlist: [], checklist: [], sort: eps.length } as Partial<Episode>); navigate(`/episodios/${e.id}`); };
  const groups: Array<{ season: Season | null; list: Episode[] }> = [...seasons.map((x) => ({ season: x, list: eps.filter((e) => e.season_id === x.id) })), { season: null, list: eps.filter((e) => !e.season_id || !seasons.some((x) => x.id === e.season_id)) }];

  return (
    <div>
      <Link to="/series" className="btn ghost sm" style={{ marginBottom: 8 }}><ChevronLeft size={16} />Series</Link>
      <div className="grid split">
        <div className="stack">
          <TextField label="Nombre de la serie" value={s.title} onChange={(v) => set({ title: v })} />
          <TextField label="Concepto" value={s.tagline} onChange={(v) => set({ tagline: v })} />
          <TextArea label="Descripción y formato" value={s.description} onChange={(v) => set({ description: v })} />
          <div className="form-grid two">
            <Select label="Estado" value={s.status} onChange={(v) => set({ status: v })} options={[{ value: 'activa', label: 'Activa' }, { value: 'pausada', label: 'Pausada' }, { value: 'archivada', label: 'Archivada' }]} />
            <label className="field"><span>Color</span><input className="input" type="color" value={s.color ?? '#3be58a'} onChange={(e) => set({ color: e.target.value })} style={{ padding: 4 }} /></label>
          </div>
          <TagInput value={s.tags} onChange={(v) => set({ tags: v })} />
          <CustomFieldsEditor entity="series" value={s.custom} onChange={(v) => set({ custom: v })} />
        </div>
        <CoverPicker path={s.cover_path} onChange={(p) => set({ cover_path: p })} folder={`series/${s.id}`} />
      </div>

      <section className="section">
        <div className="section-head"><h2>Rendimiento real</h2><span className="xs faint">{perf.posts} publicaciones vinculadas</span></div>
        <div className="grid kpis">
          <Kpi label="Alcance acumulado" value={n(perf.reach)} source={perf.posts ? 'calc' : 'na'} />
          <Kpi label="Reproducciones" value={n(perf.views)} source={perf.posts ? 'calc' : 'na'} />
          <Kpi label="Interacciones" value={n(perf.interactions)} source={perf.posts ? 'calc' : 'na'} sub={`Compartidos ${n(perf.shares)} · Guardados ${n(perf.saves)}`} />
          <Kpi label="Interacción / alcance" value={pct(perf.medianER)} source={perf.medianER !== null ? 'calc' : 'na'} sub="Mediana por publicación" />
        </div>
        <div className="grid kpis" style={{ marginTop: 12 }}>
          <Kpi label="Presupuesto" value={money(budget || null, currency)} />
          <Kpi label="Gastado" value={money(spent, currency)} deltaClass={budget && spent > budget ? 'down' : 'flatline'} delta={budget ? `${Math.round((spent / budget) * 100)} % del presupuesto` : undefined} />
          <Kpi label="Episodios" value={eps.length} sub={`${eps.filter((e) => PUBLISHED.has(e.status)).length} publicados`} />
          <Kpi label="Temporadas" value={seasons.length} />
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Temporadas y episodios</h2><button className="btn sm" type="button" onClick={addSeason}><Plus size={15} />Temporada</button></div>
        <div className="stack">
          {groups.filter((g) => g.season || g.list.length || !seasons.length).map((g) => {
            const pub = g.list.filter((e) => PUBLISHED.has(e.status)).length;
            return (
              <Card key={g.season?.id ?? 'none'} title={g.season ? <button type="button" className="btn ghost sm" onClick={() => setSeason(g.season)}><h3>Temporada {g.season.number}{g.season.title ? ` · ${g.season.title}` : ''}</h3></button> : <h3>{seasons.length ? 'Sin temporada' : 'Episodios'}</h3>} action={<button className="btn sm" type="button" onClick={() => addEpisode(g.season?.id ?? null)}><Plus size={15} />Episodio</button>}>
                {g.season && <div className="stack tight" style={{ marginBottom: 10 }}><Progress value={g.list.length ? pub / g.list.length : 0} /><span className="xs faint">{pub} de {g.list.length} publicados · {EPISODE_STAGES.map((st) => { const c = g.list.filter((e) => e.status === st.key).length; return c ? `${st.label} ${c}` : null; }).filter(Boolean).join(' · ') || 'sin episodios'}</span></div>}
                {g.list.length ? <div className="list">{g.list.map((e) => (
                  <Link key={e.id} to={`/episodios/${e.id}`} className="list-item">
                    <span className="badge">{e.number ? `#${e.number}` : '—'}</span>
                    <div className="grow"><div className="title truncate">{e.title || 'Sin título'}</div><div className="xs faint">{stageLabel(e.status)}{e.record_date ? ` · Grabación ${e.record_date}` : ''}{e.publish_date ? ` · Publicación ${e.publish_date}` : ''}</div></div>
                  </Link>
                ))}</div> : <p className="muted small" style={{ margin: 0 }}>Sin episodios.</p>}
              </Card>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Publicaciones vinculadas</h2><Link className="btn sm" to="/instagram/publicaciones">Vincular más</Link></div>
        {linkedMedia.length ? <div className="list">{linkedMedia.map((m) => m && <div key={m.id} className="list-item" style={{ cursor: 'default' }}><MediaThumb m={m} /><span className="grow small truncate">{m.caption || 'Sin texto'}</span>{m.permalink && <a className="btn sm ghost" href={m.permalink} target="_blank" rel="noreferrer">Abrir</a>}</div>)}</div> : <p className="muted small">Aún no vinculas publicaciones a esta serie.</p>}
      </section>
      <button className="btn danger" type="button" onClick={() => { if (confirmAction(`¿Eliminar la serie «${s.title}» con sus temporadas y episodios?`)) { seriesT.remove(s.id); navigate('/series'); } }}><Trash2 size={15} />Eliminar serie</button>
      <SeasonSheet season={season} onClose={() => setSeason(null)} />
    </div>
  );
}
