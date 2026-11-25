// Cifrado AES-256-GCM (Web Crypto) para tokens de Instagram y el App Secret de Meta.
// Compatible con Deno (Edge Functions) y Node 20+ (pruebas).

const enc = new TextEncoder();
const dec = new TextDecoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(byteLength = 32): string {
  const b = new Uint8Array(byteLength);
  crypto.getRandomValues(b);
  return bytesToBase64Url(b);
}

/** Código legible para humanos (sin caracteres ambiguos), p. ej. «K7QM-2XRA-…». */
export function humanCode(groups = 4, size = 4): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const b = new Uint8Array(groups * size);
  crypto.getRandomValues(b);
  const chars = Array.from(b, (x) => alphabet[x % alphabet.length]);
  const parts: string[] = [];
  for (let g = 0; g < groups; g++) parts.push(chars.slice(g * size, g * size + size).join(''));
  return parts.join('-');
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparación en tiempo constante de cadenas hexadecimales del mismo largo. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(base64Key: string): Promise<CryptoKey> {
  let p = keyCache.get(base64Key);
  if (!p) {
    const raw = base64ToBytes(base64Key);
    if (raw.length !== 32) throw new Error('La clave de cifrado debe tener 32 bytes (AES-256).');
    p = crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    keyCache.set(base64Key, p);
  }
  return p;
}

export interface Sealed {
  ciphertext: string;
  iv: string;
}

export async function seal(plaintext: string, base64Key: string): Promise<Sealed> {
  const key = await importKey(base64Key);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { ciphertext: bytesToBase64(new Uint8Array(ct)), iv: bytesToBase64(iv) };
}

export async function open(sealed: Sealed, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(sealed.iv) },
    key,
    base64ToBytes(sealed.ciphertext),
  );
  return dec.decode(pt);
}

/** Empaqueta un valor cifrado en una sola cadena «v1.iv.ciphertext» (para private.app_config). */
export async function sealToString(plaintext: string, base64Key: string): Promise<string> {
  const s = await seal(plaintext, base64Key);
  return `v1.${s.iv}.${s.ciphertext}`;
}

export async function openFromString(packed: string, base64Key: string): Promise<string> {
  const [v, iv, ciphertext] = packed.split('.');
  if (v !== 'v1' || !iv || !ciphertext) throw new Error('Formato cifrado desconocido');
  return open({ iv, ciphertext }, base64Key);
}
