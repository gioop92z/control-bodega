import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowDown, ArrowUp, Download, HardDriveDownload, KeyRound, LogOut, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { callFunction, supabase, SUPABASE_URL } from '../lib/supabase';
import { getStore, useSyncState, useTable } from '../lib/store';
import { useAuth } from '../lib/auth';
import { Card, Notice, PageHeader, Select, TextField, Tabs } from '../components/ui';
import { useToast, confirmAction } from '../components/toast';
import { useProfile, widgetConfig } from '../lib/profile';
import { CONTACT_KINDS, ENTITY_LABELS, EVENT_CATEGORIES, GOAL_AREAS, IDEA_KINDS, WIDGETS } from '../lib/constants';
import { relativeTime } from '../lib/dates';
import { bytes } from '../lib/format';
import { toCsv, downloadBlob } from '../lib/csv';
import { makeZip } from '../lib/zip';
import { signedUrl } from '../lib/storage';
import type { CustomFieldType, TableName } from '../lib/types';

const TZS: string[] = (() => { try { return (Intl as any).supportedValuesOf('timeZone'); } catch { return ['America/Mexico_City', 'America/Monterrey', 'America/Tijuana', 'America/Cancun', 'America/Bogota', 'America/Lima', 'Europe/Madrid', 'America/New_York', 'America/Los_Angeles']; } })();
const CAT_SCOPES = [
  { value: 'events', label: 'Agenda', builtin: EVENT_CATEGORIES.map((c) => c.label) },
  { value: 'ideas', label: 'Tipos de idea', builtin: IDEA_KINDS.map((c) => c.label) },
  { value: 'goals', label: 'Áreas de objetivos', builtin: GOAL_AREAS.map((c) => c.label) },
  { value: 'contacts', label: 'Tipos de contacto', builtin: CONTACT_KINDS.map((c) => c.label) },
  { value: 'transactions_ingreso', label: 'Categorías de ingreso', builtin: [] as string[] },
  { value: 'transactions_gasto', label: 'Categorías de gasto', builtin: [] as string[] },
];
const FIELD_ENTITIES = ['episodes', 'series', 'gyms', 'ideas', 'goals', 'contacts', 'deals', 'body_logs'];
const FIELD_TYPES: Array<{ value: CustomFieldType; label: string }> = [
  { value: 'text', label: 'Texto' }, { value: 'textarea', label: 'Texto largo' }, { value: 'number', label: 'Número' }, { value: 'date', label: 'Fecha' },
  { value: 'select', label: 'Opciones' }, { value: 'checkbox', label: 'Sí / No' }, { value: 'url', label: 'Enlace' }, { value: 'rating', label: 'Calificación 1–10' },
];
const CSV_TABLES: TableName[] = ['series', 'seasons', 'episodes', 'gyms', 'ideas', 'events', 'tasks', 'body_logs', 'workouts', 'workout_sets', 'goals', 'months', 'contacts', 'deals', 'interactions', 'transactions', 'notes', 'collection_items', 'ig_profile_snapshots', 'ig_account_insights', 'ig_media'];

function ProfileSection() {
  const { profile, update } = useProfile();
  if (!profile) return null;
  return (
    <Card title="Perfil">
      <div className="form-grid two">
        <TextField label="Nombre" value={profile.display_name} onChange={(v) => update({ display_name: v })} />
        <TextField label="Usuario / marca" value={profile.handle} onChange={(v) => update({ handle: v })} />
        <TextField label="Correo de contacto (media kit)" type="email" value={profile.contact_email} onChange={(v) => update({ contact_email: v })} />
        <Select label="Moneda" value={profile.currency} onChange={(v) => update({ currency: v })} options={['MXN', 'USD', 'EUR', 'COP', 'ARS', 'CLP', 'PEN'].map((c) => ({ value: c, label: c }))} />
        <Select className="span-2" label="Zona horaria (define el día de tus registros de Instagram)" value={profile.timezone} onChange={(v) => update({ timezone: v })} options={TZS.map((t) => ({ value: t, label: t }))} />
      </div>
    </Card>
  );
}

