// Assigning a location is independent of stock movements. Never update an
// existing pair: its counted quantity may have changed on another device.
export class LocationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function normalizeMarbete(value) {
  const code = String(value ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!code || code.length > 120 || /[\x00-\x1F\x7F]/.test(code)) {
    throw new LocationError('INVALID_CODE', 'Escanea o escribe un marbete válido.');
  }
  return code;
}

function singlePayload(values) {
  const candidates = [...new Set(values)];
  if (candidates.length > 1) throw new LocationError('INVALID_CODE', 'El QR contiene varios códigos de marbete.');
  return candidates[0];
}

// Interpret the payload of either a printed 1-D barcode or the QR on a
// location sticker. Never fetch a QR's URL or execute its contents.
// Product SKU/UPC scanning stays separate from this location-only parser.
export function parseMarbeteScan(value, {allowCatalogCode=false}={}) {
  const raw = String(value ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!raw || raw.length > 2048 || /[\x00-\x1F\x7F]/.test(raw)) {
    throw new LocationError('INVALID_CODE', 'QR o marbete vacío o no válido.');
  }
  const isUrl = /^https?:\/\//i.test(raw);
  let payload = raw;
  let hasLocationPayload = !isUrl;
  if (isUrl) {
    let url;
    try { url = new URL(raw); } catch {
      throw new LocationError('INVALID_CODE', 'El QR contiene una dirección no válida.');
    }
    const keys = ['marbete','marbete_codigo','codigo','code','ubicacion','location','id'];
    const params = keys.flatMap(key => url.searchParams.getAll(key)).filter(Boolean);
    hasLocationPayload = params.length > 0;
    // Only consider the last path component as a label when no explicit
    // query parameter exists; don't accidentally capture a random URL.
    payload = singlePayload(params) || decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) || '');
  } else if (raw.startsWith('{')) {
    let data;
    try { data = JSON.parse(raw); } catch {
      throw new LocationError('INVALID_CODE', 'El QR contiene datos no válidos.');
    }
    if (!data || Array.isArray(data) || typeof data !== 'object') {
      throw new LocationError('INVALID_CODE', 'El QR no tiene un código de marbete.');
    }
    payload = singlePayload(['marbete','marbete_codigo','codigo','code','ubicacion','location']
      .map(key => data[key]).filter(x => typeof x === 'string' && x.trim())) || '';
  }
  // Portable readers can send ZAP*402*002 or ZAP'405'085 for a printed label.
  const text = String(payload).trim().toUpperCase().replace(/´/g, "'").normalize('NFKC').replace(/\*+$/, '');
  const zap = text.replace(/['‘’]/g, '*').replace(/^\*+(?=ZAP[\s*:/.-])/, '');
  const exact = zap.match(/^ZAP[-\s*:/\.]+(402|405|459)[-\s*:/\.]+(\d{3,4})$/);
  if (exact) return 'ZAP-' + exact[1] + '-' + exact[2];
  const numbered = text.match(/^(402|405|459)[-\s]+(\d{3,4})$/);
  if (numbered) return 'ZAP-' + numbered[1] + '-' + numbered[2];
  // QR generators can embed visible labels such as
  // "SECCIÓN 402 · CAJÓN 001 · MARBETE: ZAP-402-001".
  const embedded = singlePayload([...zap.matchAll(/(?:^|[^A-Z0-9_-])ZAP[-\s*:/\.]+(402|405|459)[-\s*:/\.]+(\d{3,4})(?=$|[^A-Z0-9_-])/g)]
    .map(match => 'ZAP-' + match[1] + '-' + match[2]));
  if (embedded) return embedded;
  // Continuous receiving validates these literal codes against the catalog.
  const literal = String(payload).trim();
  if (allowCatalogCode && hasLocationPayload && /^(?=.*[A-Z0-9])(?!\d+$)[A-Z0-9_-]{1,120}$/i.test(literal)) return literal;
  // Backwards compatibility for non-ZAP locations using a direct,
  // unambiguous barcode. Do not register untrusted prose or a URL.
  if (!isUrl && /^(?=.*[-_])[A-Z0-9_-]{3,120}$/.test(text)) return text;
  throw new LocationError('INVALID_CODE', 'El QR no contiene un marbete reconocible.');
}

export async function locationQuery(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const result = await query.abortSignal(controller.signal);
    if (result.error) throw result.error;
    return result.data;
  } finally { clearTimeout(timer); }
}

