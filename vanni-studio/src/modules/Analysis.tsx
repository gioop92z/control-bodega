import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Lightbulb, LineChart as LineIcon, TrendingUp } from 'lucide-react';
import { useTable } from '../lib/store';
import { Card, Chips, Empty, PageHeader } from '../components/ui';
import { Heatmap, HBarList } from '../components/charts';
import { HOUR_BLOCKS, bestTimes, cellLabel, engagementRate, formatStats, generateInsights, growthAroundPosts, interactions, mediaMetric, seriesPerformance, topMedia, type Insight } from '../lib/analytics';
import { WEEKDAYS_SHORT } from '../lib/dates';
import { n, pct, signed } from '../lib/format';
import { MediaThumb, useEpisodeSeriesMap, useIgData } from './shared';
import { MediaDetail } from './InstagramPosts';
import type { IgMedia } from '../lib/types';

const KIND_LABEL = { observacion: 'Observación estadística', prediccion: 'Predicción', recomendacion: 'Recomendación' } as const;

export function InsightCard({ i }: { i: Insight }) {
  const Icon = i.kind === 'observacion' ? LineIcon : i.kind === 'prediccion' ? TrendingUp : Lightbulb;
  const body = (
    <div className="card tight stack tight" style={{ height: '100%' }}>
      <div className="row between"><span className={`badge ${i.kind === 'recomendacion' ? 'accent' : i.kind === 'prediccion' ? 'warn' : ''}`}><Icon size={12} />{KIND_LABEL[i.kind]}</span><span className="xs faint">Confianza {i.confidence}{i.n ? ` · n=${i.n}` : ''}</span></div>
      <b>{i.title}</b>
      <span className="small muted">{i.detail}</span>
    </div>
  );
  return i.link ? <Link to={i.link} style={{ textDecoration: 'none' }}>{body}</Link> : body;
}

export function useAnalysis() {
  const ig = useIgData();
  const audience = useTable('ig_audience').rows;
  const series = useTable('series').rows;
  const epMap = useEpisodeSeriesMap();
  const perf = useMemo(() => seriesPerformance(series, ig.links, ig.media, epMap), [series, ig.links, ig.media, epMap]);
  const insights = useMemo(() => generateInsights({ media: ig.media, insights: ig.insights, snapshots: ig.snapshots, audience, seriesPerf: perf }), [ig.media, ig.insights, ig.snapshots, audience, perf]);
  return { ...ig, perf, insights };
}

