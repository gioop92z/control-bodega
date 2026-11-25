import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Link as LinkIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTable } from '../lib/store';
import { Card, Chips, Empty, PageHeader, Select, SourceBadge } from '../components/ui';
import { LineChart } from '../components/charts';
import { Sheet } from '../components/Sheet';
import { dayLabel, dayOfInstant, relativeTime } from '../lib/dates';
import { engagementRate, formatOf, interactions, mediaMetric } from '../lib/analytics';
import { FORMAT_LABELS, MEDIA_METRICS_UI, metricLabel } from '../lib/metrics-ui';
import { duration, n, pct } from '../lib/format';
import { LinkMediaSheet, MediaThumb, useIgData } from './shared';
import type { IgMedia } from '../lib/types';

const SORTS = [
  { value: 'recent', label: 'Más recientes' }, { value: 'reach', label: 'Alcance' }, { value: 'views', label: 'Reproducciones' },
  { value: 'interactions', label: 'Interacciones' }, { value: 'er', label: 'Tasa de interacción' }, { value: 'shares', label: 'Compartidos' }, { value: 'saved', label: 'Guardados' },
];

export function sortValue(m: IgMedia, key: string): number {
  if (key === 'recent') return m.posted_at ? Date.parse(m.posted_at) : 0;
  if (key === 'interactions') return interactions(m) ?? -1;
  if (key === 'er') return engagementRate(m) ?? -1;
  return mediaMetric(m, key) ?? -1;
}

