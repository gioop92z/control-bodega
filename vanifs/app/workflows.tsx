"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, ClipboardList, Download, FileSpreadsheet, Share2, TriangleAlert, Upload } from "lucide-react";
import { chooseDriveFile, driveEnabled, prepareDrivePicker } from "../lib/recepcion/drive";
import { readImportFile } from "../lib/recepcion/files";
import { parseDelimited, parseManifest, type ImportPreview } from "../lib/recepcion/importer";
import { ISSUE_TYPES, incidentCount, newId, type IssueType, type ManifestRow, type Totals, type Verification } from "../lib/recepcion/model";
import { Dialog, number } from "./ui";

const getError = (error: unknown) => error instanceof Error ? error.message : "Intenta de nuevo.";

export function ImportDialog({ dismiss, onCreate, signedIn }: {
  dismiss: () => void;
  onCreate: (id: string, title: string, file: string, rows: ManifestRow[]) => Promise<void>;
  signedIn: boolean;
}) {
  const [method, setMethod] = useState<"file" | "paste" | "drive">("file");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState("");
  const [tables, setTables] = useState<Awaited<ReturnType<typeof readImportFile>>>([]);
  const [sheet, setSheet] = useState(0);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [driveReady, setDriveReady] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useRef("");

  function validate(rows: string[][]) {
    setError("");
    id.current = "";
    try { setPreview(parseManifest(rows)); }
    catch (e) { setError(getError(e)); setPreview(null); }
  }

  async function selectFile(picked?: File) {
    if (!picked || busy) return;
    setBusy(true);
    setPreview(null);
    setTables([]);
    setError("");
    setFile(picked.name);
    try {
      const opened = await readImportFile(picked);
      if (!opened.length) throw new Error("El libro no tiene hojas visibles.");
      setTables(opened);
      const candidate = opened.findIndex(item => {
        try { return Boolean(parseManifest(item.rows).rows.length); } catch { return false; }
      });
      const initial = candidate < 0 ? 0 : candidate;
      setSheet(initial);
      if (opened[initial].error) setError(opened[initial].error);
      else validate(opened[initial].rows);
      setTitle(picked.name.replace(/\.[^.]+$/, "").slice(0, 140));
    } catch (e) { setError(getError(e)); }
    finally { setBusy(false); }
  }

  function switchMethod(next: typeof method) {
    setMethod(next);
    setError("");
    setPreview(null);
    setTables([]);
    setFile("");
    setTitle("");
    id.current = "";
    if (next === "drive" && !driveReady) {
      setBusy(true);
      void prepareDrivePicker().then(() => setDriveReady(true)).catch(reason => setError(getError(reason))).finally(() => setBusy(false));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!signedIn || !preview?.rows.length || preview.invalid || busy) return;
    setBusy(true);
    setError("");
    id.current ||= newId();
    try {
      await onCreate(id.current, title.trim() || "Recepción " + new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Mexico_City" }).format(new Date()),
        (file || "Pegado desde Google Sheets").slice(0, 140), preview.rows);
    } catch (e) { setError(getError(e)); }
    finally { setBusy(false); }
  }

  const pieces = preview?.rows.reduce((sum, row) => sum + row.qty, 0) ?? 0;
  return <Dialog title="Nuevo manifiesto" intro="Revisa las cantidades y los contenedores antes de iniciar la jornada." onDismiss={() => { if (!busy) dismiss(); }} className="import-dialog">
    <form onSubmit={submit}>
      <div className="segmented method">
        <button type="button" aria-pressed={method === "file"} onClick={() => switchMethod("file")} disabled={busy}><Upload size={17} /> Subir archivo</button>
        <button type="button" aria-pressed={method === "paste"} onClick={() => switchMethod("paste")} disabled={busy}><ClipboardList size={17} /> Pegar desde Sheets</button>
        {driveEnabled && <button type="button" aria-pressed={method === "drive"} onClick={() => switchMethod("drive")} disabled={busy}><FileSpreadsheet size={17} /> Google Drive</button>}
      </div>
      {method !== "paste" ? <>
        {method === "file" ? <><input ref={input} type="file" className="sr-only" accept=".xlsx,.csv,.tsv,.txt" aria-label="Archivo del manifiesto"
          onChange={event => { void selectFile(event.target.files?.[0]); event.target.value = ""; }} />
        <button className="dropzone" type="button" onClick={() => input.current?.click()} disabled={busy}
          onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void selectFile(event.dataTransfer.files[0]); }}>
          <span><FileSpreadsheet size={22} /></span><strong>{file || "Seleccionar archivo"}</strong><small>Excel .xlsx, CSV o TSV · hasta 10 MB</small>
        </button></> : <button type="button" className="dropzone" disabled={busy} onClick={() => {
          if (!driveReady) { switchMethod("drive"); return; }
          setError("");
          setBusy(true);
          void chooseDriveFile().then(picked => { if (picked) return selectFile(picked); })
            .catch(reason => setError(getError(reason))).finally(() => setBusy(false));
        }}><span><FileSpreadsheet size={22} /></span><strong>{file || (driveReady ? "Elegir archivo o Google Sheets" : "Preparar Google Drive")}</strong><small>Se solicita acceso al archivo que elijas.</small></button>}
        {tables.length > 1 && <label className="field">Hoja del archivo
          <select value={sheet} onChange={event => {
            const selection = Number(event.target.value);
            setSheet(selection);
            if (tables[selection].error) { setError(tables[selection].error); setPreview(null); }
            else validate(tables[selection].rows);
          }}>{tables.map((item, i) => <option key={item.name} value={i}>{item.name}</option>)}</select>
        </label>}
      </> : <>
        <label className="field">Datos del manifiesto
          <textarea rows={5} value={text} onChange={event => { setText(event.target.value); setPreview(null); }} placeholder="Copia y pega las filas, incluyendo los encabezados de PEGAR_HOY." />
        </label>
        <button className="button secondary" type="button" disabled={!text.trim() || busy} onClick={() => {
          try { validate(parseDelimited(text)); } catch (e) { setError(getError(e)); setPreview(null); }
        }}>Validar datos</button>
      </>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {preview && <section className="import-result" aria-label="Resultado de validación">
        <div className={"import-result-title" + (preview.invalid ? " invalid" : "")}>{preview.invalid ? <TriangleAlert size={19} /> : <CheckCircle2 size={19} />}
          <strong>{preview.invalid ? number.format(preview.invalid) + " fila(s) por corregir" : "Manifiesto validado"}</strong>
          <span>{number.format(preview.rows.length)} renglones · {number.format(pieces)} piezas</span>
        </div>
        {preview.errors.length > 0 && <ul className="form-messages">{preview.errors.map(line => <li key={line}>{line}</li>)}</ul>}
        {preview.warnings.length > 0 && <ul className="form-messages">{preview.warnings.map(line => <li key={line}>{line}</li>)}</ul>}
        {preview.rows.length > 0 && <div className="mini-preview" tabIndex={0} role="region" aria-label="Primeros artículos">
          <table><thead><tr><th>SKU / UPC</th><th>Contenedor</th><th>Cant.</th></tr></thead><tbody>
            {preview.rows.slice(0, 4).map((row, i) => <tr key={i}><td>{row.sku || row.upc}</td><td>{row.box || "Sin caja"}</td><td>{row.qty}</td></tr>)}
          </tbody></table>
        </div>}
      </section>}
      <label className="field">Nombre de la jornada <span className="optional">Opcional</span>
        <input value={title} onChange={event => setTitle(event.target.value)} maxLength={140} placeholder="Ej. Recepción zapatería · turno de mañana" />
      </label>
      {!signedIn && <p className="notice">Inicia sesión para guardar un manifiesto. Puedes revisar el archivo aquí.</p>}
      <footer className="dialog-actions">
        <button className="button secondary" type="button" onClick={dismiss} disabled={busy}>Cancelar</button>
        <button className="button primary" type="submit" disabled={!signedIn || busy || !preview?.rows.length || Boolean(preview.invalid)}>
          {busy ? "Procesando…" : "Crear jornada"} <ArrowRight size={17} />
        </button>
      </footer>
    </form>
  </Dialog>;
}