export async function getMarbete(sb, rawCode, deptId) {
  const code = normalizeMarbete(rawCode);
  const row = await locationQuery(sb.from('marbetes')
    .select('codigo,zona,descripcion,departamento_id,activo')
    .eq('codigo', code).maybeSingle());
  if (!row) throw new LocationError('NOT_REGISTERED', 'Este marbete no está registrado.');
  if (row.departamento_id !== deptId) {
    throw new LocationError('WRONG_DEPARTMENT', 'Ese marbete pertenece a otro departamento. Escanea uno del departamento actual.');
  }
  if (!row.activo) throw new LocationError('INACTIVE', 'Este marbete está inactivo. Pide al administrador que lo revise.');
  return row;
}

export async function readAssignment(sb, sku, marbeteCode) {
  return locationQuery(sb.from('producto_marbetes')
    .select('sku,marbete_codigo,cantidad')
    .eq('sku', sku).eq('marbete_codigo', marbeteCode).maybeSingle());
}

export async function assignProductLocation(sb, {productId, sku, deptId, marbeteCode}) {
  if (!productId || !sku || !deptId) throw new LocationError('INVALID_PRODUCT', 'Vuelve a buscar el artículo antes de asignarle una ubicación.');
  const code = normalizeMarbete(marbeteCode);
  const [product, marbete] = await Promise.all([
    locationQuery(sb.from('productos').select('id,sku,departamento_id,activo')
      .eq('id', productId).eq('departamento_id', deptId).eq('activo', true).maybeSingle()),
    getMarbete(sb, code, deptId)
  ]);
  if (!product || product.sku !== sku) {
    throw new LocationError('INVALID_PRODUCT', 'El artículo ya no está disponible en este departamento. Vuelve a buscarlo.');
  }
  const existing = await readAssignment(sb, sku, code);
  if (existing) return {assignment: existing, marbete, alreadyAssigned: true};

  let writeError;
  try {
    await locationQuery(sb.from('producto_marbetes').upsert({
      sku, marbete_codigo: code, cantidad: null, updated_at: new Date().toISOString()
    }, {onConflict: 'sku,marbete_codigo', ignoreDuplicates: true}));
  } catch (error) { writeError = error; }

  // A lost response does not mean the insert failed. Read before any retry;
  // the database's unique pair also makes a repeated request safe.
  let assignment;
  try { assignment = await readAssignment(sb, sku, code); }
  catch {
    throw new LocationError('UNCONFIRMED', 'No pude confirmar el guardado. Revisa tu conexión y vuelve a intentar; la asignación no se duplicará.');
  }
  if (assignment) return {assignment, marbete, alreadyAssigned: false};
  if (writeError) throw writeError;
  throw new LocationError('UNCONFIRMED', 'La ubicación no se guardó. Revisa tu acceso y vuelve a intentar.');
}

export async function registerMarbete(sb, {code: rawCode, deptId, zona}) {
  const code = normalizeMarbete(rawCode);
  if (!deptId || !['BODEGA', 'PISO'].includes(zona)) throw new LocationError('INVALID_ZONE', 'Selecciona BODEGA o PISO.');
  // INSERT only: never move, reactivate or overwrite an existing label.
  let writeError;
  try {
    await locationQuery(sb.from('marbetes').insert({
      codigo: code, departamento_id: deptId, zona, activo: true,
      descripcion: null, updated_at: new Date().toISOString()
    }));
  } catch (error) { writeError = error; }
  try { return await getMarbete(sb, code, deptId); }
  catch (error) {
    if (error.code === 'NOT_REGISTERED' && writeError) throw writeError;
    throw error;
  }
}
