// Archivos privados (Storage): compresión de fotos en el dispositivo y URLs firmadas temporales.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { uuid } from './ids';

export const MEDIA_BUCKET = 'vanni-media';
const MAX_BYTES = 50 * 1024 * 1024;

async function compressImage(file: File, maxSide = 2048, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024 && file.type === 'image/jpeg') return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // Safari antiguo o formato no decodificable: se sube el original
  }
}

export interface Uploaded { path: string; mime: string; size: number }

export async function uploadFile(userId: string, folder: string, file: File): Promise<Uploaded> {
  const blob = await compressImage(file);
  if (blob.size > MAX_BYTES) throw new Error('El archivo supera 50 MB, el máximo del plan gratuito. Comprime el video antes de subirlo.');
  const isJpeg = blob !== file || file.type === 'image/jpeg';
  const ext = isJpeg ? 'jpg' : (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const mime = blob !== file ? 'image/jpeg' : file.type || 'application/octet-stream';
  const path = `${userId}/${folder}/${uuid()}.${ext}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: mime, upsert: false, cacheControl: '31536000' });
  if (error) throw new Error(`No se pudo subir el archivo: ${error.message}`);
  return { path, mime, size: blob.size };
}

export async function removeFile(path: string) {
  await supabase.storage.from(MEDIA_BUCKET).remove([path]);
}

const urlCache = new Map<string, { url: string; exp: number }>();
const pending = new Map<string, Promise<string | null>>();

export async function signedUrl(path: string): Promise<string | null> {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now() + 60_000) return hit.url;
  const inflight = pending.get(path);
  if (inflight) return inflight;
  const p = (async () => {
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600);
    pending.delete(path);
    if (error || !data) return null;
    urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 3600_000 });
    return data.signedUrl;
  })();
  pending.set(path, p);
  return p;
}

export function useSignedUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (path ? urlCache.get(path)?.url ?? null : null));
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(null); return; }
    void signedUrl(path).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [path]);
  return url;
}
