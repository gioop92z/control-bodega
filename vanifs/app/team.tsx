"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, ClipboardCheck, Copy, LockKeyhole, QrCode, ScanLine, Search, Users } from "lucide-react";
import { moduleUrl } from "../lib/recepcion/transport";
import { browserDevice, request } from "../lib/recepcion/client";
import { codeKey, type Detail, type History, type Receipt, type Role, type TeamActor } from "../lib/recepcion/model";
import { Dialog, Empty, number, showTime, Status } from "./ui";

function journeyUrl(id: string, invite?: string) {
  const url = moduleUrl();
  url.searchParams.set("jornada", id);
  if (invite) url.hash = new URLSearchParams({ invitacion: invite }).toString();
  return url.href;
}

const roles = { admin: "Administrador", supervisor: "Supervisor", collaborator: "Colaborador" };
const errorText = (error: unknown) => error instanceof Error ? error.message : "Intenta de nuevo.";

function ShareField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="team-form">
    <label className="field">{label}<input readOnly value={value} onFocus={event => event.currentTarget.select()} /></label>
    <button className="button secondary" type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setCopied(false); }
    }}><Copy size={16} /> {copied ? "Copiado" : "Copiar"}</button>
  </div>;
}

function ShareDialog({ url, code, dismiss }: { url: string; code?: string; dismiss: () => void }) {
  const [qr, setQr] = useState<{ size: number; path: string }>();
  useEffect(() => {
    let active = true;
    void import("@zxing/library").then(({ QRCodeWriter, BarcodeFormat }) => {
      const matrix = new QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, 1, 1, new Map());
      const size = matrix.getWidth();
      const pixels: string[] = [];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (matrix.get(x, y)) pixels.push("M" + x + " " + y + "h1v1h-1z");
      }
      if (active) setQr({ size, path: pixels.join("") });
    }).catch(() => {});
    return () => { active = false; };
  }, [url]);
  return <Dialog title={code ? "Compartir jornada" : "Invitación individual"}
    intro={code ? "El QR abre la jornada a quienes ya tienen acceso." : "Envía este enlace en privado al correo autorizado."} onDismiss={dismiss}>
    {qr && <svg className="team-qr" role="img" aria-label="Código QR de acceso" shapeRendering="crispEdges" viewBox={"0 0 " + qr.size + " " + qr.size}>
      <rect width={qr.size} height={qr.size} fill="white" /><path fill="#251b2b" d={qr.path} />
    </svg>}
    <ShareField value={url} label={code ? "Enlace de la jornada" : "Enlace de invitación"} />
    {code && <ShareField value={code} label="Código de jornada" />}
    <footer className="dialog-actions"><button className="button primary" type="button" onClick={dismiss}>Listo</button></footer>
  </Dialog>;
}

type Member = Pick<TeamActor, "id" | "name" | "email" | "role"> & { canClose: number };

