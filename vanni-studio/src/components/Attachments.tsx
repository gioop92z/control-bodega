import { useRef, useState } from 'react';
import { ExternalLink, ImagePlus, Link2, Trash2 } from 'lucide-react';
import { useTable } from '../lib/store';
import { removeFile, uploadFile, useSignedUrl } from '../lib/storage';
import { useAuth } from '../lib/auth';
import { useToast, confirmAction } from './toast';
import type { Attachment } from '../lib/types';

function Thumb({ a, onDelete }: { a: Attachment; onDelete: () => void }) {
  const url = useSignedUrl(a.storage_path);
  const isVideo = a.mime?.startsWith('video/');
  const isPdf = a.mime === 'application/pdf';
  return (
    <div className="gallery-item">
      {a.external_url ? (
        <a href={a.external_url} target="_blank" rel="noreferrer" className="upload-tile" style={{ border: 0, height: '100%' }}><Link2 size={18} /><span className="clamp-2">{a.caption || a.external_url}</span></a>
      ) : url ? (
        isVideo ? <video src={url} muted playsInline controls preload="metadata" /> : isPdf ? <a className="upload-tile" style={{ border: 0, height: '100%' }} href={url} target="_blank" rel="noreferrer">PDF</a> : <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={a.caption ?? 'Archivo adjunto'} loading="lazy" /></a>
      ) : <div className="upload-tile" style={{ border: 0, height: '100%' }}>…</div>}
      {a.caption && !a.external_url && <div className="cap truncate">{a.caption}</div>}
      <div className="gallery-actions">
        {a.external_url && <a href={a.external_url} target="_blank" rel="noreferrer" aria-label="Abrir referencia"><ExternalLink size={14} /></a>}
        <button type="button" aria-label="Eliminar" onClick={onDelete}><Trash2 size={14} /></button>
      </div>
    </div>
  );
}

/** Fotos, videos, documentos y enlaces de referencia de cualquier elemento. */
export function Attachments({ entityType, entityId, kind = 'photo', accept = 'image/*,video/*', title = 'Archivos', allowLinks = true }: { entityType: string; entityId: string; kind?: string; accept?: string; title?: string; allowLinks?: boolean }) {
  const { user } = useAuth();
  const t = useTable('attachments');
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const items = t.rows.filter((a) => a.entity_type === entityType && a.entity_id === entityId && a.kind === kind).sort((a, b) => a.sort - b.sort || (a.created_at ?? '').localeCompare(b.created_at ?? ''));

  const onFiles = async (files: FileList | null) => {
    if (!files || !user) return;
    for (const file of Array.from(files)) {
      setBusy((b) => b + 1);
      try {
        const up = await uploadFile(user.id, `${entityType}/${entityId}`, file);
        t.insert({ entity_type: entityType, entity_id: entityId, kind, storage_path: up.path, mime: up.mime, size_bytes: up.size, sort: items.length, caption: null });
      } catch (e) {
        toast((e as Error).message, 'error');
      } finally {
        setBusy((b) => b - 1);
      }
    }
    if (input.current) input.current.value = '';
  };
  const addLink = () => {
    const url = window.prompt('Pega el enlace de referencia (Instagram, TikTok, YouTube, Pinterest…)');
    if (!url) return;
    if (!/^https?:\/\//i.test(url.trim())) { toast('El enlace debe empezar con https://', 'error'); return; }
    const caption = window.prompt('Nota breve (opcional)') ?? '';
    t.insert({ entity_type: entityType, entity_id: entityId, kind, external_url: url.trim(), caption: caption || null, sort: items.length });
  };
  const del = async (a: Attachment) => {
    if (!confirmAction('¿Eliminar este archivo?')) return;
    t.remove(a.id);
    if (a.storage_path) await removeFile(a.storage_path).catch(() => {});
  };

  return (
    <div className="stack">
      <div className="row between"><span className="field-label">{title}</span>{busy > 0 && <span className="xs faint">Subiendo {busy}…</span>}</div>
      <div className="gallery">
        {items.map((a) => <Thumb key={a.id} a={a} onDelete={() => void del(a)} />)}
        <button type="button" className="upload-tile" onClick={() => input.current?.click()}><span><ImagePlus size={20} style={{ margin: '0 auto 4px' }} />Subir</span></button>
        {allowLinks && <button type="button" className="upload-tile" onClick={addLink}><span><Link2 size={20} style={{ margin: '0 auto 4px' }} />Enlace</span></button>}
      </div>
      <input ref={input} type="file" accept={accept} multiple hidden onChange={(e) => void onFiles(e.target.files)} />
    </div>
  );
}

/** Imagen de portada guardada en una columna `cover_path`. */
export function CoverPicker({ path, onChange, folder, poster }: { path: string | null | undefined; onChange: (p: string | null) => void; folder: string; poster?: boolean }) {
  const { user } = useAuth();
  const url = useSignedUrl(path);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f || !user) return;
    setBusy(true);
    try {
      const up = await uploadFile(user.id, folder, f);
      const old = path;
      onChange(up.path);
      if (old) void removeFile(old).catch(() => {});
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="stack tight">
      {url ? <img className={`cover ${poster ? 'poster' : ''}`} src={url} alt="Portada" /> : <div className={`cover ${poster ? 'poster' : ''}`} style={{ display: 'grid', placeItems: 'center' }}><span className="faint small">Sin portada</span></div>}
      <div className="row">
        <button type="button" className="btn sm" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={15} />{busy ? 'Subiendo…' : path ? 'Cambiar portada' : 'Agregar portada'}</button>
        {path && <button type="button" className="btn sm ghost" onClick={() => { const old = path; onChange(null); void removeFile(old).catch(() => {}); }}>Quitar</button>}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}

export function StorageImage({ path, alt, className, style }: { path: string | null | undefined; alt: string; className?: string; style?: React.CSSProperties }) {
  const url = useSignedUrl(path);
  if (!url) return <div className={className} style={{ background: 'var(--surface-4)', ...style }} aria-hidden />;
  return <img src={url} alt={alt} className={className} style={style} loading="lazy" />;
}
