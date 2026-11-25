// Gráficas SVG ligeras: línea (con periodo anterior punteado), barras, barras horizontales,
// mapa de calor y minigráfica. Interacción por puntero/táctil con cursor y etiqueta flotante.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const compact = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 });
const defaultFmt = (v: number) => (Math.abs(v) >= 10_000 ? compact.format(v) : new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(v));

export interface LineSeries { key: string; label: string; color: string; values: Array<number | null>; dashed?: boolean }

function DataTable({ labels, series, fmt }: { labels: string[]; series: LineSeries[]; fmt: (v: number) => string }) {
  return (
    <details className="table-toggle">
      <summary>Ver tabla de datos</summary>
      <div className="table-wrap" style={{ maxHeight: 280 }}>
        <table className="table">
          <thead><tr><th>Fecha</th>{series.map((s) => <th key={s.key} className="r">{s.label}</th>)}</tr></thead>
          <tbody>{labels.map((l, i) => <tr key={l + i}><td>{l}</td>{series.map((s) => <td key={s.key} className="r">{s.values[i] === null || s.values[i] === undefined ? '—' : fmt(s.values[i]!)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

export function LineChart({ labels, series, height = 200, fmt = defaultFmt, minZero = true, table = true, ariaLabel }: { labels: string[]; series: LineSeries[]; height?: number; fmt?: (v: number) => string; minZero?: boolean; table?: boolean; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, r: 10, t: 10, b: 24 };
  const W = Math.max(width, 200), H = height;
  const { min, max } = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
    if (!all.length) return { min: 0, max: 1 };
    const mx = Math.max(...all), mn = Math.min(...all);
    if (minZero) return { min: 0, max: niceMax(mx * 1.05) };
    const span = mx - mn || Math.abs(mx) * 0.1 || 1;
    return { min: mn - span * 0.15, max: mx + span * 0.15 };
  }, [series, minZero]);
  const n = labels.length;
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min || 1)) * (H - pad.t - pad.b);
  const path = (vals: Array<number | null>) => {
    let d = '', pen = false;
    vals.forEach((v, i) => { if (v === null || !Number.isFinite(v)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    return d;
  };
  const ticks = [0, 0.5, 1].map((t) => min + (max - min) * t);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - pad.l) / 70))));
  const onMove = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const rel = clientX - rect.left - pad.l;
    const i = Math.round((rel / (W - pad.l - pad.r)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const hasData = series.some((s) => s.values.some((v) => v !== null));
  return (
    <div>
      <div className="chart" ref={ref} style={{ height: H }}
        onPointerMove={(e) => onMove(e.clientX)} onPointerDown={(e) => onMove(e.clientX)} onPointerLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={W} height={H} role="img" aria-label={ariaLabel}>
            {ticks.map((t, i) => (
              <g key={i}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
                <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-3)">{fmt(t)}</text>
              </g>
            ))}
            {labels.map((l, i) => (i % labelEvery === 0 || i === n - 1) && (
              <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--text-3)">{l}</text>
            ))}
            {series.map((s) => (
              <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '4 4' : undefined} opacity={s.dashed ? 0.8 : 1} />
            ))}
            {series.map((s) => {
              const last = [...s.values].map((v, i) => [v, i] as const).reverse().find(([v]) => v !== null);
              return last && !s.dashed ? <circle key={s.key + 'end'} cx={x(last[1])} cy={y(last[0]!)} r={4} fill={s.color} stroke="var(--surface-2)" strokeWidth={2} /> : null;
            })}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--line-strong)" strokeWidth={1} />
                {series.map((s) => s.values[hover] !== null && s.values[hover] !== undefined && <circle key={s.key} cx={x(hover)} cy={y(s.values[hover]!)} r={4.5} fill={s.color} stroke="var(--surface-2)" strokeWidth={2} />)}
              </g>
            )}
            {!hasData && <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={13} fill="var(--text-3)">Sin datos en este periodo</text>}
          </svg>
        )}
        {hover !== null && hasData && (
          <div className="chart-tip" style={{ left: Math.min(Math.max(x(hover), 70), W - 70), top: pad.t + 6 }}>
            <div className="faint" style={{ marginBottom: 4 }}>{labels[hover]}</div>
            {series.map((s) => (
              <div key={s.key} className="row between" style={{ gap: 12 }}>
                <span className="row" style={{ gap: 6 }}><i style={{ width: 10, height: 2, background: s.color, display: 'inline-block' }} />{s.label}</span>
                <b>{s.values[hover] === null || s.values[hover] === undefined ? '—' : fmt(s.values[hover]!)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      {series.length > 1 && (
        <div className="legend">{series.map((s) => <span key={s.key}><i className={s.dashed ? 'dash' : ''} style={{ background: s.color }} />{s.label}</span>)}</div>
      )}
      {table && <DataTable labels={labels} series={series} fmt={fmt} />}
    </div>
  );
}

export function BarChart({ labels, values, height = 180, color = 'var(--accent)', fmt = defaultFmt, ariaLabel, seriesLabel = 'Valor', table = true }: { labels: string[]; values: Array<number | null>; height?: number; color?: string; fmt?: (v: number) => string; ariaLabel: string; seriesLabel?: string; table?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 40, r: 6, t: 10, b: 24 };
  const W = Math.max(width, 200), H = height;
  const max = niceMax(Math.max(0, ...values.filter((v): v is number => v !== null)) * 1.05);
  const n = values.length;
  const slot = (W - pad.l - pad.r) / Math.max(1, n);
  const bw = Math.max(2, Math.min(28, slot - 2));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - pad.l) / 56))));
  return (
    <div>
      <div className="chart" ref={ref} style={{ height: H }} onPointerLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={W} height={H} role="img" aria-label={ariaLabel}>
            {[0, 0.5, 1].map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(max * t)} y2={y(max * t)} stroke="var(--chart-grid)" /><text x={pad.l - 6} y={y(max * t) + 4} textAnchor="end" fontSize={11} fill="var(--text-3)">{fmt(max * t)}</text></g>)}
            {values.map((v, i) => {
              const cx = pad.l + slot * i + slot / 2;
              const h = v ? Math.max(1, H - pad.b - y(v)) : 0;
              return (
                <g key={i} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
                  <rect x={pad.l + slot * i} y={pad.t} width={slot} height={H - pad.t - pad.b} fill="transparent" />
                  {v !== null && v > 0 && <path d={`M${cx - bw / 2},${H - pad.b} v${-(h - Math.min(4, h))} q0,${-Math.min(4, h)} ${Math.min(4, bw / 2)},${-Math.min(4, h)} h${bw - 2 * Math.min(4, bw / 2)} q${Math.min(4, bw / 2)},0 ${Math.min(4, bw / 2)},${Math.min(4, h)} v${h - Math.min(4, h)} z`} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />}
                  {(i % labelEvery === 0) && <text x={cx} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--text-3)">{labels[i]}</text>}
                </g>
              );
            })}
          </svg>
        )}
        {hover !== null && (
          <div className="chart-tip" style={{ left: Math.min(Math.max(pad.l + slot * hover + slot / 2, 70), W - 70), top: pad.t + 6 }}>
            <div className="faint">{labels[hover]}</div><b>{values[hover] === null ? '—' : fmt(values[hover]!)}</b>
          </div>
        )}
      </div>
      {table && <DataTable labels={labels} series={[{ key: 'v', label: seriesLabel, color, values }]} fmt={fmt} />}
    </div>
  );
}