export function LiveView({ actor, detail, receipts, select, scan, onClose, refresh, onReopen }: {
  actor: TeamActor; detail: Detail | null; receipts: Receipt[]; select: (item: Receipt) => void; scan: () => void;
  onClose: () => void; refresh: () => Promise<unknown>; onReopen: () => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Receipt[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [share, setShare] = useState<{ url: string; code?: string }>();
  const [members, setMembers] = useState<Member[]>([]);
  const receipt = detail?.receipt;
  const live = detail?.live;
  const admin = actor.role === "admin";
  const boxes = [...new Set([...detail?.rows.map(row => codeKey(row.box)).filter(Boolean) ?? [], ...live?.leases.map(lease => lease.box) ?? []])];
  const connected = live?.presence.filter(person => Date.now() - person.seenAt < 45000) ?? [];
  const pending = live?.presence.filter(person => person.pending > 0) ?? [];

  useEffect(() => { setMembers([]); setError(""); setShare(undefined); }, [receipt?.id]);

  async function loadMembers() {
    if (!receipt || actor.role === "collaborator") return;
    try { setMembers((await request<{ members: Member[] }>("/api/equipo?id=" + receipt.id)).members); }
    catch (reason) { setError(errorText(reason)); }
  }

  async function manage(action: Record<string, unknown>) {
    if (!receipt) return;
    setBusy(true); setError("");
    try {
      const result = await request<{ code?: string }>("/api/equipo", { ...action, id: receipt.id, device: browserDevice() });
      if (result.code) setShare({ url: journeyUrl(receipt.id, result.code) });
      else { await refresh(); if (action.action === "role" || action.action === "remove") await loadMembers(); }
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void manage({ action: "invite", email: form.get("email"), role: form.get("role"), canClose: form.has("canClose") });
  }

  return <>
    <section className="panel team-panel">
      <form className="team-form" onSubmit={async event => {
        event.preventDefault(); setError("");
        try { setFound(query.trim() ? (await request<History>("/api/recepcion?q=" + encodeURIComponent(query.trim()))).receipts : null); }
        catch (reason) { setError(errorText(reason)); }
      }}>
        <label className="field">Buscar jornada por nombre o código<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Recepción zapatería" /></label>
        <button className="button secondary"><Search size={17} /> Buscar</button>
      </form>
      <div className="team-actions">
        {(found ?? receipts.filter(item => !item.closedAt).slice(0, 6)).map(item => <button key={item.id} type="button" className="button secondary" aria-pressed={item.id === receipt?.id} onClick={() => select(item)}>{item.title}</button>)}
        {found?.length === 0 && <p className="field-hint">Sin jornadas autorizadas para esa búsqueda.</p>}
      </div>
    </section>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!receipt || !live ? <section className="panel"><Empty title="Selecciona una jornada" icon={Users}>Aquí verás el avance que comparte todo el equipo.</Empty></section> : <>
      <section className="panel team-panel">
        <header className="panel-heading">
          <div className="section-icon"><Users size={21} /></div>
          <div><h2>{receipt.title}</h2><p>Datos confirmados en servidor · {new Set(connected.map(person => person.id)).size} conectados</p></div>
          <Status receipt={receipt} />
        </header>
        <div className="team-metrics">
          {[
            ["Esperadas", live.totals.expected], ["Registradas", live.totals.scanned], ["Conciliadas", live.totals.matched],
            [receipt.closedAt ? "Faltantes al cierre" : "Pendientes", live.totals.missing], ["Sobrantes", live.totals.extra],
            ["Cajas procesadas", live.processed + " / " + receipt.boxCount],
          ].map(([label, value]) => <div key={label}><strong>{typeof value === "number" ? number.format(value) : value}</strong><span>{label}</span></div>)}
        </div>
        <div className="team-progress">
          <strong>{live.totals.expected ? Math.floor(live.totals.matched * 100 / live.totals.expected) : 0}% conciliado</strong>
          <progress aria-label="Avance global" value={live.totals.matched} max={live.totals.expected || 1} />
          <p>{live.latest ? "Última lectura · " + [live.latest.code, live.latest.name, showTime(live.latest.at)].filter(Boolean).join(" · ") : "Aún no hay lecturas."}</p>
        </div>
        <div className="team-actions">
          {!receipt.closedAt && !receipt.pausedAt && <button className="button primary" type="button" onClick={scan}><ScanLine size={17} /> Abrir escáner</button>}
          <button className="button secondary" type="button" onClick={() => setShare({ url: journeyUrl(receipt.id), code: receipt.id })}><QrCode size={17} /> Enlace y QR</button>
          {actor.canClose && !receipt.closedAt && <>
            <button className="button secondary" type="button" disabled={busy} onClick={() => void manage({ action: "pause", paused: !receipt.pausedAt })}>{receipt.pausedAt ? "Reanudar" : "Pausar"}</button>
            <button className="button secondary" type="button" onClick={onClose}><ClipboardCheck size={17} /> Cerrar jornada</button>
          </>}
          {actor.canClose && receipt.closedAt && !receipt.archived && !receipt.canceled &&
            <button className="button secondary" type="button" onClick={onReopen}>Reabrir jornada</button>}
          {admin && <button className="button plain" type="button" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const [detail, audit] = await Promise.all([
                request("/api/recepcion?id=" + receipt.id), request("/api/equipo?view=audit&id=" + receipt.id),
              ]);
              const file = new Blob([JSON.stringify({ format: "vanifs-vantis-v1", detail, audit })], { type: "application/json" });
              const url = URL.createObjectURL(file);
              const link = document.createElement("a"); link.href = url; link.download = "VANIFS-" + receipt.id + ".json"; link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1500);
            } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo descargar."); }
            finally { setBusy(false); }
          }}>Descargar respaldo</button>}
        </div>
        {!receipt.closedAt && !receipt.pausedAt && actor.canClose && connected.some(person => person.id !== actor.id) &&
          <p className="field-hint">Pausa la jornada y espera a que el equipo sincronice antes de cerrar.</p>}
        {pending.length > 0 && <p className="notice warn" role="status">Por sincronizar · {pending.map(person => person.name + " (" + person.pending + ")").join(", ")}.</p>}
      </section>
      <section className="panel team-panel">
        <h2>Productividad del equipo</h2>
        <label className="field">Filtrar colaborador o contenedor<input value={filter} onChange={event => setFilter(event.target.value)} /></label>
        <ul className="team-roster">{[...new Set([...live.people.map(person => person.id), ...connected.map(person => person.id)])].map(id => {
          const stats = live.people.find(person => person.id === id);
          const devices = connected.filter(person => person.id === id);
          const name = stats?.name ?? devices[0]?.name ?? "";
          if (filter && ![name, ...(stats?.boxes ?? [])].some(value => value.toLowerCase().includes(filter.toLowerCase()))) return null;
          const seconds = stats ? (Date.parse(stats.last) - Date.parse(stats.first)) / 1000 : 0;
          const active = stats && Date.now() - Date.parse(stats.last) < 30000;
          return <li key={id}><div><strong>{stats?.name ?? devices[0]?.name}</strong>
            <small>{devices.map(person => person.device).join(", ") || "Sin conexión"}{stats ? " · " + showTime(stats.last) : ""}{active ? " · Escaneando" : ""}</small></div>
            <span>{number.format(stats?.pieces ?? 0)} piezas · {number.format(stats?.boxes.length ?? 0)} cajas{seconds >= 60 ? " · " + number.format(Math.round(stats!.pieces * 3600 / seconds)) + " pzas/h" : ""}</span></li>;
        })}</ul>
      </section>
      <section className="panel team-panel">
        <h2>Contenedores activos</h2>
        {live.leases.length ? <ul className="team-roster">{live.leases.map(item => <li key={item.box}><strong>{item.box}</strong><span>{item.name}</span></li>)}</ul>
          : <p className="field-hint">Las asignaciones aparecen cuando el equipo selecciona una caja.</p>}
      </section>
      {admin && !receipt.closedAt && <details className="panel team-panel" key={receipt.id}>
        <summary>Invitar colaborador</summary>
        <p className="field-hint">Usa su correo Liverpool o Gmail autorizado. La invitación es de un solo uso y vence en 24 horas.</p>
        <form className="team-form" onSubmit={invite}>
          <label className="field">Correo autorizado<input name="email" type="email" required /></label>
          <label className="field">Rol<select name="role"><option value="collaborator">Colaborador</option><option value="supervisor">Supervisor</option>{actor.platformOwner && <option value="admin">Administrador</option>}</select></label>
          <label className="checkbox"><input name="canClose" type="checkbox" /> Permitir cierre a supervisión</label>
          <button className="button primary" disabled={busy}>Generar invitación</button>
        </form>
      </details>}
      {actor.role !== "collaborator" && <details className="panel team-panel" onToggle={event => { if (event.currentTarget.open) void loadMembers(); }}>
        <summary>Accesos y asignaciones</summary>
        <ul className="team-roster">{members.map(member => <li key={member.id}>
          <div><strong>{member.name}</strong><small>{member.email} · {roles[member.role]}</small></div>
          {admin && member.id !== actor.id && (member.role !== "admin" || actor.platformOwner) &&
            <details className="team-member"><summary>Permisos</summary>
              <form className="team-form" key={member.role + member.canClose} onSubmit={event => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                if (window.confirm("¿Cambiar el rol de " + member.name + " en VANIFS?")) void manage({ action: "role", userId: member.id, role: form.get("role") as Role, canClose: form.has("canClose") });
              }}>
                <label className="field">Rol<select name="role" defaultValue={member.role}><option value="collaborator">Colaborador</option><option value="supervisor">Supervisor</option>{actor.platformOwner && <option value="admin">Administrador</option>}</select></label>
                <label className="checkbox"><input name="canClose" type="checkbox" defaultChecked={Boolean(member.canClose)} /> Permitir cierre</label>
                <button className="button secondary" disabled={busy}>Guardar rol</button>
                {member.role !== "admin" && <button className="button secondary" type="button" disabled={busy} onClick={() => {
                  if (window.confirm("¿Retirar el acceso de " + member.name + " a esta jornada?")) void manage({ action: "remove", userId: member.id });
                }}>Retirar acceso</button>}
              </form>
            </details>}
        </li>)}</ul>
        {actor.canClose && !receipt.closedAt && <form className="team-form" onSubmit={event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void manage({ action: "assign", box: form.get("box"), userId: form.get("user") || null });
        }}>
          <label className="field">Contenedor<select name="box" required><option value="">Seleccionar</option>{boxes.map(box => <option key={box}>{box}</option>)}</select></label>
          <label className="field">Responsable<select name="user"><option value="">Liberar caja</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          <button className="button secondary" disabled={busy}>Guardar asignación</button>
        </form>}
      </details>}
    </>}
    {share && <ShareDialog {...share} dismiss={() => setShare(undefined)} />}
  </>;
}
