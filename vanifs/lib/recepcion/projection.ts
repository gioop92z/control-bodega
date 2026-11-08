import { audit, recordPiece, type ManifestIndex, type ScanLog } from "./audit.ts";
import { codeKey, type Operation, type OperatorProgress, type ScanAcknowledgment, type TeamSummary } from "./model.ts";

export type Projection = { summary: TeamSummary; received: number[]; extras: number[]; boxCounts: [string, number][] };

export function emptyProjection(index: ManifestIndex): Projection {
  return {
    summary: { seq: 0, totals: { expected: index.expected, scanned: 0, matched: 0, missing: index.expected, extra: 0, unknown: 0, wrongBox: 0, manual: 0 }, processed: 0, people: [] },
    received: Array<number>(index.rows.length).fill(0), extras: Array<number>(index.rows.length).fill(0), boxCounts: [],
  };
}

function track(people: OperatorProgress[], { op, result }: ScanLog) {
  if (result === "Anulada") return;
  const at = op.recordedAt ?? op.at;
  let person = people.find(item => item.id === op.actor.id);
  if (!person) {
    person = { id: op.actor.id, name: op.actor.name, pieces: 0, boxes: [], first: at, last: at };
    people.push(person);
  }
  person.last = at;
  if (op.kind === "piece") person.pieces++;
  const box = codeKey(op.box);
  if (box && !person.boxes.includes(box)) person.boxes.push(box);
}

export function progressFromScans(scans: ScanLog[]) {
  const people: OperatorProgress[] = [];
  for (const scan of scans) track(people, scan);
  return people;
}

function latest({ op }: ScanLog) {
  return { at: op.recordedAt ?? op.at, userId: op.actor.id, name: op.actor.name, code: op.code };
}

export function rebuildProjection(index: ManifestIndex, ops: Operation[], seq: number): Projection {
  const result = audit(index, ops);
  const counts = [...index.boxes].map(([box, item]): [string, number] =>
    [box, item.lines.reduce((sum, line) => sum + result.received[line], 0)]).filter(([, qty]) => qty > 0);
  const last = result.scans.findLast(scan => scan.op.kind === "piece" && scan.result !== "Anulada");
  return {
    received: Array.from(result.received), extras: Array.from(result.extras), boxCounts: counts,
    summary: { seq, totals: result.totals, processed: counts.filter(([box, qty]) => qty === index.boxes.get(box)?.qty).length,
      people: progressFromScans(result.scans), ...(last ? { latest: latest(last) } : {}) },
  };
}

export function applyScans(index: ManifestIndex, state: Projection, ops: Operation[], seq: number) {
  const counts = new Map(state.boxCounts);
  const cursors = new Map<string, number>();
  state.summary.seq = seq;
  const acks = ops.map((op): ScanAcknowledgment => {
    const at = op.recordedAt ?? op.at;
    if (op.kind === "box") {
      track(state.summary.people, { op, result: "Caja activa" });
      return { id: op.id, at, result: "Caja activa", sku: op.box };
    }
    if (op.kind !== "piece") {
      if (op.kind === "issue") state.summary.totals.manual += op.qty;
      return { id: op.id, at, result: "Registrada" };
    }
    const scan = recordPiece(index, state.received, state.extras, state.summary.totals, op, cursors);
    track(state.summary.people, scan);
    state.summary.latest = latest(scan);
    const box = codeKey(op.box);
    if (scan.result === "Recibida" && box) {
      const qty = (counts.get(box) ?? 0) + 1;
      counts.set(box, qty);
      if (qty === index.boxes.get(box)?.qty) state.summary.processed++;
    }
    const sku = scan.line === undefined ? op.code : index.rows[scan.line].sku || op.code;
    return { id: op.id, at, result: scan.result, sku };
  });
  state.boxCounts = [...counts];
  return acks;
}
