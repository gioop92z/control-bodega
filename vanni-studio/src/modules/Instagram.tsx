import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, Instagram as IgIcon, Link2Off, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { callFunction } from '../lib/supabase';
import { useTable } from '../lib/store';
import { Card, Chips, Kpi, Notice, PageHeader, Select, SourceBadge, Tabs } from '../components/ui';
import { LineChart } from '../components/charts';
import { useToast, confirmAction } from '../components/toast';
import { Sheet } from '../components/Sheet';
import { addDays, dayLabel, monthLabel, relativeTime, today } from '../lib/dates';
import { dailySeries, growth, periodChange, valueAtOrBefore } from '../lib/analytics';
import { metricLabel } from '../lib/constants';
import { n, short, signed, signedPct, trendClass } from '../lib/format';
import { toCsv, downloadBlob } from '../lib/csv';
import { useIgData } from './shared';
import type { IgAccount, MetricSupport, SyncRun } from '../lib/types';

interface StatusResponse { configured: boolean; source: string | null; appId: string | null; redirectUri: string; scopes: string[]; account: IgAccount | null; runs: SyncRun[]; support: MetricSupport[] }

// Estado compartido: todas las tarjetas de conexión se actualizan juntas tras guardar o conectar.
let statusSnap: { status: StatusResponse | null; error: string | null; at: number } = { status: null, error: null, at: 0 };
const statusSubs = new Set<() => void>();
let statusLoading: Promise<void> | null = null;
function loadStatus(): Promise<void> {
  if (statusLoading) return statusLoading;
  statusLoading = callFunction<StatusResponse>('instagram', { action: 'status' }, { timeoutMs: 20_000 })
    .then((s) => { statusSnap = { status: s, error: null, at: Date.now() }; })
    .catch((e) => { statusSnap = { ...statusSnap, error: (e as Error).message, at: Date.now() }; })
    .finally(() => { statusLoading = null; statusSubs.forEach((l) => l()); });
  return statusLoading;
}

export function useInstagramStatus() {
  const snap = useSyncExternalStore((l) => { statusSubs.add(l); return () => statusSubs.delete(l); }, () => statusSnap);
  useEffect(() => { if (Date.now() - statusSnap.at > 15_000) void loadStatus(); }, []);
  return { status: snap.status, error: snap.error, reload: loadStatus };
}