export function CloseDialog({ totals, dismiss, onClose }: {
  totals: Totals; dismiss: () => void; onClose: (note: string, acknowledged: boolean) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const incidents = incidentCount(totals);
  return <Dialog title="Cerrar jornada" intro="El cierre guarda el resultado y bloquea el escaneo de esta jornada." onDismiss={() => { if (!busy) dismiss(); }}>
    <form onSubmit={async event => {
      event.preventDefault();
      setBusy(true);
      setError("");
      try { await onClose(note.trim(), acknowledged); } catch (e) { setError(getError(e)); } finally { setBusy(false); }
    }}>
      <div className={"notice " + (incidents ? "warn" : "success")}>
        {incidents ? <TriangleAlert size={20} /> : <CheckCircle2 size={20} />}
        <span><strong>{incidents ? "Cierre con incidencias" : "Completo 100%"}</strong><br />
          {number.format(totals.matched)} de {number.format(totals.expected)} piezas conciliadas
          {incidents ? " · " + number.format(totals.missing) + " faltantes · " + number.format(incidents - totals.missing) + " otras incidencias" : ""}
        </span>
      </div>
      {incidents > 0 && <label className="checkbox"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> Revisé el resumen y autorizo el cierre con incidencias.</label>}
      <label className="field">Observaciones de cierre {incidents === 0 && <span className="optional">Opcional</span>}
        <textarea rows={3} value={note} onChange={event => setNote(event.target.value)} maxLength={500} required={incidents > 0} />
      </label>
      {error && <p className="notice error" role="alert">{error}</p>}
      <footer className="dialog-actions">
        <button className="button secondary" type="button" onClick={dismiss} disabled={busy}>Volver a revisar</button>
        <button className="button primary" type="submit" disabled={busy || Boolean(incidents && !acknowledged)}>{busy ? "Guardando…" : "Confirmar cierre"}</button>
      </footer>
    </form>
  </Dialog>;
}

export type Spreadsheet = { file: File; url: string };

export function SpreadsheetNotice({ spreadsheet }: { spreadsheet: Spreadsheet }) {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const { file, url } = spreadsheet;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function"
    && navigator.canShare?.({ files: [file] });

  async function share() {
    setSharing(true);
    setError("");
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) {
        setError("Descarga el Excel para compartirlo desde tus archivos.");
      }
    } finally {
      setSharing(false);
    }
  }

  return <div className="notice success export-notice">
    <div className="spreadsheet-name" role="status"><strong>Excel listo para descargar</strong><p>{file.name}</p></div>
    <div className="spreadsheet-actions">
      <a className="button primary" href={url} download={file.name}><Download size={17} /> Descargar Excel</a>
      {canShare && <button className="button secondary" type="button" onClick={share} disabled={sharing}>
        <Share2 size={17} /> {sharing ? "Abriendo opciones…" : "Compartir archivo"}
      </button>}
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function ClosureReportDialog({ title, totals, spreadsheet, exporting, error, generate, dismiss }: {
  title: string; totals: Totals; spreadsheet: Spreadsheet | null; exporting: boolean;
  error: string; generate: () => void; dismiss: () => void;
}) {
  const incidents = incidentCount(totals);
  return <Dialog title="Jornada finalizada. ¿Deseas generar el reporte de recepción?" intro={title} onDismiss={dismiss}>
    <div className={"notice " + (incidents ? "warn" : "success")}>
      {incidents ? <TriangleAlert size={20} /> : <CheckCircle2 size={20} />}
      <div><strong>{incidents ? "Con incidencias" : "Completo 100%"}</strong>
        <p>{number.format(totals.matched)} de {number.format(totals.expected)} piezas conciliadas.</p>
      </div>
    </div>
    <p className="report-explainer">El Excel incluye el resultado del cierre, el manifiesto validado, las incidencias, la productividad y la auditoría.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {spreadsheet && <SpreadsheetNotice spreadsheet={spreadsheet} />}
    <footer className="dialog-actions">
      <button className="button secondary" type="button" onClick={dismiss}>Ver conciliación</button>
      {!spreadsheet && <button className="button primary report-generate" type="button" disabled={exporting} onClick={generate}>
        <FileSpreadsheet size={18} /> {exporting ? "Preparando Excel…" : "Generar reporte en hoja de cálculo"}
      </button>}
    </footer>
  </Dialog>;
}

