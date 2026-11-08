"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Box, Boxes, CheckCheck, ChevronLeft, ChevronRight, ClipboardCheck, Download, FileSpreadsheet, History, Package, Plus, ScanLine, Search, TriangleAlert } from "lucide-react";
import { actualBoxesForCode, summarizeProducts, type Audit, type ManifestIndex } from "../lib/recepcion/audit";
import { codeKey, incidentCount, type Detail, type Receipt, type Verification } from "../lib/recepcion/model";
import { Empty, number, percent, ScannerIllustration, showDate, Status, WorkflowSteps } from "./ui";

export function HistoryTable({ receipts, select }: { receipts: Receipt[]; select: (receipt: Receipt) => void }) {
  return <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla de jornadas">
    <table className="data-table history-table"><thead><tr><th>Jornada</th><th>Apertura</th><th>Piezas</th><th>Estado</th><th><span className="sr-only">Abrir</span></th></tr></thead>
      <tbody>{receipts.map(item => <tr key={item.id}>
        <td><button className="row-name" onClick={() => select(item)}><span className="row-file-icon"><FileSpreadsheet size={17} /></span><span><strong>{item.title}</strong><small>{item.file}</small></span></button></td>
        <td>{showDate(item.createdAt)}</td>
        <td>{item.totals ? number.format(item.totals.matched) + " / " : ""}{number.format(item.expected)}</td>
        <td><Status receipt={item} /></td>
        <td><button className="icon-button" type="button" aria-label={"Abrir " + item.title} onClick={() => select(item)}><ArrowUpRight size={18} /></button></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function Dashboard({ detail, audit, history, loading, newManifest, cancel, scan, reconcile, allHistory, select }: {
  detail: Detail | null; audit: Audit | null; history: Receipt[]; loading: boolean;
  newManifest?: () => void; cancel?: () => void; scan: () => void; reconcile: () => void;
  allHistory: () => void; select: (receipt: Receipt) => void;
}) {
  const receipt = detail?.receipt;
  const totals = detail?.live?.totals ?? audit?.totals;
  const stage = receipt?.closedAt && !receipt.canceled ? 2 : totals?.scanned ? 1 : 0;
  const metrics = [
    { label: "Piezas esperadas", value: totals?.expected, icon: Package, color: "brand", hint: "Según el manifiesto" },
    { label: "Piezas conciliadas", value: totals?.matched, icon: CheckCheck, color: "green", hint: "SKU y caja coinciden" },
    { label: "Piezas pendientes", value: totals?.missing, icon: Boxes, color: "amber", hint: "Por escanear o verificar" },
    { label: "Otras incidencias", value: totals ? incidentCount(totals) - totals.missing : undefined, icon: TriangleAlert, color: "purple", hint: "Sobrantes, caja y daños" },
  ];
  return <>
    <section className="hero">
      <div className="hero-copy">
        <div className="hero-meta">
          <span className="eyebrow hero-tag"><i /> {receipt ? "Jornada seleccionada" : "Mesa de recepción"}</span>
          {receipt && <Status receipt={receipt} />}
        </div>
        <h2>{receipt?.title ?? "Tu jornada empieza aquí"}</h2>
        <p>{receipt ? number.format(receipt.lineCount) + " renglones · " + number.format(receipt.boxCount) + " contenedores · " + number.format(receipt.manifestCount) + (receipt.manifestCount === 1 ? " manifiesto" : " manifiestos")
          : "Carga un manifiesto, lee cada caja y sus piezas, y concilia la entrega en el mismo lugar."}</p>
        <div className="hero-actions">
          <button className="button primary" onClick={receipt ? receipt.closedAt ? reconcile : scan : newManifest ?? allHistory} disabled={loading}>
            {receipt ? receipt.closedAt ? <ClipboardCheck size={18} /> : <ScanLine size={18} /> : <Plus size={18} />}
            {receipt ? receipt.closedAt ? "Ver conciliación" : "Continuar jornada" : newManifest ? "Cargar manifiesto" : "Ver mis jornadas"}
          </button>
          {cancel && receipt && !receipt.closedAt && <button className="button secondary cancel-action" type="button" onClick={cancel} disabled={loading}>Cancelar jornada</button>}
        </div>
        {receipt && totals && <div className="hero-progress">
          <div><span>Avance de conciliación</span><strong>{percent(totals)}%</strong></div>
          <progress value={totals.matched} max={totals.expected || 1} aria-label="Avance de conciliación" />
        </div>}
      </div>
      <ScannerIllustration />
    </section>
    <WorkflowSteps stage={stage} />
    <section className="metrics" aria-label="Indicadores de recepción">
      {metrics.map(({ label, value, icon: Icon, color, hint }) => <article className="metric panel" key={label}>
        <span className={"metric-icon " + color}><Icon size={19} /></span>
        <strong>{value === undefined ? "—" : number.format(value)}</strong>
        <span className="metric-label">{label}</span>
        <small>{hint}</small>
      </article>)}
    </section>
    <section className="panel history-card">
      <header className="panel-heading"><div className="section-icon"><History size={21} /></div>
        <div><h2>Jornadas recientes</h2><p>Recepciones abiertas y cierres guardados.</p></div>
        <button className="button secondary panel-action" type="button" onClick={allHistory}>Ver historial <ArrowUpRight size={16} /></button>
      </header>
      {history.length ? <HistoryTable receipts={history.slice(0, 4)} select={select} />
        : <Empty title={loading ? "Cargando jornadas…" : "Todavía no hay jornadas"} icon={FileSpreadsheet}>Los manifiestos que cargues aparecerán aquí.</Empty>}
    </section>
  </>;
}

export function HistoryView({ receipts, next, loadMore, select, newManifest }: {
  receipts: Receipt[]; next: string | null; loadMore: () => Promise<void>; select: (receipt: Receipt) => void; newManifest?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filtered = receipts.filter(item => {
    const state = item.canceled ? "canceled" : item.closedAt ? "closed" : "open";
    return (status === "all" || status === state) && codeKey(item.title + " " + item.file).includes(codeKey(search));
  });
  return <section className="panel table-panel">
    <header className="panel-heading"><div className="section-icon"><History size={21} /></div><div><h2>Historial de jornadas</h2><p>Consulta el detalle de las recepciones anteriores.</p></div></header>
    <div className="table-toolbar">
      <label className="search-box"><Search size={18} /><input placeholder="Buscar jornada o archivo" aria-label="Buscar jornada o archivo" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <select aria-label="Filtrar por estado" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="all">Todos los estados</option><option value="open">En curso</option><option value="closed">Cerradas</option><option value="canceled">Canceladas</option>
      </select>
    </div>
    {filtered.length ? <HistoryTable receipts={filtered} select={select} /> : <Empty title={receipts.length ? "Sin coincidencias" : "Aún no hay jornadas"} icon={FileSpreadsheet}
      action={!receipts.length && newManifest ? <button className="button secondary" onClick={newManifest}><Plus size={17} /> Nuevo manifiesto</button> : undefined}>
      {receipts.length ? "Prueba con otro nombre o estado." : "Carga tu primer manifiesto para comenzar."}</Empty>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {next && <footer className="table-footer"><button className="button secondary" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try { await loadMore(); } catch { setError("No se pudieron cargar más jornadas."); } finally { setBusy(false); }
    }}>{busy ? "Cargando…" : "Cargar jornadas anteriores"}</button></footer>}
  </section>;
}

type Tab = "articles" | "pending" | "incidents" | "summary";
type Case = { key: string; type: string; code: string; box: string; qty: number; note: string };

function IncidentRows({ cases }: { cases: Case[] }) {
  return <table className="data-table"><thead><tr><th>Tipo</th><th>SKU / código</th><th>Contenedor</th><th>Piezas</th><th>Detalle</th></tr></thead>
    <tbody>{cases.map(item => <tr key={item.key}><td><span className="pill warn-pill">{item.type}</span></td>
      <td className="mono">{item.code || "—"}</td><td>{item.box || "Sin caja"}</td><td>{number.format(item.qty)}</td><td>{item.note || "—"}</td></tr>)}</tbody>
  </table>;
}

const pageSize = 40;

export function ReconcileView({ detail, index, audit, onClose, onExport, onVerify, exporting }: {
  detail: Detail; index: ManifestIndex; audit: Audit; onClose?: () => void;
  onExport: (sepro?: boolean) => void; onVerify: (line: number, status: Verification) => void; exporting: boolean;
}) {
  const [tab, setTab] = useState<Tab>("articles");
  const [query, setQuery] = useState("");
  const [box, setBox] = useState("");
  const [page, setPage] = useState(0);
  const { rows, receipt } = detail;
  const closed = Boolean(receipt.closedAt && !receipt.canceled);
  const { totals, received, extras, verification } = audit;
  const gap = incidentCount(totals);
  const search = codeKey(query);
  const match = (value: string, container?: string) => codeKey(value).includes(search) && (!box || codeKey(container ?? "") === box);
  const products = useMemo(() => summarizeProducts(rows, audit), [rows, audit]);
  const cases = useMemo(() => {
    const grouped = new Map<string, Case>();
    rows.forEach((row, line) => {
      const missing = row.qty - received[line];
      if (missing) grouped.set("missing-" + line, { key: "missing-" + line, type: receipt.closedAt ? "Faltante" : "Pendiente", code: row.sku || row.upc, box: row.box, qty: missing, note: receipt.closedAt ? verification.get(line)?.status ?? "Pendiente de verificación" : "Por recibir" });
    });
    for (const scan of audit.scans) {
      if (!["Otra caja", "Sobrante", "Fuera de manifiesto"].includes(scan.result)) continue;
      const key = JSON.stringify([scan.result, scan.op.code, scan.op.box, scan.line]);
      const prior = grouped.get(key);
      if (prior) prior.qty++;
      else grouped.set(key, { key, type: scan.result, code: scan.op.code, box: scan.op.box, qty: 1, note: scan.result === "Otra caja"
        ? "Caja esperada · " + actualBoxesForCode(index, scan.op.code) : scan.description ?? "" });
    }
    for (const issue of audit.issues) grouped.set(issue.id, { key: issue.id, type: issue.type, code: issue.code, box: issue.box, qty: issue.qty, note: issue.note });
    return [...grouped.values()];
  }, [audit, index, receipt.closedAt, received, rows, verification]);
  const visibleRows = rows.map((row, line) => ({ row, line })).filter(({ row, line }) => (tab !== "pending" || received[line] < row.qty)
    && match([row.sku, row.upc, row.description, row.manifest, row.box, row.supplier].join(" "), row.box));
  const visibleCases = cases.filter(item => match([item.code, item.note, item.type, item.box].join(" "), item.box));
  const visibleProducts = products.filter(item => codeKey([item.sku, item.upc, item.description].join(" ")).includes(search));
  const count = tab === "incidents" ? visibleCases.length : tab === "summary" ? visibleProducts.length : visibleRows.length;
  const lastPage = Math.max(0, Math.ceil(count / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const slice = <T,>(items: T[]) => items.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const confirmed = [...verification.values()].some(item => item.status === "Confirmado");
  const tabs: { id: Tab; name: string; count?: number }[] = [
    { id: "articles", name: "Artículos" }, { id: "pending", name: receipt.closedAt ? "Pendientes SEPRO" : "Pendientes", count: totals.missing },
    { id: "incidents", name: "Incidencias", count: gap }, { id: "summary", name: "Resumen SKU" },
  ];
  return <>
    <section className="panel reconciliation-status">
      <div className="panel-heading">
        <div className="section-icon"><ClipboardCheck size={22} /></div>
        <div><h2>{receipt.title}</h2><p>{receipt.closedAt ? (receipt.canceled ? "Cancelada el " : "Cerrada el ") + showDate(receipt.closedAt) : "Concilia el manifiesto antes del cierre."}</p></div>
        <Status receipt={receipt} />
      </div>
      <div className="reconciliation-progress">
        <div><span><strong>{number.format(totals.matched)}</strong> / {number.format(totals.expected)} conciliadas</span><b>{percent(totals)}%</b></div>
        <progress value={totals.matched} max={totals.expected || 1} aria-label="Conciliación de piezas" />
      </div>
      <div className="reconciliation-metrics">
        {[["Escaneadas", totals.scanned], [receipt.closedAt ? "Faltantes" : "Pendientes", totals.missing], ["Sobrantes", totals.extra], ["Fuera de manifiesto", totals.unknown], ["Otra caja", totals.wrongBox], ["Incidencias manuales", totals.manual]].map(([label, value]) =>
          <div key={label}><strong>{number.format(Number(value))}</strong><span>{label}</span></div>)}
      </div>
      {receipt.note && <p className="closure-note">{receipt.note}</p>}
      <footer className="reconciliation-actions">
        <button className={closed ? "button primary report-generate" : "button secondary"} type="button" onClick={() => onExport()} disabled={exporting}>
          {closed ? <FileSpreadsheet size={17} /> : <Download size={17} />}
          {exporting ? "Preparando Excel…" : closed ? "Generar reporte en hoja de cálculo" : "Exportar Excel"}
        </button>
        {onClose && !receipt.closedAt && <button className="button primary" type="button" onClick={onClose} disabled={exporting}><ClipboardCheck size={17} /> Cerrar jornada</button>}
      </footer>
    </section>
    <section className="panel table-panel">
      <nav className="data-tabs" aria-label="Detalle de conciliación">{tabs.map(item =>
        <button key={item.id} aria-pressed={tab === item.id} onClick={() => { setTab(item.id); setPage(0); }}>
          {item.name}{typeof item.count === "number" && item.count > 0 && <span>{number.format(item.count)}</span>}
        </button>)}</nav>
      {tab === "pending" && receipt.closedAt && <div className="sepro-guide">
        <TriangleAlert size={18} /><p>{receipt.canceled ? "Aquí puedes consultar los faltantes al momento de cancelar la jornada."
          : "Verifica físicamente los faltantes después del cierre. El Excel para SEPRO incluye solo los confirmados que todavía están por reportar."}</p>
        {!receipt.canceled && <button className="button secondary" type="button" onClick={() => onExport(true)} disabled={!confirmed || exporting}><Download size={16} /> Excel para SEPRO</button>}
      </div>}
      <div className="table-toolbar">
        <label className="search-box"><Search size={18} /><input value={query} placeholder="Buscar por SKU, UPC o descripción" aria-label="Buscar por SKU, UPC o descripción"
          onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
        {tab !== "summary" && <select value={box} aria-label="Filtrar por contenedor" onChange={event => { setBox(event.target.value); setPage(0); }}>
          <option value="">Todos los contenedores</option>
          {[...index.boxes].map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
        </select>}
      </div>
      {count === 0 ? <Empty title={search || box ? "Sin coincidencias" : tab === "pending" ? receipt.closedAt ? "Sin faltantes" : "Sin piezas pendientes" : "Sin incidencias"}
        icon={tab === "pending" ? Boxes : Box}>{search || box ? "Cambia el texto de búsqueda o el contenedor." : "No hay registros en esta vista."}</Empty> :
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Detalle de la conciliación">
          {tab === "incidents" ? <IncidentRows cases={slice(visibleCases)} /> : tab === "summary" ?
            <table className="data-table"><thead><tr><th>SKU</th><th>Descripción</th><th>Esperadas</th><th>Conciliadas</th><th>Faltantes</th><th>Sobrantes</th></tr></thead>
              <tbody>{slice(visibleProducts).map(item => <tr key={item.sku || item.upc}><td className="mono">{item.sku || item.upc}</td><td>{item.description || "—"}</td>
                <td>{item.expected}</td><td>{item.received}</td><td>{item.missing}</td><td>{item.extra}</td></tr>)}</tbody>
            </table> :
            <table className="data-table article-table"><thead><tr><th>Artículo</th><th>Contenedor</th><th>Esperadas</th><th>Recibidas</th><th>{tab === "pending" ? "SEPRO" : "Resultado"}</th></tr></thead>
              <tbody>{slice(visibleRows).map(({ row, line }) => {
                const missing = row.qty - received[line];
                const prior = verification.get(line)?.status;
                const next = !prior ? "Confirmado" : prior === "Confirmado" ? "Reportado a SEPRO" : prior === "Reportado a SEPRO" ? "Resuelto" : null;
                return <tr key={line}>
                  <td><strong>{row.description || row.sku || row.upc}</strong><small>{[row.sku, row.upc, row.manifest].filter(Boolean).join(" · ")}</small></td>
                  <td>{row.box || "Sin caja"}</td><td>{number.format(row.qty)}</td><td>{number.format(received[line] + extras[line])}</td>
                  <td>{tab === "pending" ? <div className="pending-cell">
                    <span className={"pill " + (prior ? "good-pill" : "warn-pill")}>{number.format(missing)} · {prior ?? "Por verificar"}</span>
                    {receipt.closedAt && !receipt.canceled && !receipt.archived && next && <button className="text-button" onClick={() => onVerify(line, next)}>{!prior ? "Confirmar faltante" : prior === "Confirmado" ? "Marcar reportado" : "Marcar resuelto"}</button>}
                  </div> : <span className={"pill " + (missing || extras[line] ? "warn-pill" : "good-pill")}>
                    {missing ? number.format(missing) + " pendientes" : extras[line] ? "+" + number.format(extras[line]) + " sobrantes" : "Conciliado"}</span>}</td>
                </tr>;
              })}</tbody>
            </table>}
        </div>}
      {count > 0 && <footer className="table-footer pager">
        <span>{number.format(currentPage * pageSize + 1)}–{number.format(Math.min((currentPage + 1) * pageSize, count))} de {number.format(count)} registros</span>
        <div><button className="icon-button" aria-label="Página anterior" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button>
          <button className="icon-button" aria-label="Página siguiente" disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></div>
      </footer>}
    </section>
  </>;
}
