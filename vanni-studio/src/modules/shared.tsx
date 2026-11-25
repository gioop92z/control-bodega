import { useMemo, useState } from 'react';
import { Film, ImageOff, Layers } from 'lucide-react';
import { useTable } from '../lib/store';
import { Sheet } from '../components/Sheet';
import { Select } from '../components/ui';
import { useToast } from '../components/toast';
import { followerSeries } from '../lib/analytics';
import type { IgMedia, Template } from '../lib/types';

/** Opciones de categoría: predeterminadas + personalizadas por el usuario (Ajustes → Categorías). */
export function useCategoryOptions(scope: string, builtin: Array<{ key: string; label: string; color?: string }>) {
  const cats = useTable('categories').rows.filter((c) => c.scope === scope).sort((a, b) => a.sort - b.sort);
  return useMemo(() => [
    ...builtin.map((b) => ({ value: b.key, label: b.label, color: b.color })),
    ...cats.filter((c) => !builtin.some((b) => b.key === c.name)).map((c) => ({ value: c.name, label: c.name, color: c.color ?? undefined })),
  ], [cats, builtin]);
}

/** Datos de Instagram ya cargados y derivados que comparten varias pantallas. */
export function useIgData() {
  const accounts = useTable('ig_accounts');
  const snapshots = useTable('ig_profile_snapshots');
  const insights = useTable('ig_account_insights');
  const media = useTable('ig_media');
  const links = useTable('media_links');
  const account = accounts.rows[0] ?? null;
  const series = useMemo(() => followerSeries(snapshots.rows), [snapshots.rows]);
  return {
    account, connected: account?.status === 'connected', snapshots: snapshots.rows, insights: insights.rows, media: media.rows, links: links.rows,
    followers: series, ready: accounts.ready && snapshots.ready && insights.ready && media.ready,
    reloadAll: () => Promise.all([accounts.reload(), snapshots.reload(), insights.reload(), media.reload()]),
  };
}

export function MediaThumb({ m, size = 48 }: { m: IgMedia; size?: number }) {
  const [broken, setBroken] = useState(false);
  const src = m.thumbnail_url || (m.media_type !== 'VIDEO' ? m.media_url : null);
  if (!src || broken) return <div className="thumb" style={{ width: size, height: size, display: 'grid', placeItems: 'center' }}>{m.media_product_type === 'REELS' ? <Film size={18} color="var(--text-3)" /> : <ImageOff size={18} color="var(--text-3)" />}</div>;
  return <img className="thumb" style={{ width: size, height: size }} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}

/** Vincula una publicación real con una serie y, opcionalmente, con un episodio. */
export function LinkMediaSheet({ media, open, onClose }: { media: IgMedia | null; open: boolean; onClose: () => void }) {
  const links = useTable('media_links');
  const series = useTable('series').rows.sort((a, b) => a.sort - b.sort);
  const episodes = useTable('episodes').rows;
  const toast = useToast();
  const current = media ? links.rows.find((l) => l.ig_media_id === media.ig_media_id) : undefined;
  const [seriesId, setSeriesId] = useState<string>('');
  const [episodeId, setEpisodeId] = useState<string>('');
  const sid = seriesId || current?.series_id || (current?.episode_id ? episodes.find((e) => e.id === current.episode_id)?.series_id ?? '' : '');
  const eid = episodeId || current?.episode_id || '';
  if (!media) return null;
  const save = () => {
    if (!sid && !eid) { toast('Elige una serie o un episodio', 'error'); return; }
    const data = { ig_media_id: media.ig_media_id, series_id: sid || null, episode_id: eid || null };
    if (current) links.update(current.id, data); else links.insert(data);
    toast('Publicación vinculada', 'success');
    setSeriesId(''); setEpisodeId('');
    onClose();
  };
  const unlink = () => { if (current) links.remove(current.id); setSeriesId(''); setEpisodeId(''); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title="Vincular publicación" footer={<>{current && <button className="btn danger" type="button" onClick={unlink}>Desvincular</button>}<button className="btn primary" type="button" onClick={save}>Guardar vínculo</button></>}>
      <div className="stack">
        <div className="row"><MediaThumb m={media} size={64} /><p className="small muted clamp-2" style={{ margin: 0 }}>{media.caption || 'Sin texto'}</p></div>
        <Select label="Serie" value={sid} placeholder="— Sin serie —" onChange={(v) => { setSeriesId(v); setEpisodeId(''); }} options={series.map((s) => ({ value: s.id, label: s.title }))} />
        <Select label="Episodio (opcional)" value={eid} placeholder="— Sin episodio —" onChange={setEpisodeId}
          options={episodes.filter((e) => !sid || e.series_id === sid).map((e) => ({ value: e.id, label: `${e.number ? `#${e.number} · ` : ''}${e.title || 'Sin título'}` }))} />
        <p className="xs faint" style={{ margin: 0 }}><Layers size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> Las métricas de la serie se calculan sumando sus publicaciones vinculadas.</p>
      </div>
    </Sheet>
  );
}

/** Menú para crear desde una plantilla reutilizable o guardar la actual como plantilla. */
export function TemplateMenu({ target, onApply, current, label = 'Plantillas' }: { target: string; onApply: (data: Record<string, unknown>) => void; current?: () => Record<string, unknown>; label?: string }) {
  const t = useTable('templates');
  const toast = useToast();
  const list = t.rows.filter((x) => x.target === target);
  const [open, setOpen] = useState(false);
  const saveCurrent = () => {
    if (!current) return;
    const name = window.prompt('Nombre de la plantilla');
    if (!name) return;
    const data = current();
    delete data.id; delete data.user_id; delete data.created_at; delete data.updated_at;
    t.insert({ target, name, data, sort: list.length } as Partial<Template>);
    toast('Plantilla guardada', 'success');
  };
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>{label}</button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <div className="stack">
          {current && <button type="button" className="btn" onClick={saveCurrent}>Guardar el actual como plantilla</button>}
          {list.length ? (
            <div className="list">
              {list.map((x) => (
                <div key={x.id} className="list-item">
                  <button type="button" className="grow btn ghost" style={{ justifyContent: 'flex-start' }} onClick={() => { onApply({ ...x.data }); setOpen(false); }}>{x.name}</button>
                  <button type="button" className="btn sm ghost" onClick={() => t.remove(x.id)}>Eliminar</button>
                </div>
              ))}
            </div>
          ) : <p className="muted small">Aún no tienes plantillas para esta sección.</p>}
        </div>
      </Sheet>
    </>
  );
}

export function useEpisodeSeriesMap() {
  const episodes = useTable('episodes').rows;
  return useMemo(() => new Map(episodes.map((e) => [e.id, e.series_id])), [episodes]);
}
