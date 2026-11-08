"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronRight, CircleHelp, Cloud, CloudOff, Download, History, LayoutDashboard, ListChecks, LogOut, Plus, RefreshCw, ScanLine, ShieldCheck, Users, WifiOff } from "lucide-react";
import { audit, checkPiece, indexManifest } from "../lib/recepcion/audit";
import { browserDevice, request, useReception } from "../lib/recepcion/client";
import { buildWorkbook, downloadPending } from "../lib/recepcion/files";
import { codeKey, newOperation, type Detail, type History as ReceptionHistory, type ManifestRow, type OperationInput, type Receipt, type ScanSource, type TeamActivity, type TeamActor, type Verification } from "../lib/recepcion/model";
import { Scanner, type Feedback } from "./scanner";
import { LiveView } from "./team";
import { Brand, Dialog, Empty, number, showTime, Status } from "./ui";
import { Dashboard, HistoryView, ReconcileView } from "./views";
import { watchRevisions } from "../lib/recepcion/transport";
import { TransferForm } from "./transfer";
import { CancelDialog, CloseDialog, ClosureReportDialog, ImportDialog, IssueDialog, SpreadsheetNotice, VerifyDialog, type Spreadsheet } from "./workflows";

type View = "home" | "scan" | "live" | "review" | "history";
type PreparedReport = Spreadsheet & { receiptId: string; closedAt: string | null; seproOnly: boolean };
const sections = [
  { id: "home", label: "Inicio", icon: LayoutDashboard },
  { id: "scan", label: "Escanear", icon: ScanLine },
  { id: "live", label: "En vivo", icon: Users },
  { id: "review", label: "Conciliar", icon: ListChecks },
  { id: "history", label: "Historial", icon: History },
] as const;