export function HBarList({ items, fmt = defaultFmt, max: maxProp, color }: { items: Array<{ key: string; label: ReactNode; value: number; extra?: ReactNode }>; fmt?: (v: number) => string; max?: number; color?: string }) {
  const max = maxProp ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div role="list">
      {items.map((i) => (
        <div className="hbar" role="listitem" key={i.key}>
          <span className="truncate">{i.label}</span>
          <span className="track"><i style={{ width: `${(i.value / max) * 100}%`, background: color }} /></span>
          <span className="num small">{fmt(i.value)}{i.extra}</span>
        </div>
      ))}
    </div>
  );
}

/** Mapa de calor secuencial de un solo tono (verde): más claro = mayor valor. */
export function Heatmap({ rows, cols, value, cellTitle, legend }: { rows: string[]; cols: string[]; value: (r: number, c: number) => number | null; cellTitle: (r: number, c: number) => string; legend?: ReactNode }) {
  const vals = rows.flatMap((_, r) => cols.map((_, c) => value(r, c))).filter((v): v is number => v !== null);
  const mx = Math.max(0.0001, ...vals), mn = Math.min(...vals, mx);
  const shade = (v: number | null) => {
    if (v === null) return 'var(--surface-1)';
    const t = mx === mn ? 0.6 : (v - mn) / (mx - mn);
    return `color-mix(in oklab, var(--accent) ${Math.round(12 + t * 80)}%, var(--surface-3))`;
  };
  return (
    <div>
      <div className="heat" style={{ gridTemplateColumns: `minmax(44px, auto) repeat(${cols.length}, minmax(0, 1fr))` }}>
        <span />
        {cols.map((c) => <span key={c} className="xs faint" style={{ textAlign: 'center' }}>{c}</span>)}
        {rows.map((r, ri) => (
          <div key={r} style={{ display: 'contents' }}>
            <span className="xs faint" style={{ alignSelf: 'center' }}>{r}</span>
            {cols.map((c, ci) => { const v = value(ri, ci); return <span key={c} className="heat-cell" title={cellTitle(ri, ci)} style={{ background: shade(v), outline: v === null ? '1px dashed var(--line)' : undefined }} />; })}
          </div>
        ))}
      </div>
      {legend && <div className="legend">{legend}</div>}
    </div>
  );
}

export function Sparkline({ values, width = 96, height = 28, color = 'var(--accent)', label }: { values: Array<number | null>; width?: number; height?: number; color?: string; label: string }) {
  const pts = values.map((v, i) => [i, v] as const).filter(([, v]) => v !== null) as Array<readonly [number, number]>;
  if (pts.length < 2) return <span className="xs faint">—</span>;
  const mn = Math.min(...pts.map((p) => p[1])), mx = Math.max(...pts.map((p) => p[1]));
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - ((v - mn) / (mx - mn || 1)) * (height - 6);
  return (
    <svg width={width} height={height} role="img" aria-label={label}>
      <path d={pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i)},${y(v)}`).join('')} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
