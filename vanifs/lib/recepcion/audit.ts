import { codeKey, type ManifestRow, type Operation, type Totals, type Verification } from "./model.ts";

export type ManifestIndex = ReturnType<typeof indexManifest>;
export type ScanResult = "Recibida" | "Sobrante" | "Fuera de manifiesto" | "Otra caja" | "Caja activa" | "Anulada";
type ScanOp = Extract<Operation, { code: string; source: string }>;
export type ScanLog = { op: ScanOp; result: ScanResult; line?: number; description?: string };

export function indexManifest(rows: ManifestRow[]) {
  const boxes = new Map<string, { label: string; lines: number[]; qty: number }>();
  const codes = new Map<string, number[]>();
  const codesByBox = new Map<string, number[]>();
  let expected = 0;
  let hasLooseRows = false;
  rows.forEach((row, line) => {
    expected += row.qty;
    const box = codeKey(row.box);
    if (box) {
      if (!boxes.has(box)) boxes.set(box, { label: row.box, lines: [], qty: 0 });
      boxes.get(box)!.lines.push(line);
      boxes.get(box)!.qty += row.qty;
    } else {
      hasLooseRows = true;
    }
    for (const code of new Set([codeKey(row.sku), codeKey(row.upc)])) {
      if (!code) continue;
      if (!codes.has(code)) codes.set(code, []);
      codes.get(code)!.push(line);
      const slot = scanKey(code, box);
      if (!codesByBox.has(slot)) codesByBox.set(slot, []);
      codesByBox.get(slot)!.push(line);
    }
  });
  return { rows, boxes, codes, codesByBox, expected, hasLooseRows };
}

function scanKey(code: string, box: string) {
  return codeKey(code) + "\u0000" + codeKey(box);
}

export function candidates(index: ManifestIndex, code: string, box: string) {
  const key = scanKey(code, box);
  return { matches: index.codes.get(codeKey(code)) ?? [], inBox: index.codesByBox.get(key) ?? [], key };
}

export function checkPiece(index: ManifestIndex, code: string, box: string) {
  const { matches, inBox } = candidates(index, code, box);
  if (!box && index.boxes.size > 0 && !inBox.length && (matches.length || !index.hasLooseRows)) {
    return "Escanea o selecciona primero el contenedor.";
  }
  const products = new Set(inBox.map(line => {
    const row = index.rows[line];
    return codeKey(row.sku) + "\u0000" + codeKey(row.upc);
  }));
  if (products.size > 1) return "Ese código coincide con varios artículos de la caja. Usa el UPC de la etiqueta.";
  return "";
}

type VerificationRecord = { status: Verification; note: string; at: string; by: string };

export function audit(index: ManifestIndex, operations: Operation[]) {
  const received = new Int32Array(index.rows.length);
  const extras = new Int32Array(index.rows.length);
  const scans: ScanLog[] = [];
  const issues: Extract<Operation, { kind: "issue" }>[] = [];
  const verification = new Map<number, VerificationRecord>();
  const originals = new Map<string, Operation>();
  const cursors = new Map<string, number>();
  const undone = new Set<string>();
  const totals: Totals = {
    expected: index.expected, scanned: 0, matched: 0, missing: 0, extra: 0,
    unknown: 0, wrongBox: 0, manual: 0,
  };

  for (const op of operations) {
    if (originals.has(op.id)) continue;
    if (op.kind === "undo") {
      const target = originals.get(op.target);
      if (target?.kind === "piece" && (op.authorizedUndo || target.actor.id === op.actor.id)) undone.add(op.target);
    }
    originals.set(op.id, op);
  }

  for (const op of originals.values()) {
    if (op.kind === "box") {
      scans.push({ op, result: "Caja activa" });
      continue;
    }
    if (op.kind === "issue") {
      issues.push(op);
      totals.manual += op.qty;
      continue;
    }
    if (op.kind === "verify") {
      const previous = verification.get(op.line)?.status;
      const allowed = op.status === "Confirmado"
        ? !previous
        : op.status === "Reportado a SEPRO" ? previous === "Confirmado" : previous === "Reportado a SEPRO";
      if (allowed) verification.set(op.line, { status: op.status, note: op.note, at: op.at, by: op.actor.name });
      continue;
    }
    if (op.kind !== "piece") continue;
    if (undone.has(op.id)) {
      scans.push({ op, result: "Anulada" });
      continue;
    }
    scans.push(recordPiece(index, received, extras, totals, op, cursors));
  }
  totals.missing = totals.expected - totals.matched;
  return { received, extras, scans, issues, verification, totals, undone };
}
export function recordPiece(index: ManifestIndex, received: Int32Array | number[], extras: Int32Array | number[],
  totals: Totals, op: ScanOp, cursors: Map<string, number>): ScanLog {
  totals.scanned++;
  const { matches, inBox, key } = candidates(index, op.code, op.box);
  if (inBox.length) {
    let cursor = cursors.get(key) ?? 0;
    while (cursor < inBox.length && received[inBox[cursor]] >= index.rows[inBox[cursor]].qty) cursor++;
    cursors.set(key, cursor);
    const open = inBox[cursor];
    const line = open ?? inBox[inBox.length - 1];
    const description = index.rows[line].description;
    if (open !== undefined) {
      received[line]++;
      totals.matched++;
      totals.missing = totals.expected - totals.matched;
      return { op, result: "Recibida", line, description };
    }
    extras[line]++;
    totals.extra++;
    return { op, result: "Sobrante", line, description };
  }
  if (matches.length) {
    totals.wrongBox++;
    return { op, result: "Otra caja", description: index.rows[matches[0]].description };
  }
  totals.unknown++;
  return { op, result: "Fuera de manifiesto" };
}
export type Audit = ReturnType<typeof audit>;

export function summarizeProducts(rows: ManifestRow[], result: Audit) {
  const products = new Map<string, { sku: string; upc: string; description: string; expected: number; received: number; missing: number; extra: number }>();
  rows.forEach((row, i) => {
    const key = codeKey(row.sku || row.upc);
    let group = products.get(key);
    if (!group) {
      group = { sku: row.sku, upc: row.upc, description: row.description, expected: 0, received: 0, missing: 0, extra: 0 };
      products.set(key, group);
    }
    group.expected += row.qty;
    group.received += result.received[i];
    group.missing += row.qty - result.received[i];
    group.extra += result.extras[i];
  });
  return [...products.values()];
}

export function actualBoxesForCode(index: ManifestIndex, code: string) {
  return [...new Set((index.codes.get(codeKey(code)) ?? []).map(line => index.rows[line].box || "Sin caja"))].join(", ");
}