export function CancelDialog({ title, scanned, dismiss, onCancel }: {
  title: string; scanned: number; dismiss: () => void; onCancel: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <Dialog title="Cancelar jornada" intro={title} onDismiss={() => { if (!busy) dismiss(); }}>
    <form onSubmit={async event => {
      event.preventDefault();
      setBusy(true);
      setError("");
      try { await onCancel(); } catch (e) { setError(getError(e)); } finally { setBusy(false); }
    }}>
      <p className="notice warn"><TriangleAlert size={20} />
        <span>Se detendrá el escaneo. El manifiesto y las lecturas quedarán en el historial como una jornada cancelada. Piezas escaneadas hasta ahora · {number.format(scanned)}.</span>
      </p>
      {error && <p className="notice error" role="alert">{error}</p>}
      <footer className="dialog-actions">
        <button className="button secondary" type="button" onClick={dismiss} disabled={busy}>Continuar jornada</button>
        <button className="button danger" type="submit" disabled={busy}>{busy ? "Cancelando…" : "Confirmar cancelación"}</button>
      </footer>
    </form>
  </Dialog>;
}

export function IssueDialog({ box, dismiss, add }: {
  box: string; dismiss: () => void; add: (type: IssueType, code: string, qty: number, note: string) => void;
}) {
  const [type, setType] = useState<IssueType>("Daño");
  const [code, setCode] = useState("");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  return <Dialog title="Registrar incidencia" intro={box ? "Contenedor activo · " + box : "Se guardará sin contenedor."} onDismiss={dismiss}>
    <form onSubmit={event => {
      event.preventDefault();
      if (note.trim() && Number.isInteger(qty) && qty > 0) add(type, code.trim(), qty, note.trim());
    }}>
      <label className="field">Tipo de incidencia
        <select value={type} onChange={event => setType(event.target.value as IssueType)}>
          {ISSUE_TYPES.map(item => <option key={item}>{item}</option>)}
        </select>
      </label>
      <div className="field-pair">
        <label className="field">SKU o UPC <span className="optional">Opcional</span><input value={code} maxLength={90} onChange={event => setCode(event.target.value)} /></label>
        <label className="field">Piezas afectadas<input type="number" required min={1} max={100000} value={qty || ""} onChange={event => setQty(Number(event.target.value))} /></label>
      </div>
      <label className="field">Observación<textarea rows={3} required value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="Describe lo que encontraste." /></label>
      <footer className="dialog-actions"><button type="button" className="button secondary" onClick={dismiss}>Cancelar</button>
        <button type="submit" className="button primary" disabled={!note.trim()}>Guardar incidencia</button></footer>
    </form>
  </Dialog>;
}

export function VerifyDialog({ status, item, qty, dismiss, onConfirm }: {
  status: Verification; item: ManifestRow; qty: number; dismiss: () => void; onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const confirming = status === "Confirmado";
  const reporting = status === "Reportado a SEPRO";
  const title = confirming ? "Confirmar faltante físico" : reporting ? "Marcar como reportado a SEPRO" : "Marcar faltante como resuelto";
  return <Dialog title={title} intro={item.description || item.sku || item.upc} onDismiss={dismiss}>
    <form onSubmit={event => { event.preventDefault(); if (checked) onConfirm(note.trim()); }}>
      <p className="notice">{number.format(qty)} pieza(s) · {item.box || "Sin caja"} · {item.sku || item.upc}</p>
      <label className="checkbox"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />
        {confirming ? "Revisé físicamente el artículo y confirmé que faltan estas piezas."
          : reporting ? "El faltante ya fue reportado a SEPRO por el canal correspondiente." : "Verifiqué que el reporte ya se resolvió."}
      </label>
      <label className="field">Observación o folio <span className="optional">Opcional</span><textarea rows={3} value={note} onChange={event => setNote(event.target.value)} maxLength={500} /></label>
      <footer className="dialog-actions"><button type="button" className="button secondary" onClick={dismiss}>Cancelar</button>
        <button type="submit" className="button primary" disabled={!checked}>Guardar estado</button></footer>
    </form>
  </Dialog>;
}