export default function Vanifs({ actor, onModules, onLogout }: { actor: TeamActor; onModules: () => void; onLogout: () => Promise<void> }) {
  const reception = useReception(actor);
  const { detail, pending, history, online, error, storageError, syncing, loading } = reception;
  const receipt = detail?.receipt;
  const [view, setView] = useState<View>("home");
  const [dialog, setDialog] = useState<"import" | "close" | "report" | "cancel" | "issue" | "help" | null>(null);
  const [verification, setVerification] = useState<{ line: number; status: Verification } | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [box, setBox] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [today, setToday] = useState<Receipt[]>([]);
  const [lastSync, setLastSync] = useState("");
  const [todayError, setTodayError] = useState("");
  const [linked, setLinked] = useState<Receipt>();
  const [reopen, setReopen] = useState(false);
  const [exportReady, setExportReady] = useState<PreparedReport | null>(null);
  const currentExport = exportReady && receipt && exportReady.receiptId === receipt.id
    && exportReady.closedAt === receipt.closedAt ? exportReady : null;
  const main = useRef<HTMLElement>(null);
  const activeBox = useRef("");
  const index = useMemo(() => detail ? indexManifest(detail.rows) : null, [detail?.rows]);
  const committed = useMemo(() => detail?.batches.flatMap(batch => batch.ops) ?? [], [detail?.batches]);
  const confirmed = useMemo(() => index && audit(index, committed), [index, committed]);
  const result = useMemo(() => {
    if (!index) return null;
    const local = actor && !receipt?.canceled ? pending.filter(op => !receipt?.closedAt || op.kind === "verify").map(op => ({ ...op, actor })) : [];
    return local.length ? audit(index, [...committed, ...local]) : confirmed;
  }, [actor, committed, confirmed, index, pending, receipt?.closedAt, receipt?.canceled]);
  const lastPiece = result?.scans.findLast(scan => scan.op.kind === "piece" && scan.op.actor.id === actor?.id && scan.result !== "Anulada");

  const manager = actor?.role === "admin" || actor?.role === "supervisor";
  const pendingIds = useMemo(() => new Set(pending.map(op => op.id)), [pending]);
  const lease = detail?.live?.leases.find(item => item.box === codeKey(box));

  useEffect(() => {
    let lastBox = "";
    if (receipt) {
      try { lastBox = sessionStorage.getItem("vanifs:box:" + (actor?.id ?? "") + ":" + receipt.id) ?? ""; } catch {}
    }
    activeBox.current = lastBox;
    reception.boxRef.current = lastBox;
    setBox(lastBox);
    setFeedback(null);
    setExportError("");
    setExportReady(null);
  }, [actor?.id, receipt?.id]);

  useEffect(() => () => { if (exportReady) URL.revokeObjectURL(exportReady.url); }, [exportReady]);

  useEffect(() => {
    if (!online || view !== "home") return;
    let disposed = false;
    let running = false;
    const refresh = async () => {
      if (disposed || running || document.hidden) return;
      running = true;
      try {
        const result = await request<ReceptionHistory>("/api/recepcion?today=1");
        if (disposed) return;
        setToday(result.receipts);
        setTodayError("");
        setLastSync(new Date().toISOString());
        const id = new URLSearchParams(location.search).get("jornada");
        if (id && !result.receipts.some(item => item.id === id)) {
          const selection = await request<ReceptionHistory>("/api/recepcion?q=" + encodeURIComponent(id));
          if (!disposed) setLinked(selection.receipts.find(item => item.id === id));
        } else setLinked(undefined);
      } catch (reason) {
        if (!disposed) setTodayError(reason instanceof Error ? reason.message : "No se pudieron consultar las jornadas.");
      } finally { running = false; }
    };
    void refresh();
    const unwatch = watchRevisions(null, () => void refresh());
    const timer = window.setInterval(refresh, 15000);
    return () => { disposed = true; clearInterval(timer); unwatch(); };
  }, [actor.id, online, view]);

  useEffect(() => {
    if (!pending.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [Boolean(pending.length)]);

  function navigate(next: View) {
    setView(next);
    setExportReady(null);
    window.scrollTo(0, 0);
    requestAnimationFrame(() => main.current?.focus({ preventScroll: true }));
  }

  function inform(text: string, tone: Feedback["tone"], code?: string, op?: OperationInput): Feedback {
    const response = { text, tone, code, at: Date.now(), event: op && { id: op.id, saved: reception.enqueue(op) } };
    setFeedback(response);
    return response;
  }

  function activateBox(label: string, source: ScanSource = "Manual") {
    if (!receipt || receipt.closedAt || receipt.pausedAt || loading) return null;
    const assignee = detail?.live?.leases.find(item => item.box === codeKey(label));
    if (assignee && assignee.userId !== actor?.id) return inform("La caja está asignada a " + assignee.name + ".", "error", label);
    activeBox.current = label;
    reception.boxRef.current = label;
    setBox(label);
    try { sessionStorage.setItem("vanifs:box:" + (actor?.id ?? "") + ":" + receipt.id, label); } catch {}
    return label
      ? inform("Contenedor seleccionado · por sincronizar", "warn", label, { ...newOperation(), kind: "box", code: label, box: label, source })
      : inform("Sin contenedor seleccionado", "warn");
  }

  function scan(raw: string, source: ScanSource) {
    if (!index || receipt?.closedAt || receipt?.pausedAt || loading) return null;
    const code = codeKey(raw);
    if (!code || code.length > 90 || /[\u0000-\u001f\u007f]/.test(code)) return inform("El código está vacío o no se puede leer.", "error");
    const matching = index.boxes.get(code);
    if (matching) return activateBox(matching.label, source);
    const actual = activeBox.current;
    const assignee = detail?.live?.leases.find(item => item.box === codeKey(actual));
    if (assignee && assignee.userId !== actor?.id) return inform("La caja está asignada a " + assignee.name + ".", "error", actual);
    const problem = checkPiece(index, code, actual);
    if (problem) return inform(problem, "warn", code);
    const response = inform(navigator.onLine ? "Lectura por sincronizar" : "PENDIENTE DE SINCRONIZAR", "warn", code, { ...newOperation(), kind: "piece", code, box: actual, source });
    if (source !== "Cámara" && response.event) void reception.confirm(response.event.id).then(({ ack, error }) => {
      if (!ack && !error) return;
      setFeedback(current => current?.event?.id === response.event?.id ? {
        text: ack?.result === "Recibida" ? "Pieza confirmada" : ack?.result ?? error ?? "",
        tone: ack?.result === "Recibida" ? "good" : error ? "error" : "warn",
        code: ack?.sku ?? code, at: Date.now(),
      } : current);
    });
    return response;
  }

  async function open(item: Receipt, next?: View) {
    const selected = await reception.open(item.id);
    if (selected) navigate(next ?? (item.closedAt ? manager ? "review" : "live" : item.pausedAt ? "live" : "scan"));
  }

  async function create(id: string, title: string, file: string, rows: ManifestRow[]) {
    const created = await reception.create(id, title, file, rows);
    setDialog(null);
    navigate(created.receipt.closedAt ? "review" : "scan");
  }

  async function exportReport(sepro = false) {
    if (!detail || !manager || exporting) return;
    const { id, closedAt } = detail.receipt;
    setExporting(true);
    setExportError("");
    setExportReady(null);
    try {
      const [latest, { activities }] = await Promise.all([
        request<Detail>("/api/recepcion?id=" + id),
        sepro ? Promise.resolve({ activities: [] }) : request<{ activities: TeamActivity[] }>("/api/equipo?view=audit&id=" + id),
      ]);
      if (latest.receipt.closedAt !== closedAt) throw new Error("La jornada cambió de estado.");
      const manifest = indexManifest(latest.rows);
      const report = audit(manifest, latest.batches.flatMap(batch => batch.ops));
      const { buffer, type, name } = await buildWorkbook(latest, manifest, report, sepro, activities);
      const file = new File([buffer], name, { type });
      setExportReady({ file, url: URL.createObjectURL(file), receiptId: id, closedAt, seproOnly: sepro });
    }
    catch { setExportError("No se pudo generar el Excel. Intenta de nuevo."); }
    finally { setExporting(false); }
  }

  function exportFromReview(sepro = false) {
    if (!sepro && receipt?.closedAt && !receipt.canceled) setDialog("report");
    void exportReport(sepro);
  }

  async function logout() {
    if (pending.length) return;
    try { await onLogout(); }
    catch { setSessionError("No se pudo cerrar la sesión. Intenta de nuevo con conexión."); }
  }

  const available = sections.filter(item => item.id !== "review" || manager);
  const section = available.find(item => item.id === view) ?? available[0];
  const title = view === "home" ? "Recepción de mercancía" : view === "scan" ? "Escaneo de piezas" : view === "review" ? "Conciliación" : view === "live" ? "Jornada en vivo" : "Historial";
  const subtitle = view === "home" ? "Carga manifiestos, escanea contenedores y concilia la entrega."
    : view === "scan" ? "Escanea la caja primero y después cada pieza que contiene."
      : view === "review" ? "Compara la entrega con el manifiesto y revisa las diferencias." : view === "live" ? "Comparte la jornada y sigue el avance del equipo." : "Consulta recepciones en curso y reportes de cierre.";
  const displayName = actor?.name.split(/[\s@]/)[0];
  const connection = !online ? "Sin conexión" : syncing ? "Sincronizando" : pending.length ? number.format(pending.length) + " por sincronizar" : actor ? "En línea" : "Sin sesión";

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Barra de navegación">
      <Brand goHome={() => navigate("home")} />
      <div className="side-rule" />
      <span className="nav-caption">OPERACIÓN</span>
      <nav className="side-nav" aria-label="Secciones">
        {available.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => navigate(id)} aria-current={view === id ? "page" : undefined}>
          <Icon size={19} /><span>{label}</span>{view === id && <ChevronRight size={16} className="nav-chevron" />}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <button className="side-help" type="button" onClick={() => setDialog("help")}><CircleHelp size={19} /> Guía rápida</button>
        <div className="space-label"><span><ShieldCheck size={18} /></span><div><strong>Área de recepción</strong><small>Operación de bodega</small></div></div>
      </div>
    </aside>
    <div className="app-body">
      <header className="topbar">
        <div className="breadcrumbs"><span>Liverpool · Recepción de Mercancía</span><ChevronRight size={14} /><strong>{section.label}</strong></div>
        <Brand mobile goHome={() => navigate("home")} />
        <div className="top-actions">
          <span className={"connection " + (!online || pending.length || error ? "connection-warn" : !actor ? "connection-guest" : "")}>
            {online ? <Cloud size={16} /> : <CloudOff size={16} />}<span>{connection}</span>
          </span>
          <div className="user" title={actor.name}><span className="avatar">{(displayName?.[0] ?? "V").toUpperCase()}</span><span>{displayName}</span></div>
          <button type="button" className="button secondary" onClick={onModules} disabled={pending.length > 0}>Módulos</button>
          <button className="icon-button team-signout" type="button" onClick={() => void logout()} disabled={pending.length > 0}
            title={pending.length ? "Sincroniza tus lecturas antes de salir" : "Cerrar sesión"} aria-label="Cerrar sesión"><LogOut size={17} /></button>
        </div>
      </header>
      <nav className="mobile-nav" aria-label="Secciones">
        {available.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => navigate(id)} aria-current={view === id ? "page" : undefined}><Icon size={17} />{label}</button>)}
      </nav>
      <main ref={main} tabIndex={-1} className="main">
        <header className="page-heading">
          <div><span className="eyebrow page-kicker"><i /> {view === "home" ? "Sistema interno de control logístico" : "Operación de bodega"}</span><h1>{title}</h1><p>{subtitle}</p></div>
          {view === "home" || view === "history" ? manager && <button className={"button primary new-button" + (view === "home" && !receipt ? " redundant-on-mobile" : "")} type="button" onClick={() => setDialog("import")}><Plus size={20} /> Nuevo manifiesto</button>
            : receipt && <div className="current-title">
              <Status receipt={receipt} /><strong>{receipt.title}</strong>
              {actor.canClose && !receipt.closedAt && <button className="button secondary cancel-action" type="button" disabled={loading} onClick={() => setDialog("cancel")}>Cancelar jornada</button>}
            </div>}
        </header>
        {(!online || error || storageError) && <div className="notice sync-notice warn" role="status">
          <WifiOff size={19} />
          <div><strong>{!online ? "Sin conexión" : error ? "Sincronización pendiente" : "El almacenamiento local no está disponible"}</strong>
            <p>{error || (!online ? "Puedes seguir escaneando en la jornada abierta. Las lecturas se enviarán al volver la conexión."
              : "Si se interrumpe la red, conserva esta pestaña abierta y descarga las lecturas pendientes.")}</p>
          </div>
          <div className="sync-actions">
            {online && receipt && <button className="button secondary" type="button" onClick={() => void reception.flush(true)} disabled={syncing}><RefreshCw size={16} /> Reintentar</button>}
            {pending.length > 0 && <button className="button secondary" type="button" onClick={() => downloadPending(pending, receipt?.title ?? "jornada")}><Download size={16} /> Respaldo local</button>}
          </div>
        </div>}
        {pending.length > 0 && <p className="field-hint">Conserva esta sesión y los datos del navegador hasta que terminen de sincronizarse las lecturas.</p>}
        {sessionError && <p className="notice error" role="alert">{sessionError}</p>}
        {exportError && dialog !== "report" && <p className="notice error" role="alert">{exportError}</p>}
        {view === "review" && dialog !== "report" && currentExport && <SpreadsheetNotice key={currentExport.url} spreadsheet={currentExport} />}
        {view === "home" && <section className="panel team-panel today-receipts">
          <h2>Manifiesto activo de hoy</h2>
          {lastSync && <p className="field-hint">Última sincronización {showTime(lastSync)}</p>}
          {todayError && <p className="notice warn" role="status">{todayError}</p>}
          {!today.length && !linked && <p className="field-hint">{online ? "Aquí aparecerán las jornadas publicadas para el equipo." : "Conéctate para consultar las jornadas de hoy."}</p>}
          {[...today, ...(linked ? [linked] : [])].map(item => {
            const live = item.live;
            const totals = live?.totals;
            const connected = new Set(live?.presence.filter(person => Date.now() - person.seenAt < 45000).map(person => person.id)).size;
            return <article key={item.id} className="panel team-panel history-row">
              <header className="panel-heading"><div><h3>{item.title}</h3><p>{item.date} · Código {item.id.slice(0, 8)}</p></div><Status receipt={item} /></header>
              {totals && <div className="team-metrics">{[
                ["Esperadas", totals.expected], ["Confirmadas", totals.scanned], ["Pendientes", totals.missing],
                ["Incidencias", totals.extra + totals.unknown + totals.wrongBox + totals.manual], ["Conectados", connected],
              ].map(([label, value]) => <div key={label}><strong>{number.format(Number(value))}</strong><span>{label}</span></div>)}</div>}
              {totals && <p className="field-hint">{Math.floor(100 * totals.matched / Math.max(1, totals.expected))}% conciliado</p>}
              <button className="button primary" type="button" disabled={loading} onClick={() => void open(item)}>
                <ScanLine size={18} /> {item.closedAt ? "Consultar jornada" : item.pausedAt ? "Ver jornada pausada" : "Unirme a la recepción"}
              </button>
            </article>;
          })}
        </section>}
        {view === "home" && (detail || !today.length) && <Dashboard detail={detail} audit={confirmed} history={history.receipts} loading={loading} newManifest={manager ? () => setDialog("import") : undefined} cancel={actor.canClose ? () => setDialog("cancel") : undefined}
          scan={() => navigate(receipt?.pausedAt ? "live" : "scan")} reconcile={() => navigate(manager ? "review" : "live")} allHistory={() => navigate("history")} select={item => void open(item)} />}
        {view === "history" && <HistoryView receipts={history.receipts} next={history.next}
          loadMore={async () => { if (history.next) await reception.historyPage(history.next); }} select={item => void open(item)} newManifest={manager ? () => setDialog("import") : undefined} />}
        {view === "live" && <LiveView actor={actor} detail={detail} receipts={history.receipts} select={item => void open(item, "live")}
          scan={() => navigate("scan")} onClose={() => setDialog("close")} refresh={() => reception.flush(true)}
          onReopen={() => setReopen(true)} />}
        {(view === "scan" || view === "review") && (!detail || !index || !result) && <section className="panel">
          <Empty title={loading ? "Cargando jornada…" : "Abre una jornada para empezar"}
            icon={view === "scan" ? ScanLine : ListChecks} action={!loading && <div className="empty-actions">
              {manager && <button className="button primary" type="button" onClick={() => setDialog("import")}><Plus size={18} /> Nuevo manifiesto</button>}
              {history.receipts.length > 0 && <button className="button plain" type="button" onClick={() => navigate("history")}>Ver historial <ArrowRight size={17} /></button>}</div>}>
            {loading ? "Consultando el manifiesto." : "Carga un manifiesto o selecciona una recepción del historial."}</Empty>
        </section>}
        {view === "scan" && detail && index && result && <Scanner key={detail.receipt.id} index={index} audit={result} box={box} feedback={feedback} onRead={scan} onBox={activateBox}
          onUndo={() => {
            if (lastPiece && !receipt?.closedAt && !receipt?.pausedAt) {
              reception.enqueue({ ...newOperation(), kind: "undo", target: lastPiece.op.id });
              inform("Anulación por sincronizar", "warn", lastPiece.op.code);
            }
          }} onIssue={() => setDialog("issue")} closed={Boolean(receipt?.closedAt)} canceled={Boolean(receipt?.canceled)} canUndo={Boolean(lastPiece)} paused={Boolean(receipt?.pausedAt)} confirm={reception.confirm} pending={pendingIds} owner={lease?.name} actorId={actor.id} ownScans={!manager} />}
        {view === "review" && manager && detail && index && confirmed && <ReconcileView key={detail.receipt.id} detail={detail} index={index} audit={confirmed} onClose={actor.canClose ? () => setDialog("close") : undefined}
          onExport={exportFromReview} onVerify={(line, status) => setVerification({ line, status })} exporting={exporting} />}
        {view === "review" && actor.canClose && receipt?.closedAt && !receipt.archived && !receipt.canceled && index && confirmed &&
          <TransferForm id={receipt.id} index={index} audit={confirmed} />}
        <footer className="site-foot">
          <div><strong>El Puerto de Liverpool</strong><small>Uso interno · Control de mercancía</small></div>
          <span>Tecnología aplicada a la eficiencia operativa</span>
        </footer>
      </main>
    </div>
    {reopen && receipt && <Dialog title="Reabrir jornada" intro="Registra el motivo antes de volver a recibir lecturas." onDismiss={() => setReopen(false)}>
      <form className="team-form" onSubmit={async event => {
        event.preventDefault();
        const note = new FormData(event.currentTarget).get("note");
        setSessionError("");
        try {
          await request("/api/recepcion", { action: "reopen", id: receipt.id, note, device: browserDevice() });
          setReopen(false);
          await reception.flush(true);
        } catch (reason) { setSessionError(reason instanceof Error ? reason.message : "No se pudo reabrir."); }
      }}>
        <label className="field">Motivo<textarea required name="note" maxLength={500} /></label>
        {sessionError && <p className="notice error" role="alert">{sessionError}</p>}
        <button className="button primary" type="submit">Autorizar reapertura</button>
      </form>
    </Dialog>}
    {dialog === "import" && manager && <ImportDialog dismiss={() => setDialog(null)} onCreate={create} signedIn={Boolean(actor)} />}
    {dialog === "issue" && <IssueDialog box={box} dismiss={() => setDialog(null)} add={(type, code, qty, note) => {
      if (!receipt?.closedAt && !receipt?.pausedAt) {
        reception.enqueue({ ...newOperation(), kind: "issue", type, code, qty, note, box });
        inform("Incidencia por sincronizar", "warn", code);
      }
      setDialog(null);
    }} />}
    {dialog === "close" && actor.canClose && confirmed && <CloseDialog totals={detail?.live?.totals ?? confirmed.totals} dismiss={() => setDialog(null)} onClose={async (note, acknowledged) => {
      await reception.finish({ action: "close", note, acknowledged });
      navigate("review");
      setExportReady(null);
      setExportError("");
      setDialog("report");
    }} />}
    {dialog === "report" && receipt?.closedAt && !receipt.canceled && result && <ClosureReportDialog
      title={receipt.title} totals={receipt.totals ?? result.totals} spreadsheet={currentExport?.seproOnly === false ? currentExport : null}
      exporting={exporting} error={exportError} generate={() => void exportReport()} dismiss={() => setDialog(null)} />}
    {dialog === "cancel" && actor.canClose && receipt && result && <CancelDialog title={receipt.title} scanned={detail?.live?.totals.scanned ?? result.totals.scanned}
      dismiss={() => setDialog(null)} onCancel={async () => {
        await reception.finish({ action: "cancel" });
        setDialog(null);
        navigate("home");
      }} />}
    {verification && detail && result && <VerifyDialog item={detail.rows[verification.line]} status={verification.status}
      qty={detail.rows[verification.line].qty - result.received[verification.line]} dismiss={() => setVerification(null)} onConfirm={note => {
        reception.enqueue({ ...newOperation(), kind: "verify", line: verification.line, status: verification.status, note });
        setVerification(null);
      }} />}
    {dialog === "help" && <Dialog title="Guía rápida" intro="De la hoja de recepción al reporte de cierre." onDismiss={() => setDialog(null)}>
      <ol className="help-list">
        <li><strong>Carga el manifiesto.</strong><p>Sube un Excel o copia los datos de PEGAR_HOY con sus encabezados.</p></li>
        <li><strong>Escanea cada caja y sus piezas.</strong><p>Usa el lector portátil o la cámara. El contenedor activo aparece arriba del campo de captura.</p></li>
        <li><strong>Concilia y cierra.</strong><p>Revisa faltantes, sobrantes y distribución por caja. Descarga el Excel al terminar.</p></li>
        <li><strong>Verifica los pendientes de SEPRO.</strong><p>Confirma la falta física antes de exportar el listado y registra el estado del reporte.</p></li>
      </ol>
      <footer className="dialog-actions"><button className="button secondary" onClick={() => setDialog(null)}>Cerrar</button></footer>
    </Dialog>}
  </div>;
}
