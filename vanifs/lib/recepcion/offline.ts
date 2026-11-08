import type { Detail, ManifestRow, OperationBatch, OperationInput, Receipt } from "./model";

type Queued = { scope: string; op: OperationInput; order?: number };
let connection: Promise<IDBDatabase> | undefined;

function database() {
  connection ??= new Promise((resolve, reject) => {
    const open = indexedDB.open("vanifs-recepcion", 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      db.createObjectStore("manifest");
      db.createObjectStore("receipt");
      const batches = db.createObjectStore("batch", { keyPath: ["scope", "seq"] });
      batches.createIndex("scope", "scope");
      const queue = db.createObjectStore("queue", { keyPath: "order", autoIncrement: true });
      queue.createIndex("scope", "scope");
      queue.createIndex("id", "op.id", { unique: true });
    };
    open.onsuccess = () => {
      open.result.onversionchange = () => { open.result.close(); connection = undefined; };
      resolve(open.result);
    };
    open.onerror = () => { connection = undefined; reject(open.error); };
    open.onblocked = () => { connection = undefined; reject(new Error("Cierra las otras pestañas de VANIFS.")); };
  });
  return connection;
}

function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function complete(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}

export async function readCache(scope: string) {
  const db = await database();
  const tx = db.transaction(["manifest", "receipt", "batch", "queue"]);
  const [rows, receipt, batches, entries] = await Promise.all([
    result(tx.objectStore("manifest").get(scope)) as Promise<ManifestRow[] | undefined>,
    result(tx.objectStore("receipt").get(scope)) as Promise<Receipt | undefined>,
    result(tx.objectStore("batch").index("scope").getAll(scope)) as Promise<OperationBatch[]>,
    result(tx.objectStore("queue").index("scope").getAll(scope)) as Promise<Queued[]>,
  ]);
  const detail = receipt && rows ? { receipt, rows, batches: batches.map(({ seq, ops }) => ({ seq, ops })) } satisfies Detail : null;
  return { detail, pending: entries.map(entry => entry.op) };
}

export async function saveReading(scope: string, op: OperationInput) {
  const db = await database();
  const tx = db.transaction("queue", "readwrite");
  tx.objectStore("queue").add({ scope, op });
  await complete(tx);
}

export async function saveServer(scope: string, receipt: Receipt, batches: OperationBatch[], rows?: ManifestRow[], confirmed: string[] = []) {
  const db = await database();
  const tx = db.transaction(["manifest", "receipt", "batch", "queue"], "readwrite");
  const manifest = tx.objectStore("manifest");
  const receipts = tx.objectStore("receipt");
  const committed = tx.objectStore("batch");
  const queue = tx.objectStore("queue");
  if (rows) manifest.put(rows, scope);
  const read = receipts.get(scope);
  read.onsuccess = () => {
    const prior = read.result as Receipt | undefined;
    if (!prior || receipt.revision > prior.revision || (receipt.revision === prior.revision && Date.parse(receipt.updatedAt ?? receipt.createdAt) >= Date.parse(prior.updatedAt ?? prior.createdAt))) {
      receipts.put(receipt, scope);
    }
  };
  for (const batch of batches) committed.put({ ...batch, scope });
  for (const id of new Set([...confirmed, ...batches.flatMap(batch => batch.ops.map(op => op.id))])) {
    const lookup = queue.index("id").get(id);
    lookup.onsuccess = () => {
      const item = lookup.result as Queued | undefined;
      if (item?.scope === scope && item.order !== undefined) queue.delete(item.order);
    };
  }
  await complete(tx);
}
