import { useMemo } from 'react';
import { Copy, Printer } from 'lucide-react';
import { useTable } from '../lib/store';
import { Card, Notice, PageHeader, SourceBadge, TextArea, TextField, Toggle } from '../components/ui';
import { HBarList } from '../components/charts';
import { useToast } from '../components/toast';
import { audienceShares, engagementRate, formatOf, latestAudience, mediaMetric, periodChange, seriesPerformance } from '../lib/analytics';
import { dayLabel, today } from '../lib/dates';
import { money, n, pct, short } from '../lib/format';
import { useProfile } from '../lib/profile';
import { useEpisodeSeriesMap, useIgData } from './shared';
import { median } from '../lib/analytics';

const regionNames = typeof Intl.DisplayNames !== 'undefined' ? new Intl.DisplayNames(['es'], { type: 'region' }) : null;
const country = (k: string) => { try { return /^[A-Z]{2}$/.test(k) ? regionNames?.of(k) ?? k : k; } catch { return k; } };

export function MediaKitPage() {
  const ig = useIgData();
  const audience = useTable('ig_audience').rows;
  const series = useTable('series').rows.filter((s) => s.status === 'activa');
  const rates = useTable('rates').rows.filter((r) => r.active);
  const epMap = useEpisodeSeriesMap();
  const { profile, settings, updateSettings, update } = useProfile();
  const toast = useToast();
  const mk = settings.mediaKit ?? {};
  const posts = ig.media.filter((m) => !m.is_story);
  const recent = [...posts].filter((m) => mediaMetric(m, 'reach') !== null).sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? '')).slice(0, 12);
  const reels = recent.filter((m) => formatOf(m) === 'REELS');
  const stats = {
    followers: ig.account?.followers_count ?? null,
    medianReach: median(recent.map((m) => mediaMetric(m, 'reach')!)),
    medianViewsReel: median(reels.map((m) => mediaMetric(m, 'views') ?? NaN)),
    er: median(recent.map((m) => engagementRate(m) ?? NaN)),
    reach28: periodChange(ig.insights, 'reach', 28).current,
    views28: periodChange(ig.insights, 'views', 28).current,
    engaged28: periodChange(ig.insights, 'accounts_engaged', 28).current,
  };
  const top = [...posts].sort((a, b) => (mediaMetric(b, 'reach') ?? -1) - (mediaMetric(a, 'reach') ?? -1)).filter((m) => !(mk.hidePosts ?? []).includes(m.ig_media_id)).slice(0, 6);
  const perf = useMemo(() => new Map(seriesPerformance(series, ig.links, ig.media, epMap).map((p) => [p.series.id, p])), [series, ig.links, ig.media, epMap]);
  const aud = (b: string) => audienceShares(latestAudience(audience, 'follower_demographics', b)?.data).slice(0, 5);
  const real = !!ig.account && ig.account.followers_count !== null;
  const updated = ig.account?.last_success_at;
  const summary = `${profile?.display_name ?? 'VANNI'}${ig.account?.username ? ` (@${ig.account.username})` : ''} — ${mk.headline ?? 'Creador fitness'}\nSeguidores: ${n(stats.followers)}\nAlcance mediano por publicación (últimas 12): ${n(stats.medianReach)}\nReproducciones medianas por reel: ${n(stats.medianViewsReel)}\nInteracción / alcance: ${pct(stats.er)}\nAlcance 28 días: ${n(stats.reach28.days ? stats.reach28.value : null)}\nDatos reales de la API oficial de Instagram (Meta), actualizados ${updated ? new Date(updated).toLocaleDateString('es-MX') : '—'}.`;

  return (
    <div>
      <div className="no-print">
        <PageHeader eyebrow="Para marcas y patrocinadores" title="Media kit" description="Se arma con tus métricas reales y se actualiza solo con cada sincronización. Expórtalo como PDF desde el botón (en iPhone: Compartir → Guardar en Archivos)." actions={<><button className="btn" type="button" onClick={() => { void navigator.clipboard?.writeText(summary).then(() => toast('Resumen copiado', 'success')); }}><Copy size={16} />Copiar resumen</button><button className="btn primary" type="button" onClick={() => window.print()}><Printer size={16} />Exportar PDF</button></>} />
        {!real && <Notice tone="warn">Conecta Instagram para incluir métricas reales. El media kit nunca muestra cifras inventadas: los datos no disponibles aparecen como «—».</Notice>}
        <details className="card" style={{ margin: '14px 0' }}><summary className="field-label" style={{ cursor: 'pointer' }}>Editar textos del media kit</summary>
          <div className="form-grid two" style={{ marginTop: 12 }}>
            <TextField label="Nombre público" value={profile?.display_name} onChange={(v) => update({ display_name: v })} />
            <TextField label="Titular" value={mk.headline} onChange={(v) => updateSettings({ mediaKit: { ...mk, headline: v } })} placeholder="Creador fitness · Exploración de gimnasios" />
            <TextArea className="span-2" label="Presentación" value={mk.pitch} onChange={(v) => updateSettings({ mediaKit: { ...mk, pitch: v } })} placeholder="Qué haces, para quién y por qué tu audiencia confía en ti." />
            <TextField label="Correo de contacto" type="email" value={mk.contactEmail ?? profile?.contact_email} onChange={(v) => updateSettings({ mediaKit: { ...mk, contactEmail: v } })} />
            <Toggle label="Mostrar tarifas" checked={mk.showRates ?? false} onChange={(v) => updateSettings({ mediaKit: { ...mk, showRates: v } })} />
          </div>
        </details>
      </div>

      <article className="mk stack" style={{ gap: 20 }}>
        <header className="mk-head">
          {ig.account?.profile_picture_url ? <img className="mk-avatar" src={ig.account.profile_picture_url} alt="" referrerPolicy="no-referrer" /> : <div className="mk-avatar" />}
          <div className="grow">
            <div className="eyebrow">Media kit · {dayLabel(today(), { year: true })}</div>
            <h1 style={{ fontSize: 40 }}>{profile?.display_name || 'VANNI'}</h1>
            <div className="muted">{ig.account?.username ? `@${ig.account.username}` : ''}{mk.headline ? ` · ${mk.headline}` : ''}</div>
          </div>
          <div className="brand-name">VANNI <b>STUDIO</b></div>
        </header>
        {mk.pitch && <p className="pre-wrap" style={{ margin: 0, maxWidth: '70ch' }}>{mk.pitch}</p>}
        <div className="grid kpis">
          <div className="card tight kpi"><div className="kpi-label">Seguidores <SourceBadge kind={stats.followers !== null ? 'real' : 'na'} /></div><div className="kpi-value">{short(stats.followers)}</div></div>
          <div className="card tight kpi"><div className="kpi-label">Alcance mediano / publicación</div><div className="kpi-value">{short(stats.medianReach)}</div><span className="xs faint">Últimas {recent.length} publicaciones</span></div>
          <div className="card tight kpi"><div className="kpi-label">Reproducciones medianas / reel</div><div className="kpi-value">{short(stats.medianViewsReel)}</div><span className="xs faint">{reels.length} reels recientes</span></div>
          <div className="card tight kpi"><div className="kpi-label">Interacción / alcance</div><div className="kpi-value">{pct(stats.er)}</div><span className="xs faint">Mediana</span></div>
        </div>
        <div className="grid kpis">
          <div className="card tight kpi"><div className="kpi-label">Alcance 28 días</div><div className="kpi-value sm">{stats.reach28.days ? short(stats.reach28.value) : '—'}</div></div>
          <div className="card tight kpi"><div className="kpi-label">Reproducciones 28 días</div><div className="kpi-value sm">{stats.views28.days ? short(stats.views28.value) : '—'}</div></div>
          <div className="card tight kpi"><div className="kpi-label">Cuentas que interactuaron 28 d</div><div className="kpi-value sm">{stats.engaged28.days ? short(stats.engaged28.value) : '—'}</div></div>
          <div className="card tight kpi"><div className="kpi-label">Publicaciones</div><div className="kpi-value sm">{n(ig.account?.media_count ?? null)}</div></div>
        </div>
        <div className="grid cols-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <Card title="Países principales">{aud('country').length ? <HBarList items={aud('country').map((x) => ({ key: x.key, label: country(x.key), value: x.share * 100 }))} fmt={(v) => `${v.toFixed(1)} %`} max={100} /> : <span className="faint small">No disponible</span>}</Card>
          <Card title="Ciudades principales">{aud('city').length ? <HBarList items={aud('city').map((x) => ({ key: x.key, label: x.key, value: x.share * 100 }))} fmt={(v) => `${v.toFixed(1)} %`} max={100} /> : <span className="faint small">No disponible</span>}</Card>
          <Card title="Edad y género">{aud('age').length ? <HBarList items={aud('age').map((x) => ({ key: x.key, label: x.key, value: x.share * 100 }))} fmt={(v) => `${v.toFixed(1)} %`} max={100} /> : <span className="faint small">No disponible</span>}{aud('gender').length > 0 && <p className="xs muted">{aud('gender').map((g) => `${({ M: 'Hombres', F: 'Mujeres', U: 'Sin especificar' } as Record<string, string>)[g.key] ?? g.key} ${(g.share * 100).toFixed(0)} %`).join(' · ')}</p>}</Card>
        </div>
        {top.length > 0 && (
          <section><h3 style={{ marginBottom: 10 }}>Contenido destacado</h3>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {top.map((m) => (
                <a key={m.id} href={m.permalink ?? '#'} target="_blank" rel="noreferrer" className="card tight stack tight" style={{ textDecoration: 'none' }}>
                  {m.thumbnail_url || m.media_url ? <img src={m.thumbnail_url || m.media_url!} alt="" style={{ width: '100%', aspectRatio: '4 / 5', objectFit: 'cover', borderRadius: 10 }} referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} /> : null}
                  <span className="xs num">{short(mediaMetric(m, 'reach'))} alcance · {short(mediaMetric(m, 'views'))} repr.</span>
                  <button type="button" className="btn sm ghost no-print" onClick={(e) => { e.preventDefault(); updateSettings({ mediaKit: { ...mk, hidePosts: [...(mk.hidePosts ?? []), m.ig_media_id] } }); }}>Ocultar</button>
                </a>
              ))}
            </div>
          </section>
        )}
        {series.length > 0 && <section><h3 style={{ marginBottom: 10 }}>Series originales</h3><div className="grid auto">{series.map((s) => { const p = perf.get(s.id); return <div key={s.id} className="card tight"><b>{s.title}</b><div className="small muted">{s.tagline}</div>{p?.posts ? <div className="xs faint num" style={{ marginTop: 4 }}>{p.posts} publicaciones · {short(p.reach)} alcance acumulado</div> : null}</div>; })}</div></section>}
        {mk.showRates && rates.length > 0 && <section><h3 style={{ marginBottom: 10 }}>Tarifas</h3><div className="list">{rates.map((r) => <div key={r.id} className="list-item" style={{ cursor: 'default' }}><span className="grow"><b>{r.name}</b>{r.description && <div className="xs faint">{r.description}</div>}</span><b className="num">{money(r.price ?? null, r.currency)}</b></div>)}</div></section>}
        <footer className="row between wrap xs faint" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <span>Contacto: {mk.contactEmail || profile?.contact_email || '—'}</span>
          <span>Métricas reales de la API oficial de Instagram (Meta){updated ? ` · actualizadas ${new Date(updated).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</span>
        </footer>
      </article>
    </div>
  );
}
