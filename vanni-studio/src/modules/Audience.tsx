import { useMemo, useState } from 'react';
import { useTable } from '../lib/store';
import { Card, Empty, PageHeader, SourceBadge, Tabs } from '../components/ui';
import { BarChart, HBarList, LineChart } from '../components/charts';
import { audienceShares, audienceShift, latestAudience } from '../lib/analytics';
import { dayLabel } from '../lib/dates';
import { n } from '../lib/format';

const BREAKDOWNS = [{ value: 'country', label: 'Países' }, { value: 'city', label: 'Ciudades' }, { value: 'age', label: 'Edad' }, { value: 'gender', label: 'Género' }] as const;
const GENDER: Record<string, string> = { M: 'Hombres', F: 'Mujeres', U: 'Sin especificar' };
const regionNames = typeof Intl.DisplayNames !== 'undefined' ? new Intl.DisplayNames(['es'], { type: 'region' }) : null;
function labelFor(b: string, key: string) {
  if (b === 'country' && /^[A-Z]{2}$/.test(key)) { try { return regionNames?.of(key) ?? key; } catch { return key; } }
  if (b === 'gender') return GENDER[key] ?? key;
  return key;
}

export function AudiencePage() {
  const audience = useTable('ig_audience');
  const [metric, setMetric] = useState<'follower_demographics' | 'engaged_audience_demographics'>('follower_demographics');
  const [bd, setBd] = useState<(typeof BREAKDOWNS)[number]['value']>('country');
  const row = latestAudience(audience.rows, metric, bd);
  const shares = audienceShares(row?.data).slice(0, 15);
  const shift = audienceShift(audience.rows, metric, bd);
  const online = audience.rows.filter((r) => r.metric === 'online_followers').sort((a, b) => b.day.localeCompare(a.day))[0];
  const hours = Array.from({ length: 24 }, (_, h) => online?.data?.average_by_hour?.[String(h)] ?? null) as Array<number | null>;
  const history = useMemo(() => {
    const rows = audience.rows.filter((r) => r.metric === metric && r.breakdown === bd).sort((a, b) => a.day.localeCompare(b.day));
    const top = shares.slice(0, 3).map((s) => s.key);
    return { labels: rows.map((r) => dayLabel(r.day)), series: top.map((k, i) => ({ key: k, label: labelFor(bd, k), color: ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'][i], values: rows.map((r) => { const t = audienceShares(r.data); return (t.find((x) => x.key === k)?.share ?? 0) * 100; }) })) };
  }, [audience.rows, metric, bd, shares]);

  return (
    <div>
      <PageHeader eyebrow="Datos reales · actualización diaria" title="Audiencia" description="Demografía de seguidores y de quienes interactúan, ciudades y países principales, y horas de actividad." />
      <div className="stack" style={{ marginBottom: 16 }}>
        <Tabs value={metric} onChange={setMetric} options={[{ value: 'follower_demographics', label: 'Seguidores' }, { value: 'engaged_audience_demographics', label: 'Audiencia que interactuó' }]} />
        <Tabs value={bd} onChange={setBd} options={[...BREAKDOWNS]} />
      </div>
      {!audience.rows.length ? (
        <Empty title="Sin datos de audiencia todavía">Meta entrega la demografía una vez al día y solo para cuentas con al menos 100 seguidores (o 100 interacciones en el caso de la audiencia que interactuó).</Empty>
      ) : (
        <div className="grid halves">
          <Card title={BREAKDOWNS.find((b) => b.value === bd)!.label} action={row ? <SourceBadge kind="real" /> : <SourceBadge kind="na" />}>
            {row ? <><HBarList items={shares.map((s) => ({ key: s.key, label: labelFor(bd, s.key), value: s.value, extra: <span className="faint"> · {(s.share * 100).toFixed(1)} %</span> }))} fmt={(v) => n(v)} /><p className="xs faint">Actualizado {dayLabel(row.day, { year: true })}. Meta solo reporta los 45 principales, por eso la suma puede ser menor que tus seguidores.</p></> : <p className="muted small">Meta no entregó este desglose para tu cuenta.</p>}
          </Card>
          <Card title="Cambios en el tiempo">
            {shift ? (
              <div className="stack">
                <p className="xs faint" style={{ margin: 0 }}>Participación entre {dayLabel(shift.from, { year: true })} y {dayLabel(shift.to, { year: true })} (puntos porcentuales).</p>
                {shift.changes.slice(0, 6).map((c) => <div key={c.key} className="row between small"><span>{labelFor(bd, c.key)}</span><b className={`num ${c.delta > 0 ? 'up' : c.delta < 0 ? 'down' : 'flatline'}`}>{c.delta > 0 ? '+' : ''}{(c.delta * 100).toFixed(1)} pp</b></div>)}
              </div>
            ) : <p className="muted small">Se necesitan al menos 4 semanas de registros diarios para comparar.</p>}
            {history.labels.length > 1 && <LineChart ariaLabel="Participación de los principales segmentos" labels={history.labels} series={history.series} fmt={(v) => `${v.toFixed(1)} %`} />}
          </Card>
          <Card title="Actividad de seguidores por hora" action={online ? <SourceBadge kind="real" /> : <SourceBadge kind="na" />}>
            {online ? <><BarChart ariaLabel="Seguidores en línea por hora" labels={hours.map((_, h) => `${h}h`)} values={hours} seriesLabel="Seguidores en línea" /><p className="xs faint">Promedio de los últimos {online.data?.days ?? '—'} días que reporta Meta. Horas según la zona que usa Meta para tu cuenta.</p></> : <p className="muted small">Meta no entrega esta métrica para cuentas con menos de 100 seguidores.</p>}
          </Card>
        </div>
      )}
    </div>
  );
}
