import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, CheckCircle2, CloudOff, Info, Loader2, X, XCircle } from 'lucide-react';
import { useSyncState } from '../lib/store';

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="titles">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, action, children, className = '', tight }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; tight?: boolean }) {
  return (
    <section className={`card ${tight ? 'tight' : ''} ${className}`}>
      {(title || action) && <div className="card-head">{typeof title === 'string' ? <h3>{title}</h3> : title}{action}</div>}
      {children}
    </section>
  );
}

export type Source = 'real' | 'manual' | 'na' | 'calc';
const SOURCE_LABEL: Record<Source, string> = { real: 'Instagram', manual: 'Manual', na: 'No disponible', calc: 'Calculado' };
export function SourceBadge({ kind, title }: { kind: Source; title?: string }) {
  return <span className={`src ${kind}`} title={title ?? (kind === 'real' ? 'Dato real obtenido de la API oficial de Meta' : kind === 'manual' ? 'Dato registrado manualmente' : kind === 'calc' ? 'Calculado a partir de tus registros' : 'Meta no entrega este dato para tu cuenta o aún no hay registros')}>{SOURCE_LABEL[kind]}</span>;
}

export function Kpi({ label, value, delta, deltaClass, source, sub }: { label: ReactNode; value: ReactNode; delta?: ReactNode; deltaClass?: string; source?: Source; sub?: ReactNode }) {
  return (
    <div className="card tight kpi">
      <div className="kpi-label">{label}{source && <SourceBadge kind={source} />}</div>
      <div className="kpi-value">{value}</div>
      {delta !== undefined && <div className={`kpi-delta ${deltaClass ?? ''}`}>{delta}</div>}
      {sub && <div className="xs faint">{sub}</div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'crit' | 'ok'; children: ReactNode }) {
  const Icon = tone === 'warn' ? AlertTriangle : tone === 'crit' ? XCircle : tone === 'ok' ? CheckCircle2 : Info;
  return <div className={`notice ${tone === 'info' ? '' : tone}`} role={tone === 'crit' ? 'alert' : undefined}><Icon size={16} /><div>{children}</div></div>;
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return <div className="row muted small" role="status"><Loader2 size={16} className="spin" />{label}</div>;
}

export function Progress({ value, thin }: { value: number | null; thin?: boolean }) {
  const v = Math.max(0, Math.min(1, value ?? 0));
  return <div className={`progress ${thin ? 'thin' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}><i style={{ width: `${v * 100}%` }} /></div>;
}

export function Tabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode }>; label?: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={`tab ${value === o.value ? 'active' : ''}`} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Chips<T extends string>({ value, onChange, options, scroll }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode }>; scroll?: boolean }) {
  return (
    <div className={`chips ${scroll ? 'scroll' : ''}`}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={value === o.value} className={`chip ${value === o.value ? 'active' : ''}`} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function SaveIndicator() {
  const s = useSyncState();
  if (s.offline) return <span className="save-state pending"><CloudOff size={14} />Sin conexión · {s.pending} por guardar</span>;
  if (s.error && s.pending) return <span className="save-state error"><AlertTriangle size={14} />{s.error}</span>;
  if (s.pending) return <span className="save-state pending"><Loader2 size={14} className="spin" />Guardando…</span>;
  return <span className="save-state"><Check size={14} />Guardado</span>;
}

// ───────────────────────── Campos con guardado automático
/** Mantiene un borrador local y lo envía con retardo para no guardar en cada tecla. */
function useDraft<T>(value: T, onCommit: (v: T) => void, delay = 500) {
  const [draft, setDraft] = useState<T>(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const latest = useRef(onCommit);
  latest.current = onCommit;
  useEffect(() => { if (!dirty.current) setDraft(value); }, [value]);
  const commitNow = (v: T) => { if (timer.current) clearTimeout(timer.current); timer.current = null; dirty.current = false; latest.current(v); };
  const change = (v: T) => {
    setDraft(v);
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commitNow(v), delay);
  };
  useEffect(() => () => { if (timer.current && dirty.current) { clearTimeout(timer.current); latest.current(draftRef.current); } }, []);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  return { draft, change, flush: () => { if (dirty.current) commitNow(draftRef.current); } };
}

interface BaseFieldProps { label?: ReactNode; hint?: ReactNode; className?: string }

export function TextField({ label, hint, value, onChange, placeholder, type = 'text', className = '', inputMode, autoComplete, required, maxLength }: BaseFieldProps & { value: string | null | undefined; onChange: (v: string) => void; placeholder?: string; type?: string; inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'url' | 'tel' | 'search'; autoComplete?: string; required?: boolean; maxLength?: number }) {
  const id = useId();
  const { draft, change, flush } = useDraft(value ?? '', onChange);
  return (
    <label className={`field ${className}`} htmlFor={id}>
      {label && <span>{label}</span>}
      <input id={id} className="input" type={type} value={draft} placeholder={placeholder} inputMode={inputMode} autoComplete={autoComplete} required={required} maxLength={maxLength}
        onChange={(e) => change(e.target.value)} onBlur={flush} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function TextArea({ label, hint, value, onChange, placeholder, rows = 4, className = '', script }: BaseFieldProps & { value: string | null | undefined; onChange: (v: string) => void; placeholder?: string; rows?: number; script?: boolean }) {
  const id = useId();
  const { draft, change, flush } = useDraft(value ?? '', onChange, 700);
  return (
    <label className={`field ${className}`} htmlFor={id}>
      {label && <span>{label}</span>}
      <textarea id={id} className={`textarea ${script ? 'script' : ''}`} rows={rows} value={draft} placeholder={placeholder} onChange={(e) => change(e.target.value)} onBlur={flush} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function NumberField({ label, hint, value, onChange, placeholder, step = 'any', min, max, className = '', suffix }: BaseFieldProps & { value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; step?: string; min?: number; max?: number; suffix?: string }) {
  const id = useId();
  const { draft, change, flush } = useDraft(value === null || value === undefined ? '' : String(value), (s) => {
    const t = s.replace(',', '.').trim();
    onChange(t === '' ? null : Number.isFinite(Number(t)) ? Number(t) : null);
  });
  return (
    <label className={`field ${className}`} htmlFor={id}>
      {label && <span>{label}{suffix ? ` (${suffix})` : ''}</span>}
      <input id={id} className="input num" type="text" inputMode="decimal" value={draft} placeholder={placeholder} data-step={step} data-min={min} data-max={max}
        onChange={(e) => change(e.target.value.replace(/[^0-9.,-]/g, ''))} onBlur={flush} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function DateField({ label, hint, value, onChange, className = '', type = 'date' }: BaseFieldProps & { value: string | null | undefined; onChange: (v: string | null) => void; type?: 'date' | 'time' | 'month' | 'datetime-local' }) {
  const id = useId();
  return (
    <label className={`field ${className}`} htmlFor={id}>
      {label && <span>{label}</span>}
      <input id={id} className="input" type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Select<T extends string>({ label, hint, value, onChange, options, className = '', placeholder }: BaseFieldProps & { value: T | null | undefined; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; placeholder?: string }) {
  const id = useId();
  return (
    <label className={`field ${className}`} htmlFor={id}>
      {label && <span>{label}</span>}
      <select id={id} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value as T)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <label className="row between" style={{ minHeight: 44, cursor: 'pointer' }}>
      <span className="stack tight"><span>{label}</span>{hint && <span className="xs faint">{hint}</span>}</span>
      <span className="switch"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span /></span>
    </label>
  );
}

export function Rating({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  const id = useId();
  return (
    <div className="field">
      <div className="rating-row">
        <label htmlFor={id} className="field-label">{label}</label>
        <output htmlFor={id}>{value ?? '—'}</output>
        <input id={id} className="range" type="range" min={0} max={10} step={1} value={value ?? 0} style={{ gridColumn: '1 / -1' }}
          aria-valuetext={value ? `${value} de 10` : 'Sin calificar'} onChange={(e) => onChange(Number(e.target.value) || null)} />
      </div>
    </div>
  );
}

export function TagInput({ label = 'Etiquetas', value, onChange, suggestions = [] }: { label?: string; value: string[] | null | undefined; onChange: (v: string[]) => void; suggestions?: string[] }) {
  const [text, setText] = useState('');
  const tags = value ?? [];
  const id = useId();
  const add = (t: string) => {
    const clean = t.trim().replace(/^#/, '').toLowerCase();
    if (clean && !tags.includes(clean)) onChange([...tags, clean]);
    setText('');
  };
  const listId = `${id}-list`;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">{label}</label>
      <div className="row wrap" style={{ gap: 6 }}>
        {tags.map((t) => (
          <span key={t} className="tag">#{t}<button type="button" className="icon-btn" style={{ width: 22, height: 22 }} aria-label={`Quitar ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}><X size={12} /></button></span>
        ))}
      </div>
      <input id={id} className="input" list={listId} value={text} placeholder="Escribe y pulsa Enter" enterKeyHint="done"
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); } }} onBlur={() => text && add(text)} />
      <datalist id={listId}>{suggestions.filter((s) => !tags.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field"><span className="field-label">{label}</span>{children}</div>;
}