export function MediaDetail({ media, onClose }: { media: IgMedia | null; onClose: () => void }) {
  const [history, setHistory] = useState<Array<{ day: string; metrics: Record<string, number> }>>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const links = useTable('media_links').rows;
  const series = useTable('series').byId;
  const episodes = useTable('episodes').byId;
  useEffect(() => {
    if (!media) return;
    void supabase.from('ig_media_insights_daily').select('day, metrics').eq('ig_media_id', media.ig_media_id).order('day').then(({ data }) => setHistory((data ?? []) as any));
  }, [media?.ig_media_id]);
  if (!media) return null;
  const f = formatOf(media);
  const link = links.find((l) => l.ig_media_id === media.ig_media_id);
  const metricsList = MEDIA_METRICS_UI[f];
  return (
    <Sheet open={!!media} onClose={onClose} title={FORMAT_LABELS[f]} wide>
      <div className="stack">
        <div className="row top">
          <MediaThumb m={media} size={96} />
          <div className="grow stack tight">
            <p className="small pre-wrap" style={{ margin: 0 }}>{media.caption || 'Sin texto'}</p>
            <span className="xs faint">{media.posted_at ? new Date(media.posted_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : ''} · métricas {relativeTime(media.insights_fetched_at)}</span>
            <div className="row wrap">
              {media.permalink && <a className="btn sm" href={media.permalink} target="_blank" rel="noreferrer"><ExternalLink size={14} />Ver en Instagram</a>}
              <button className="btn sm" type="button" onClick={() => setLinkOpen(true)}><LinkIcon size={14} />{link ? 'Cambiar vínculo' : 'Vincular a serie/episodio'}</button>
            </div>
            {link && <span className="xs">Vinculada a <b>{link.series_id ? series.get(link.series_id)?.title : ''}</b>{link.episode_id ? ` · ${episodes.get(link.episode_id)?.title ?? 'episodio'}` : ''}</span>}
          </div>
        </div>
        {media.insights_note && <p className="xs faint" style={{ margin: 0 }}>Meta: {media.insights_note}</p>}
        <div className="grid auto-sm">
          {metricsList.map((k) => {
            const v = mediaMetric(media, k);
            const unavailable = media.unavailable_metrics?.includes(k);
            return (
              <div key={k} className="card tight kpi">
                <div className="kpi-label">{metricLabel(k)}</div>
                <div className="kpi-value sm">{v === null ? '—' : k.includes('time') ? duration(v / 1000) : n(v)}</div>
                <SourceBadge kind={v !== null ? 'real' : 'na'} title={unavailable ? 'Meta no entrega esta métrica para esta publicación' : undefined} />
              </div>
            );
          })}
          <div className="card tight kpi"><div className="kpi-label">Interacción / alcance</div><div className="kpi-value sm">{pct(engagementRate(media))}</div><SourceBadge kind={engagementRate(media) !== null ? 'calc' : 'na'} /></div>
        </div>
        {history.length > 1 && (
          <Card title="Evolución de la publicación">
            <LineChart ariaLabel="Evolución del alcance de la publicación" labels={history.map((h) => dayLabel(h.day))} series={[
              { key: 'reach', label: 'Alcance', color: 'var(--series-1)', values: history.map((h) => (typeof h.metrics.reach === 'number' ? h.metrics.reach : null)) },
              { key: 'views', label: 'Reproducciones', color: 'var(--series-2)', values: history.map((h) => (typeof h.metrics.views === 'number' ? h.metrics.views : null)) },
            ]} />
          </Card>
        )}
      </div>
      <LinkMediaSheet media={media} open={linkOpen} onClose={() => setLinkOpen(false)} />
    </Sheet>
  );
}

export function InstagramPostsPage() {
  const ig = useIgData();
  const links = useTable('media_links').rows;
  const seriesT = useTable('series');
  const [format, setFormat] = useState<'all' | 'REELS' | 'FEED' | 'STORY'>('all');
  const [sort, setSort] = useState('recent');
  const [seriesFilter, setSeriesFilter] = useState('');
  const [linked, setLinked] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [open, setOpen] = useState<IgMedia | null>(null);
  const linkMap = useMemo(() => new Map(links.map((l) => [l.ig_media_id, l])), [links]);
  const list = useMemo(() => ig.media
    .filter((m) => format === 'all' || formatOf(m) === format)
    .filter((m) => linked === 'all' || (linked === 'linked' ? linkMap.has(m.ig_media_id) : !linkMap.has(m.ig_media_id)))
    .filter((m) => !seriesFilter || linkMap.get(m.ig_media_id)?.series_id === seriesFilter)
    .sort((a, b) => sortValue(b, sort) - sortValue(a, sort)), [ig.media, format, sort, linked, seriesFilter, linkMap]);
  return (
    <div>
      <PageHeader eyebrow="Importadas de Instagram" title="Publicaciones" description="Reels, publicaciones y stories con sus métricas reales. Vincula cada una con su serie o episodio." />
      <div className="stack" style={{ marginBottom: 16 }}>
        <Chips scroll value={format} onChange={setFormat} options={[{ value: 'all', label: `Todo (${ig.media.length})` }, { value: 'REELS', label: 'Reels' }, { value: 'FEED', label: 'Publicaciones' }, { value: 'STORY', label: 'Stories' }]} />
        <div className="grid cols-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <Select label="Ordenar por" value={sort} onChange={setSort} options={SORTS} />
          <Select label="Vínculo" value={linked} onChange={(v) => setLinked(v as typeof linked)} options={[{ value: 'all', label: 'Todas' }, { value: 'linked', label: 'Vinculadas' }, { value: 'unlinked', label: 'Sin vincular' }]} />
          <Select label="Serie" value={seriesFilter} placeholder="Todas las series" onChange={setSeriesFilter} options={seriesT.rows.map((s) => ({ value: s.id, label: s.title }))} />
        </div>
      </div>
      {!ig.media.length ? (
        <Empty title="Aún no hay publicaciones importadas">Conecta tu Instagram en la sección Instagram. La primera sincronización importa hasta 500 publicaciones y sus métricas.</Empty>
      ) : (
        <div className="list">
          {list.map((m) => {
            const l = linkMap.get(m.ig_media_id);
            return (
              <button key={m.id} type="button" className="list-item" onClick={() => setOpen(m)}>
                <MediaThumb m={m} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}><span className="badge">{FORMAT_LABELS[formatOf(m)]}</span>{l && <span className="badge accent truncate" style={{ maxWidth: 160 }}>{seriesT.byId.get(l.series_id ?? '')?.title ?? 'Episodio'}</span>}<span className="xs faint">{m.posted_at ? dayLabel(dayOfInstant(m.posted_at), { year: true }) : ''}</span></div>
                  <div className="small truncate" style={{ marginTop: 2 }}>{m.caption || 'Sin texto'}</div>
                  <div className="xs faint num">Alcance {n(mediaMetric(m, 'reach'))} · Repr. {n(mediaMetric(m, 'views'))} · Inter. {n(interactions(m))} · Comp. {n(mediaMetric(m, 'shares'))} · Guard. {n(mediaMetric(m, 'saved'))}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <MediaDetail media={open} onClose={() => setOpen(null)} />
    </div>
  );
}