function nextCronRun(): Date {
  const d = new Date();
  const next = new Date(d);
  next.setUTCMinutes(17, 0, 0);
  if (next <= d) next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

export function ConnectionCard({ compact }: { compact?: boolean }) {
  const { status, error, reload } = useInstagramStatus();
  const accounts = useTable('ig_accounts');
  const runs = useTable('ig_sync_runs');
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const account = accounts.rows[0] ?? status?.account ?? null;
  const running = runs.rows.find((r) => r.status === 'running' && Date.now() - new Date(r.started_at).getTime() < 10 * 60_000);

  const connect = async () => {
    setBusy('connect');
    try {
      const returnUrl = `${window.location.origin}${window.location.pathname}`;
      const r = await callFunction<{ url: string }>('instagram', { action: 'connect', returnUrl });
      window.location.href = r.url;
    } catch (e) { toast((e as Error).message, 'error'); setBusy(null); }
  };
  const sync = async () => {
    setBusy('sync');
    try { await callFunction('instagram', { action: 'sync' }); toast('Sincronización iniciada. Los datos se actualizarán en unos segundos.', 'success'); void runs.reload(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  const disconnect = async (deleteHistory: boolean) => {
    if (deleteHistory && !confirmAction('Se borrará todo el historial de Instagram guardado (seguidores, métricas, publicaciones). ¿Continuar?')) return;
    setBusy('disconnect');
    try { await callFunction('instagram', { action: 'disconnect', deleteHistory }); toast('Instagram desconectado', 'success'); setDisconnectOpen(false); await Promise.all([accounts.reload(), reload()]); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };

  if (error) return <Notice tone="crit">No se pudo consultar el estado de Instagram: {error}</Notice>;
  if (!status) return <Card><div className="row muted small"><Loader2 size={16} className="spin" />Consultando conexión…</div></Card>;

  if (!status.configured) {
    return (
      <Card title="Conecta tu Instagram real" action={<SourceBadge kind="na" />}>
        <p className="muted small" style={{ marginTop: 0 }}>Para obtener estadísticas reales necesitas una app gratuita en Meta Developers (autorización oficial OAuth, sin contraseñas). El asistente te guía paso a paso.</p>
        <Link className="btn primary" to="/configurar-meta"><Settings2 size={16} />Abrir asistente de configuración</Link>
      </Card>
    );
  }

  const isConnected = account?.status === 'connected';
  const needsReconnect = account?.status === 'reconnect_required';
  const missingInsights = account && account.scopes?.length && !account.scopes.includes('instagram_business_manage_insights');
  return (
    <Card className={compact ? '' : 'hero'}>
      <div className="row top between wrap">
        <div className="row">
          {account?.profile_picture_url ? <img src={account.profile_picture_url} alt="" width={52} height={52} style={{ borderRadius: '50%', border: '2px solid var(--accent)' }} referrerPolicy="no-referrer" /> : <span className="brand-mark" style={{ width: 52, height: 52, borderRadius: '50%' }}><IgIcon size={22} /></span>}
          <div>
            <div className="row" style={{ gap: 8 }}><h3>{account?.username ? `@${account.username}` : 'Instagram'}</h3>{isConnected ? <span className="badge accent">Conectado</span> : needsReconnect ? <span className="badge crit">Reconexión necesaria</span> : <span className="badge">Desconectado</span>}</div>
            <div className="xs faint">{isConnected ? <>Última actualización exitosa: {relativeTime(account?.last_success_at)} · Próxima automática: {nextCronRun().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</> : 'Autorización oficial de Meta (OAuth). VANNI STUDIO nunca ve tu contraseña.'}</div>
          </div>
        </div>
        <div className="row wrap">
          {isConnected && <button className="btn" type="button" disabled={!!busy || !!running} onClick={() => void sync()}><RefreshCw size={16} className={running || busy === 'sync' ? 'spin' : ''} />{running ? 'Sincronizando…' : 'Sincronizar ahora'}</button>}
          {!isConnected && <button className="btn primary" type="button" disabled={!!busy} onClick={() => void connect()}>{busy === 'connect' ? <Loader2 size={16} className="spin" /> : <IgIcon size={16} />}{needsReconnect ? 'Reconectar Instagram' : 'Conectar mi Instagram'}</button>}
          {account && account.status !== 'disconnected' && <button className="btn ghost" type="button" onClick={() => setDisconnectOpen(true)}><Link2Off size={16} />Desconectar</button>}
        </div>
      </div>
      {account?.last_error && <div style={{ marginTop: 12 }}><Notice tone={needsReconnect ? 'crit' : 'warn'}>{account.last_error}{account.last_error_at ? ` (${relativeTime(account.last_error_at)})` : ''}</Notice></div>}
      {missingInsights && <div style={{ marginTop: 12 }}><Notice tone="warn">No autorizaste el permiso de estadísticas (instagram_business_manage_insights). Reconecta y deja marcada esa casilla para obtener alcance, reproducciones y audiencia.</Notice></div>}
      {isConnected && account?.token_expires_at && !compact && <p className="xs faint" style={{ margin: '10px 0 0' }}>El token de 60 días se renueva solo cada semana · vence {relativeTime(account.token_expires_at)} · cuenta {account.account_type ?? 'profesional'}</p>}
      <Sheet open={disconnectOpen} onClose={() => setDisconnectOpen(false)} title="Desconectar Instagram">
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>Se elimina el token cifrado del servidor y se detiene la sincronización. Para revocar también el acceso desde Instagram: Configuración → Seguridad → Apps y sitios web.</p>
          <button className="btn" type="button" disabled={!!busy} onClick={() => void disconnect(false)}>Desconectar y conservar mi historial</button>
          <button className="btn danger" type="button" disabled={!!busy} onClick={() => void disconnect(true)}>Desconectar y borrar el historial de Instagram</button>
        </div>
      </Sheet>
    </Card>
  );
}

const PERIODS = [{ value: '7', label: '7 días' }, { value: '30', label: '30 días' }, { value: '90', label: '90 días' }, { value: '365', label: '1 año' }] as const;
const CHART_METRICS = ['reach', 'views', 'total_interactions', 'accounts_engaged', 'likes', 'comments', 'shares', 'saves', 'profile_views', 'profile_links_taps'];

export function InstagramPage() {
  const ig = useIgData();
  const manual = useTable('manual_metrics');
  const runs = useTable('ig_sync_runs');
  const support = useTable('ig_metric_support');
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [period, setPeriod] = useState<'7' | '30' | '90' | '365'>('30');
  const [metric, setMetric] = useState('reach');
  const [view, setView] = useState<'diario' | 'mensual' | 'anual'>('diario');
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    const ig_ = params.get('ig');
    if (!ig_) return;
    if (ig_ === 'connected') { toast(params.get('missing') ? 'Conectado, pero faltan permisos de estadísticas.' : 'Instagram conectado. Importando tus estadísticas reales…', params.get('missing') ? 'error' : 'success'); void ig.reloadAll(); }
    else toast(`No se completó la conexión: ${params.get('reason') ?? 'error desconocido'}`, 'error');
    setParams({}, { replace: true });
  }, [params]);

  const end = today();
  const days = Number(period);
  const from = addDays(end, -(days - 1));
  const labels = useMemo(() => Array.from({ length: days }, (_, i) => dayLabel(addDays(from, i))), [from, days]);
  const followerVals = useMemo(() => Array.from({ length: days }, (_, i) => { const d = addDays(from, i); const p = ig.followers.find((x) => x.day === d); return p ? p.followers : null; }), [ig.followers, from, days]);
  const manualFollowers = manual.rows.filter((m) => m.metric === 'followers');
  const metricCur = dailySeries(ig.insights, metric, from, end).map((x) => x.value);
  const metricPrev = dailySeries(ig.insights, metric, addDays(from, -days), addDays(from, -1)).map((x) => x.value);
  const g = growth(ig.followers);
  const ch = (m: string) => periodChange(ig.insights, m, 28);
  const supportMap = new Map(support.rows.filter((s) => s.scope === 'account').map((s) => [s.metric, s]));
  const kpiSource = (m: string) => (supportMap.get(m)?.status === 'unavailable' ? 'na' : ig.insights.some((r) => r.metric === m) ? 'real' : 'na') as 'real' | 'na';

  const monthly = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const r of ig.insights) {
      if (r.metric.includes('__') || r.value === null) continue;
      const k = view === 'anual' ? r.day.slice(0, 4) : r.day.slice(0, 7);
      const o = map.get(k) ?? {};
      o[r.metric] = (o[r.metric] ?? 0) + Number(r.value);
      map.set(k, o);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, v]) => {
      const lastDay = view === 'anual' ? `${k}-12-31` : `${k}-31`;
      const firstDay = view === 'anual' ? `${k}-01-01` : `${k}-01`;
      const endF = valueAtOrBefore(ig.followers, lastDay);
      const startF = ig.followers.find((p) => p.day >= firstDay && p.day <= lastDay);
      return { key: k, ...v, followersEnd: endF && endF.day >= firstDay ? endF.followers : null, followersStart: startF?.followers ?? null };
    });
  }, [ig.insights, ig.followers, view]);

  const dailyRows = useMemo(() => Array.from({ length: 60 }, (_, i) => addDays(end, -i)).map((d) => {
    const f = ig.followers.find((p) => p.day === d);
    const prev = ig.followers.find((p) => p.day === addDays(d, -1));
    const get = (m: string) => ig.insights.find((r) => r.day === d && r.metric === m)?.value ?? null;
    return { day: d, followers: f?.followers ?? null, delta: f && prev ? f.followers - prev.followers : null, reach: get('reach'), views: get('views'), interactions: get('total_interactions'), engaged: get('accounts_engaged') };
  }).filter((r) => r.followers !== null || r.reach !== null), [ig.followers, ig.insights, end]);

  const exportCsv = () => downloadBlob(new Blob([toCsv(ig.insights.map((r) => ({ dia: r.day, metrica: r.metric, valor: r.value, desglose: r.breakdown, origen: 'Instagram API' })))], { type: 'text/csv' }), 'vanni-instagram-metricas.csv');

  return (
    <div>
      <PageHeader eyebrow="Datos reales · API oficial de Meta" title="Instagram" description="Seguidores, alcance, reproducciones e interacciones sincronizados cada 60 minutos, con historial diario, mensual y anual." actions={<><Link className="btn" to="/instagram/publicaciones">Publicaciones</Link><Link className="btn" to="/instagram/audiencia">Audiencia</Link></>} />
      <ConnectionCard />

      <div className="grid kpis section">
        <Kpi label="Seguidores" value={short(ig.account?.followers_count ?? null)} source={ig.account?.followers_count !== null && ig.account?.followers_count !== undefined ? 'real' : manualFollowers.length ? 'manual' : 'na'} delta={g[0].delta !== null ? `${signed(g[0].delta)} hoy` : 'Sin historial aún'} deltaClass={trendClass(g[0].delta)} />
        {g.slice(1).map((x) => <Kpi key={x.days} label={`Crecimiento ${x.label.toLowerCase()}`} value={signed(x.delta)} deltaClass={trendClass(x.delta)} delta={x.pct !== null ? signedPct(x.pct) : '—'} sub={x.delta !== null && !x.complete ? `Historial desde ${x.from?.day}` : undefined} source={x.delta !== null ? 'calc' : 'na'} />)}
      </div>
      <div className="grid kpis">
        {['reach', 'views', 'total_interactions', 'accounts_engaged'].map((m) => { const c = ch(m); return <Kpi key={m} label={`${metricLabel(m)} · 28 d`} value={c.current.days ? short(c.current.value) : '—'} source={kpiSource(m)} delta={c.change !== null ? `${signedPct(c.change)} vs. 28 d previos` : c.current.days ? 'Sin periodo previo completo' : 'Sin datos'} deltaClass={trendClass(c.change)} />; })}
      </div>

      <section className="section grid halves">
        <Card title="Seguidores" action={<Chips value={period} onChange={setPeriod} options={[...PERIODS]} />}>
          <LineChart ariaLabel="Seguidores por día" labels={labels} minZero={false} series={[{ key: 'f', label: 'Seguidores', color: 'var(--accent)', values: followerVals }]} fmt={(v) => n(v)} />
          {!ig.followers.length && <p className="xs faint">Cada sincronización guarda un registro diario. El historial de seguidores empieza el día que conectas tu cuenta (Meta no ofrece el histórico completo).</p>}
        </Card>
        <Card title={metricLabel(metric)} action={<Select value={metric} onChange={setMetric} options={CHART_METRICS.map((m) => ({ value: m, label: metricLabel(m) }))} />}>
          <LineChart ariaLabel={`${metricLabel(metric)} por día`} labels={labels} series={[{ key: 'cur', label: `Últimos ${days} días`, color: 'var(--accent)', values: metricCur }, { key: 'prev', label: `${days} días anteriores`, color: 'var(--text-3)', values: metricPrev, dashed: true }]} />
          {supportMap.get(metric)?.status === 'unavailable' && <Notice tone="warn">Meta no ofrece «{metricLabel(metric)}» para tu cuenta con esta API: {supportMap.get(metric)?.error}</Notice>}
        </Card>
      </section>

      <section className="section">
        <div className="section-head"><h2>Registros históricos</h2><div className="row"><Tabs value={view} onChange={setView} options={[{ value: 'diario', label: 'Diario' }, { value: 'mensual', label: 'Mensual' }, { value: 'anual', label: 'Anual' }]} /><button className="btn sm" type="button" onClick={exportCsv}>CSV</button></div></div>
        {view === 'diario' ? (
          <div className="table-wrap"><table className="table"><thead><tr><th>Día</th><th className="r">Seguidores</th><th className="r">Δ</th><th className="r">Alcance</th><th className="r">Reproducciones</th><th className="r">Interacciones</th><th className="r">Cuentas</th></tr></thead>
            <tbody>{dailyRows.length ? dailyRows.map((r) => <tr key={r.day}><td>{dayLabel(r.day, { weekday: true })}</td><td className="r">{n(r.followers)}</td><td className={`r ${trendClass(r.delta)}`}>{signed(r.delta)}</td><td className="r">{n(r.reach)}</td><td className="r">{n(r.views)}</td><td className="r">{n(r.interactions)}</td><td className="r">{n(r.engaged)}</td></tr>) : <tr><td colSpan={7} className="faint">Sin registros todavía.</td></tr>}</tbody></table></div>
        ) : (
          <div className="table-wrap"><table className="table"><thead><tr><th>{view === 'anual' ? 'Año' : 'Mes'}</th><th className="r">Seguidores inicio</th><th className="r">Seguidores fin</th><th className="r">Alcance</th><th className="r">Reproducciones</th><th className="r">Interacciones</th><th className="r">Compartidos</th><th className="r">Guardados</th></tr></thead>
            <tbody>{monthly.length ? monthly.map((r: any) => <tr key={r.key}><td>{view === 'anual' ? r.key : monthLabel(r.key)}</td><td className="r">{n(r.followersStart)}</td><td className="r">{n(r.followersEnd)}</td><td className="r">{n(r.reach)}</td><td className="r">{n(r.views)}</td><td className="r">{n(r.total_interactions)}</td><td className="r">{n(r.shares)}</td><td className="r">{n(r.saves)}</td></tr>) : <tr><td colSpan={8} className="faint">Sin registros todavía.</td></tr>}</tbody></table></div>
        )}
      </section>

      <section className="section grid halves">
        <Card title="Registros manuales" action={<button className="btn sm" type="button" onClick={() => setManualOpen(true)}>Agregar</button>}>
          <p className="xs faint" style={{ marginTop: 0 }}>Para datos que Meta no entrega o de antes de conectar tu cuenta. Siempre se muestran con la etiqueta <SourceBadge kind="manual" />.</p>
          {manual.rows.length ? <div className="list">{[...manual.rows].reverse().slice(0, 12).map((m) => <div key={m.id} className="list-item" style={{ cursor: 'default' }}><span className="grow">{dayLabel(m.day, { year: true })} · {metricLabel(m.metric === 'followers' ? 'Seguidores' : m.metric)}</span><b className="num">{n(m.value)}</b><button className="btn sm ghost" type="button" onClick={() => manual.remove(m.id)}>Quitar</button></div>)}</div> : <p className="muted small">Sin registros manuales.</p>}
        </Card>
        <Card title="Sincronizaciones">
          {runs.rows.length ? <div className="list">{runs.rows.slice(0, 8).map((r) => (
            <div key={r.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
              <span className={`badge ${r.status === 'success' ? 'accent' : r.status === 'partial' || r.status === 'rate_limited' ? 'warn' : r.status === 'running' ? '' : 'crit'}`}>{({ success: 'Correcta', partial: 'Parcial', error: 'Error', running: 'En curso', skipped: 'Omitida', rate_limited: 'Límite API' } as Record<string, string>)[r.status] ?? r.status}</span>
              <div className="grow small"><div>{r.trigger === 'cron' ? 'Automática' : r.trigger === 'manual' ? 'Manual' : 'Conexión'} · {relativeTime(r.started_at)} · {r.api_calls} llamadas</div>{r.error && <div className="xs faint clamp-2">{r.error}</div>}</div>
            </div>))}</div> : <p className="muted small">Aún no hay sincronizaciones.</p>}
        </Card>
      </section>

      <section className="section">
        <Card title="Disponibilidad de datos" action={<AlertTriangle size={16} color="var(--text-3)" />}>
          <p className="xs faint" style={{ marginTop: 0 }}>Meta cambia periódicamente qué métricas entrega y algunas requieren 100+ seguidores. VANNI STUDIO las prueba una por una y marca las que no están disponibles en vez de inventarlas.</p>
          {support.rows.length ? (
            <div className="chips">{support.rows.sort((a, b) => a.scope.localeCompare(b.scope)).map((s) => <span key={s.id} className={`src ${s.status === 'available' ? 'real' : 'na'}`} title={s.error ?? ''}>{s.scope.replace('account_breakdown:', 'desglose ').replace('audience:', 'audiencia ').replace('media:', '')} · {metricLabel(s.metric)}{s.status === 'empty' ? ' (sin datos)' : ''}</span>)}</div>
          ) : <p className="muted small">Se mostrará después de la primera sincronización.</p>}
        </Card>
      </section>
      <ManualMetricSheet open={manualOpen} onClose={() => setManualOpen(false)} />
    </div>
  );
}

function ManualMetricSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const manual = useTable('manual_metrics');
  const [day, setDay] = useState(today());
  const [metric, setMetric] = useState('followers');
  const [value, setValue] = useState('');
  const toast = useToast();
  const save = () => {
    const v = Number(value.replace(',', '.'));
    if (!Number.isFinite(v)) { toast('Escribe un número', 'error'); return; }
    const existing = manual.rows.find((m) => m.day === day && m.metric === metric);
    if (existing) manual.update(existing.id, { value: v }); else manual.insert({ day, metric, value: v });
    setValue('');
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Registro manual" footer={<button className="btn primary" type="button" onClick={save}>Guardar</button>}>
      <div className="form-grid">
        <label className="field"><span>Día</span><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
        <Select label="Métrica" value={metric} onChange={setMetric} options={[{ value: 'followers', label: 'Seguidores' }, ...CHART_METRICS.map((m) => ({ value: m, label: metricLabel(m) }))]} />
        <label className="field"><span>Valor</span><input className="input num" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      </div>
    </Sheet>
  );
}