export function AnalysisPage() {
  const a = useAnalysis();
  const [kind, setKind] = useState<'all' | Insight['kind']>('all');
  const [open, setOpen] = useState<IgMedia | null>(null);
  const posts = a.media.filter((m) => !m.is_story);
  const fmts = formatStats(a.media);
  const times = bestTimes(posts);
  const assoc = growthAroundPosts(posts, a.followers).slice(0, 5);
  const shown = a.insights.filter((i) => kind === 'all' || i.kind === kind);
  const lists: Array<{ key: string; title: string; get: (m: IgMedia) => number | null; fmt: (v: number) => string }> = [
    { key: 'reach', title: 'Mayor alcance', get: (m) => mediaMetric(m, 'reach'), fmt: (v) => n(v) },
    { key: 'shares', title: 'Más compartidos', get: (m) => mediaMetric(m, 'shares'), fmt: (v) => n(v) },
    { key: 'saved', title: 'Más guardados', get: (m) => mediaMetric(m, 'saved'), fmt: (v) => n(v) },
    { key: 'er', title: 'Mejor tasa de interacción', get: (m) => ((mediaMetric(m, 'reach') ?? 0) >= 50 ? engagementRate(m) : null), fmt: (v) => pct(v) },
  ];
  return (
    <div>
      <PageHeader eyebrow="Motor de análisis · sin IA simulada" title="Análisis de contenido" description="Hallazgos calculados con tus estadísticas reales. Cada tarjeta indica si es una observación, una predicción o una recomendación, y con cuántos datos se calculó." />
      {!posts.some((m) => mediaMetric(m, 'reach') !== null) ? (
        <Empty title="Sin métricas suficientes" action={<Link className="btn primary" to="/instagram">Ir a Instagram</Link>}>Conecta Instagram y espera la primera sincronización para ver el análisis de tus publicaciones.</Empty>
      ) : (
        <>
          <section className="section">
            <div className="section-head"><h2>Hallazgos</h2><Chips value={kind} onChange={setKind} options={[{ value: 'all', label: 'Todos' }, { value: 'observacion', label: 'Observaciones' }, { value: 'prediccion', label: 'Predicciones' }, { value: 'recomendacion', label: 'Recomendaciones' }]} /></div>
            <div className="grid auto">{shown.map((i) => <InsightCard key={i.id} i={i} />)}</div>
          </section>

          <section className="section grid halves">
            <Card title="Formatos">
              <div className="table-wrap"><table className="table"><thead><tr><th>Formato</th><th className="r">n</th><th className="r">Alcance (mediana)</th><th className="r">Repr. (mediana)</th><th className="r">Interacción</th><th className="r">Compartidos</th><th className="r">Guardados</th></tr></thead>
                <tbody>{fmts.map((f) => <tr key={f.format}><td>{f.label}</td><td className="r">{f.n}</td><td className="r">{n(f.medianReach)}</td><td className="r">{n(f.medianViews)}</td><td className="r">{pct(f.medianER)}</td><td className="r">{n(f.avgShares)}</td><td className="r">{n(f.avgSaves)}</td></tr>)}</tbody></table></div>
              <p className="xs faint">Compartidos y guardados: promedio por publicación. Interacción: mediana de interacciones ÷ alcance.</p>
            </Card>
            <Card title="Horarios con mejores resultados">
              <Heatmap rows={WEEKDAYS_SHORT} cols={HOUR_BLOCKS.map((b) => b.label)} value={(r, c) => times.cells.find((x) => x.weekday === r && x.block === c)?.score ?? null}
                cellTitle={(r, c) => { const cell = times.cells.find((x) => x.weekday === r && x.block === c)!; return cell.n ? `${cellLabel(cell)}: ${cell.score!.toFixed(2)}× (${cell.n} publicaciones)` : `${cellLabel(cell)}: sin publicaciones`; }}
                legend={<span>Índice de alcance frente a la mediana de su formato · más claro = mejor · celdas punteadas sin datos · {times.sample} publicaciones</span>} />
              {times.top.length ? <p className="small" style={{ marginBottom: 0 }}>Mejores franjas: {times.top.map((t) => `${cellLabel(t)} (${t.score!.toFixed(2)}×, n=${t.n})`).join(' · ')}</p> : <p className="xs faint">Se necesitan al menos 2 publicaciones en una franja para compararla.</p>}
            </Card>
          </section>

          <section className="section grid halves">
            <Card title="Series más exitosas">
              {a.perf.some((p) => p.posts) ? (
                <HBarList items={a.perf.filter((p) => p.posts).sort((x, y) => y.reach - x.reach).map((p) => ({ key: p.series.id, label: <Link to={`/series/${p.series.id}`}>{p.series.title}</Link>, value: p.reach, extra: <span className="faint"> · {p.posts} pub. · {pct(p.medianER)}</span> }))} fmt={(v) => n(v)} />
              ) : <p className="muted small">Vincula publicaciones con tus series (en Publicaciones o en cada episodio) para comparar series.</p>}
            </Card>
            <Card title="Publicaciones asociadas a mayor crecimiento">
              {assoc.length ? assoc.map((x) => (
                <button key={x.media.id} type="button" className="list-item" style={{ padding: '8px 0' }} onClick={() => setOpen(x.media)}>
                  <MediaThumb m={x.media} size={40} /><span className="grow small truncate">{x.media.caption || 'Sin texto'}</span><b className={`num ${x.excess > 0 ? 'up' : 'down'}`}>{signed(x.delta)}</b>
                </button>
              )) : <p className="muted small">Se necesitan al menos 10 días de historial de seguidores.</p>}
              <p className="xs faint">Seguidores ganados del día previo a 2 días después de publicar, comparado con ventanas sin publicaciones. Asociación, no causalidad.</p>
            </Card>
          </section>

          <section className="section grid halves">
            {lists.map((l) => (
              <Card key={l.key} title={l.title}>
                {topMedia(posts, l.get, 5).map((x) => (
                  <button key={x.media.id} type="button" className="list-item" style={{ padding: '8px 0' }} onClick={() => setOpen(x.media)}>
                    <MediaThumb m={x.media} size={40} /><span className="grow small truncate">{x.media.caption || 'Sin texto'}</span><b className="num">{l.fmt(x.value)}</b>
                  </button>
                ))}
                {!topMedia(posts, l.get, 1).length && <p className="muted small">Meta aún no entrega esta métrica para tus publicaciones.</p>}
              </Card>
            ))}
          </section>
          <p className="xs faint">Interacciones totales calculadas: {n(posts.reduce((s, m) => s + (interactions(m) ?? 0), 0))} en {posts.length} publicaciones.</p>
        </>
      )}
      <MediaDetail media={open} onClose={() => setOpen(null)} />
    </div>
  );
}