function WidgetsSection() {
  const { settings, updateSettings } = useProfile();
  const list = widgetConfig(settings);
  const save = (next: typeof list) => updateSettings({ widgets: next });
  return (
    <Card title="Widgets del inicio">
      <div className="list">
        {list.map((w, i) => (
          <div key={w.key} className="list-item" style={{ cursor: 'default' }}>
            <span className="grow small">{WIDGETS.find((x) => x.key === w.key)?.label}</span>
            <button className="icon-btn" type="button" aria-label="Subir" onClick={() => { if (!i) return; const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; save(n); }}><ArrowUp size={15} /></button>
            <button className="icon-btn" type="button" aria-label="Bajar" onClick={() => { if (i === list.length - 1) return; const n = [...list]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; save(n); }}><ArrowDown size={15} /></button>
            <span className="switch"><input type="checkbox" aria-label={`Mostrar ${w.key}`} checked={w.visible} onChange={(e) => save(list.map((x) => (x.key === w.key ? { ...x, visible: e.target.checked } : x)))} /><span /></span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CategoriesSection() {
  const t = useTable('categories');
  const [scope, setScope] = useState('events');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3be58a');
  const def = CAT_SCOPES.find((s) => s.value === scope)!;
  return (
    <Card title="Categorías personalizadas">
      <Select label="Sección" value={scope} onChange={setScope} options={CAT_SCOPES.map((s) => ({ value: s.value, label: s.label }))} />
      {def.builtin.length > 0 && <p className="xs faint">Predeterminadas: {def.builtin.join(', ')}.</p>}
      <div className="chips" style={{ margin: '8px 0' }}>{t.rows.filter((c) => c.scope === scope).map((c) => <span key={c.id} className="chip"><span className="dot" style={{ background: c.color ?? undefined }} />{c.name}<button className="icon-btn" style={{ width: 22, height: 22 }} type="button" aria-label={`Eliminar ${c.name}`} onClick={() => t.remove(c.id)}><Trash2 size={12} /></button></span>)}</div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; t.insert({ scope, name: name.trim(), color, sort: t.rows.length }); setName(''); }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nueva categoría" />
        <input className="input" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 56, padding: 4 }} aria-label="Color" />
        <button className="btn" type="submit"><Plus size={15} />Agregar</button>
      </form>
    </Card>
  );
}

function CustomFieldsSection() {
  const t = useTable('custom_fields');
  const [entity, setEntity] = useState('episodes');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [options, setOptions] = useState('');
  const list = t.rows.filter((f) => f.entity === entity).sort((a, b) => a.sort - b.sort);
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    const key = label.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `campo_${Date.now()}`;
    if (list.some((f) => f.key === key)) return;
    t.insert({ entity, key, label: label.trim(), type, options: type === 'select' ? options.split(',').map((s) => s.trim()).filter(Boolean) : [], sort: list.length });
    setLabel(''); setOptions('');
  };
  return (
    <Card title="Campos editables">
      <p className="xs faint" style={{ marginTop: 0 }}>Agrega campos propios a cualquier sección. Aparecen al final de cada ficha y se exportan con tus datos.</p>
      <Select label="Sección" value={entity} onChange={setEntity} options={FIELD_ENTITIES.map((e) => ({ value: e, label: ENTITY_LABELS[e] ?? e }))} />
      <div className="list" style={{ margin: '10px 0' }}>{list.length ? list.map((f) => <div key={f.id} className="list-item" style={{ cursor: 'default' }}><span className="grow small">{f.label} <span className="xs faint">· {FIELD_TYPES.find((x) => x.value === f.type)?.label}{f.options.length ? ` (${f.options.join(', ')})` : ''}</span></span><button className="icon-btn" type="button" aria-label="Eliminar campo" onClick={() => { if (confirmAction('¿Eliminar este campo? Los valores guardados no se borran de los registros.')) t.remove(f.id); }}><Trash2 size={15} /></button></div>) : <div className="list-item small muted" style={{ cursor: 'default' }}>Sin campos propios.</div>}</div>
      <form className="form-grid two" onSubmit={add}>
        <label className="field"><span>Nombre del campo</span><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ej. Cámara usada" /></label>
        <Select label="Tipo" value={type} onChange={(v) => setType(v)} options={FIELD_TYPES} />
        {type === 'select' && <label className="field span-2"><span>Opciones (separadas por coma)</span><input className="input" value={options} onChange={(e) => setOptions(e.target.value)} /></label>}
        <div className="span-2"><button className="btn" type="submit"><Plus size={15} />Agregar campo</button></div>
      </form>
    </Card>
  );
}

function TemplatesSection() {
  const t = useTable('templates');
  const labels: Record<string, string> = { episodes: 'Episodios', ideas: 'Ideas', routines: 'Rutinas' };
  return (
    <Card title="Plantillas reutilizables">
      {t.rows.length ? <div className="list">{t.rows.map((x) => <div key={x.id} className="list-item" style={{ cursor: 'default' }}><span className="badge">{labels[x.target] ?? x.target}</span><span className="grow small">{x.name}</span><button className="icon-btn" type="button" aria-label="Eliminar plantilla" onClick={() => t.remove(x.id)}><Trash2 size={15} /></button></div>)}</div> : <p className="muted small">Guarda plantillas desde un episodio, una idea o una rutina con el botón «Plantillas».</p>}
    </Card>
  );
}

interface BackupFile { name: string; path: string; size: number | null; created_at: string | null }

function DataSection() {
  const toast = useToast();
  const attachments = useTable('attachments').rows;
  const series = useTable('series').rows, seasons = useTable('seasons').rows, episodes = useTable('episodes').rows, gyms = useTable('gyms').rows;
  const runs = useTable('backup_runs');
  const [busy, setBusy] = useState<string | null>(null);
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [csvTable, setCsvTable] = useState<TableName>('episodes');
  const input = useRef<HTMLInputElement>(null);
  const loadList = () => callFunction<{ files: BackupFile[] }>('backup', { action: 'list' }).then((r) => setFiles(r.files)).catch(() => {});
  useEffect(() => { void loadList(); }, []);

  const exportJson = async () => {
    setBusy('json');
    try { const data = await callFunction('backup', { action: 'export' }, { timeoutMs: 120_000 }); downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `vanni-studio-${new Date().toISOString().slice(0, 10)}.json`); toast('Exportación completa descargada', 'success'); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  const exportFiles = async () => {
    const paths = [...new Set([...attachments.map((a) => a.storage_path), ...series.map((s) => s.cover_path), ...seasons.map((s) => s.cover_path), ...episodes.map((e) => e.cover_path), ...gyms.map((g) => g.cover_path)].filter(Boolean) as string[])];
    if (!paths.length) { toast('No hay archivos subidos', 'info'); return; }
    setBusy('zip');
    try {
      const out: Array<{ name: string; data: Uint8Array }> = [];
      for (const p of paths) { const url = await signedUrl(p); if (!url) continue; const r = await fetch(url); if (r.ok) out.push({ name: p.split('/').slice(1).join('/'), data: new Uint8Array(await r.arrayBuffer()) }); }
      downloadBlob(makeZip(out), `vanni-studio-archivos-${new Date().toISOString().slice(0, 10)}.zip`);
      toast(`${out.length} archivos exportados`, 'success');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  const exportCsv = async () => {
    const s = getStore(csvTable);
    await s.load();
    const rows = s.getSnapshot().rows.map(({ user_id: _u, ...r }) => r);
    downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv' }), `vanni-${csvTable}.csv`);
  };
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    if (!confirmAction('Importar combina la copia con tus datos actuales (los registros con el mismo identificador se actualizan). ¿Continuar?')) return;
    setBusy('import');
    try {
      const data = JSON.parse(await file.text());
      const r = await callFunction<{ report: Record<string, { rows: number; error?: string }> }>('backup', { action: 'import', data }, { timeoutMs: 180_000 });
      const errs = Object.entries(r.report).filter(([, v]) => v.error);
      toast(errs.length ? `Importado con ${errs.length} errores: ${errs.map(([k, v]) => `${k}: ${v.error}`).join('; ').slice(0, 200)}` : `Importados ${Object.values(r.report).reduce((a, v) => a + v.rows, 0)} registros`, errs.length ? 'error' : 'success');
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); if (input.current) input.current.value = ''; }
  };
  const runBackup = async () => { setBusy('backup'); try { await callFunction('backup', { action: 'run' }, { timeoutMs: 120_000 }); toast('Copia de seguridad creada', 'success'); await loadList(); void runs.reload(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); } };
  const download = async (path: string) => { const r = await callFunction<{ url: string }>('backup', { action: 'download', path }); window.open(r.url, '_blank'); };
  const remove = async (path: string) => {
    if (!confirmAction('¿Eliminar esta copia de seguridad?')) return;
    try { await callFunction('backup', { action: 'delete', path }); await loadList(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  const restore = async (path: string) => {
    if (!confirmAction('¿Restaurar esta copia? Se combinará con tus datos actuales.')) return;
    setBusy('restore');
    try { await callFunction('backup', { action: 'restore', path }, { timeoutMs: 180_000 }); toast('Copia restaurada', 'success'); setTimeout(() => window.location.reload(), 1000); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  return (
    <div className="stack">
      <Card title="Exportar toda tu información">
        <div className="row wrap">
          <button className="btn primary" type="button" disabled={!!busy} onClick={() => void exportJson()}><Download size={16} />{busy === 'json' ? 'Exportando…' : 'Datos completos (JSON)'}</button>
          <button className="btn" type="button" disabled={!!busy} onClick={() => void exportFiles()}><HardDriveDownload size={16} />{busy === 'zip' ? 'Empaquetando…' : 'Fotos y videos (ZIP)'}</button>
        </div>
        <div className="row wrap" style={{ marginTop: 10 }}><Select value={csvTable} onChange={(v) => setCsvTable(v as TableName)} options={CSV_TABLES.map((x) => ({ value: x, label: ENTITY_LABELS[x] ?? x }))} /><button className="btn sm" type="button" onClick={() => void exportCsv()}>CSV de la tabla</button></div>
        <p className="xs faint">El JSON incluye todas tus secciones y el historial de Instagram; sirve para importar o restaurar.</p>
      </Card>
      <Card title="Importar">
        <button className="btn" type="button" disabled={!!busy} onClick={() => input.current?.click()}><Upload size={16} />{busy === 'import' ? 'Importando…' : 'Importar archivo JSON de VANNI STUDIO'}</button>
        <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => void importJson(e.target.files?.[0])} />
      </Card>
      <Card title="Copias de seguridad automáticas" action={<button className="btn sm" type="button" disabled={!!busy} onClick={() => void runBackup()}>{busy === 'backup' ? 'Creando…' : 'Crear copia ahora'}</button>}>
        <p className="xs faint" style={{ marginTop: 0 }}>Cada lunes se guarda una copia completa en tu almacenamiento privado (se conservan las últimas 12).</p>
        {files.length ? <div className="list">{files.map((f) => <div key={f.path} className="list-item" style={{ cursor: 'default' }}><span className="grow small">{f.name.replace('vanni-backup-', '').replace('.json', '').replace(/T(\d\d)-(\d\d)-.*/, ' $1:$2 UTC')}<br /><span className="xs faint">{bytes(f.size)}</span></span><button className="btn sm" type="button" onClick={() => void download(f.path)}>Descargar</button><button className="btn sm ghost" type="button" disabled={!!busy} onClick={() => void restore(f.path)}><RotateCcw size={14} />Restaurar</button><button className="icon-btn" type="button" aria-label="Eliminar copia" onClick={() => void remove(f.path)}><Trash2 size={15} /></button></div>)}</div> : <p className="muted small">Aún no hay copias.</p>}
        {runs.rows.find((r) => r.status === 'error') && <Notice tone="warn">Última copia con error: {runs.rows.find((r) => r.status === 'error')?.error}</Notice>}
      </Card>
    </div>
  );
}

function SecuritySection() {
  const { signOut, user } = useAuth();
  const toast = useToast();
  const [pass, setPass] = useState('');
  const [code, setCode] = useState<string | null>(null);
  return (
    <div className="stack">
      <Card title="Cuenta">
        <p className="small muted" style={{ marginTop: 0 }}>Sesión: {user?.email}</p>
        <form className="row" onSubmit={async (e) => { e.preventDefault(); if (pass.length < 10) { toast('Mínimo 10 caracteres', 'error'); return; } const { error } = await supabase.auth.updateUser({ password: pass }); if (error) toast(error.message, 'error'); else { toast('Contraseña actualizada', 'success'); setPass(''); } }}>
          <input className="input" type="password" autoComplete="new-password" placeholder="Nueva contraseña" value={pass} onChange={(e) => setPass(e.target.value)} />
          <button className="btn" type="submit"><KeyRound size={15} />Cambiar</button>
        </form>
        <div className="row wrap" style={{ marginTop: 12 }}>
          <button className="btn" type="button" onClick={async () => { if (!confirmAction('El código anterior dejará de funcionar. ¿Generar uno nuevo?')) return; try { const r = await callFunction<{ recoveryCode: string }>('owner', { action: 'rotate-recovery' }); setCode(r.recoveryCode); } catch (e) { toast((e as Error).message, 'error'); } }}>Nuevo código de recuperación</button>
          <button className="btn ghost" type="button" onClick={() => void signOut()}><LogOut size={15} />Cerrar sesión</button>
        </div>
        {code && <div className="code-copy"><code style={{ fontSize: 15 }}>{code}</code><button className="btn sm" type="button" onClick={() => void navigator.clipboard?.writeText(code)}>Copiar</button></div>}
      </Card>
      <Card title="Privacidad y seguridad">
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Registro público cerrado: solo existe tu cuenta.</li>
          <li>Cada fila de la base de datos está protegida con seguridad por fila (RLS) ligada a tu sesión.</li>
          <li>Tokens de Instagram y el App Secret de Meta: cifrados con AES-256-GCM en el servidor; la clave vive en Supabase Vault.</li>
          <li>Fotos y videos en almacenamiento privado; se muestran con enlaces firmados de 1 hora.</li>
        </ul>
      </Card>
    </div>
  );
}

function DiagnosticsSection() {
  const sync = useSyncState();
  const account = useTable('ig_accounts').rows[0];
  return (
    <Card title="Diagnóstico">
      <div className="stack tight small">
        <div>Servidor: <span className="mono">{SUPABASE_URL}</span></div>
        <div>Cambios pendientes de guardar: <b>{sync.pending}</b> {sync.offline ? '(sin conexión: se guardarán al reconectar)' : ''}</div>
        <div>Último guardado: {sync.lastSavedAt ? relativeTime(new Date(sync.lastSavedAt).toISOString()) : '—'}</div>
        <div>Instagram: {account ? `${account.status} · última sincronización ${relativeTime(account.last_sync_at)}` : 'sin conectar'} · <Link to="/configurar-meta">asistente</Link></div>
        <div>Versión de la app: 1.0.0</div>
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<'general' | 'personalizar' | 'datos' | 'seguridad'>('general');
  return (
    <div>
      <PageHeader eyebrow="Sistema" title="Ajustes" />
      <div style={{ marginBottom: 16 }}><Tabs value={tab} onChange={setTab} options={[{ value: 'general', label: 'General' }, { value: 'personalizar', label: 'Personalizar' }, { value: 'datos', label: 'Datos y copias' }, { value: 'seguridad', label: 'Seguridad' }]} /></div>
      {tab === 'general' && <div className="stack"><ProfileSection /><Card title="Instagram y Meta"><div className="row wrap"><Link className="btn" to="/configurar-meta">Asistente de configuración de Meta</Link><Link className="btn" to="/instagram">Estado de la conexión</Link></div></Card><DiagnosticsSection /></div>}
      {tab === 'personalizar' && <div className="stack"><WidgetsSection /><CategoriesSection /><CustomFieldsSection /><TemplatesSection /><Card title="Más personalización"><div className="row wrap"><Link className="btn" to="/colecciones">Listas, seguimientos y tableros propios</Link><Link className="btn" to="/notas">Notas privadas</Link></div></Card></div>}
      {tab === 'datos' && <DataSection />}
      {tab === 'seguridad' && <SecuritySection />}
    </div>
  );
}
