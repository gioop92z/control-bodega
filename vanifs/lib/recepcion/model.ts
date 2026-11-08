export const HEADERS = [
  "PISO", "FECHA", "SECC", "MANIFIESTO", "CONTENEDOR", "DESCRIPCION",
  "SKU", "CANT", "PRECIO", "PROVEEDOR", "UPC", "MARCA",
] as const;

export const MAX_LINES = 12000;
export const BATCH_LIMIT = 100;
export const ISSUE_TYPES = [
  "Daño", "Etiqueta ilegible", "Pendiente de proveedor", "Distribución incorrecta", "Otro",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];
export type ScanSource = "Lector" | "Cámara" | "Manual";
export type Verification = "Confirmado" | "Reportado a SEPRO" | "Resuelto";

export type ManifestRow = {
  floor: string;
  date: string;
  section: string;
  manifest: string;
  box: string;
  description: string;
  sku: string;
  qty: number;
  price: string;
  supplier: string;
  upc: string;
  brand: string;
};

export type Actor = { id: string; name: string };
export type Role = "admin" | "supervisor" | "collaborator";
export type TeamActor = Actor & { email: string; role: Role; canClose: boolean; platformOwner?: true };
export type Device = { id: string; label: string };
export type ScanAcknowledgment = { id: string; at: string; result: string; sku?: string };
export type TeamActivity = { id: string; at: string; userId: string; name: string; action: string; detail: string; device: string };
export type OperatorProgress = { id: string; name: string; pieces: number; boxes: string[]; first: string; last: string };
export type TeamSummary = {
  seq: number; totals: Totals; processed: number; people: OperatorProgress[];
  latest?: { at: string; userId: string; name: string; code?: string };
};
export type TeamLive = TeamSummary & {
  presence: { id: string; name: string; device: string; seenAt: number; pending: number }[];
  leases: { box: string; userId: string; name: string }[];
};
type OperationBase = { id: string; at: string; captureDevice?: string };
export type OperationInput = OperationBase & (
  | { kind: "box" | "piece"; code: string; box: string; source: ScanSource }
  | { kind: "undo"; target: string }
  | { kind: "issue"; type: IssueType; code: string; box: string; note: string; qty: number }
  | { kind: "verify"; line: number; status: Verification; note: string }
);
export type Operation = OperationInput & { actor: Actor; recordedAt?: string; device?: string; deviceId?: string; scanResult?: string; registeredSku?: string; authorizedUndo?: boolean };
export type OperationBatch = { seq: number; ops: Operation[] };

export type Totals = {
  expected: number;
  scanned: number;
  matched: number;
  missing: number;
  extra: number;
  unknown: number;
  wrongBox: number;
  manual: number;
};

export type Receipt = {
  id: string;
  title: string;
  file: string;
  createdAt: string;
  createdBy: string;
  closedAt: string | null;
  closedBy: string | null;
  note: string;
  expected: number;
  lineCount: number;
  boxCount: number;
  manifestCount: number;
  revision: number;
  totals: Totals | null;
  canceled?: boolean;
  archived?: boolean;
  date?: string;
  updatedAt?: string;
  live?: TeamLive;
  pausedAt?: string | null;
};

export type Detail = { receipt: Receipt; rows: ManifestRow[]; batches: OperationBatch[]; live?: TeamLive; viewerRole?: Role };
export type Delta = { receipt: Receipt; batches: OperationBatch[]; live?: TeamLive; viewerRole?: Role; acks?: ScanAcknowledgment[] };
export type History = { receipts: Receipt[]; next: string | null };

export function codeKey(value: string) {
  return value.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "").toUpperCase();
}

export function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export function newOperation() {
  return { id: newId(), at: new Date().toISOString() };
}

export function originalCells(row: ManifestRow) {
  return [
    row.floor, row.date, row.section, row.manifest, row.box, row.description,
    row.sku, row.qty, row.price, row.supplier, row.upc, row.brand,
  ];
}

export function incidentCount(totals: Totals) {
  return totals.missing + totals.extra + totals.unknown + totals.wrongBox + totals.manual;
}
