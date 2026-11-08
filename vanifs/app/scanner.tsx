"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { IScannerControls } from "@zxing/browser";
import { Barcode, Box, Camera, ChevronDown, CircleAlert, CircleCheck, Keyboard, PackageCheck, ScanLine, TriangleAlert, Undo2, Volume2, VolumeX } from "lucide-react";
import { type Audit, type ManifestIndex } from "../lib/recepcion/audit";
import { codeKey, type ScanSource } from "../lib/recepcion/model";
import { cameraGate, CAMERA_CONFIRMATION_MS } from "../lib/recepcion/camera";
import type { Confirmation } from "../lib/recepcion/client";
import { Dialog, Empty, number, showTime } from "./ui";

export type Feedback = {
  text: string; tone: "good" | "warn" | "error"; code?: string; at: number;
  event?: { id: string; saved: Promise<boolean> };
};
type CameraResult = { text: string; tone: Feedback["tone"] | "box"; code?: string };
type Confirmed = { sku: string; at: string };
type Green = Confirmed & { id: string; incident?: string };
const after = <T,>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));

function CameraDialog({ box, latest, onRead, confirm, onTone, dismiss }: {
  box: string; latest?: Confirmed; onRead: (code: string) => Feedback | null; confirm: (id: string) => Promise<Confirmation>;
  onTone: (tone: CameraResult["tone"]) => void; dismiss: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onRead, confirm, onTone });
  const [state, setState] = useState("Solicitando acceso a la cámara…");
  const [error, setError] = useState(false);
  const [flash, setFlash] = useState<CameraResult | null>(null);
  const [last, setLast] = useState<Confirmed>();
  const [green, setGreen] = useState<Green[]>([]);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torch, setTorch] = useState(false);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  useEffect(() => { callbacks.current = { onRead, confirm, onTone }; }, [onRead, confirm, onTone]);
  useEffect(() => {
    const element = video.current;
    let closed = false;
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout>;
    const greenTimers = new Set<ReturnType<typeof setTimeout>>();
    let controls: IScannerControls | undefined;
    let stream: MediaStream | undefined;
    const ready = cameraGate();

    function show(result: CameraResult) {
      if (closed) return;
      clearTimeout(timer);
      setFlash(result);
      callbacks.current.onTone(result.tone);
      timer = setTimeout(() => setFlash(null), CAMERA_CONFIRMATION_MS);
    }

    function confirmed(id: string, sku: string, at: string, incident?: string) {
      if (closed) return;
      setLast(prior => prior && Date.parse(prior.at) > Date.parse(at) ? prior : { sku, at });
      setGreen(prior => [...prior, { id, sku, at, incident }]);
      callbacks.current.onTone("good");
      try { navigator.vibrate?.(45); } catch {}
      const expires = setTimeout(() => {
        greenTimers.delete(expires);
        setGreen(prior => prior.filter(item => item.id !== id));
      }, CAMERA_CONFIRMATION_MS);
      greenTimers.add(expires);
    }

    async function capture(raw: string) {
      const feedback = callbacks.current.onRead(raw);
      if (!feedback) return;
      const ticket = ++sequence;
      if (!feedback.event) { show(feedback); return; }
      const id = feedback.event.id;
      const feedbackCode = feedback.code;
      show({ text: navigator.onLine ? "Guardando lectura…" : "Guardando en dispositivo…", tone: "warn", code: feedback.code });
      const confirmation = callbacks.current.confirm(id);
      function display(result: Confirmation) {
        if (closed) return false;
        const { ack, error } = result;
        if (ack?.result === "Recibida" || ack?.result === "Sobrante") {
          if (ticket === sequence) setFlash(null);
          confirmed(id, ack.sku ?? raw, ack.at, ack.result === "Sobrante" ? "Sobrante registrado" : undefined);
          return true;
        }
        if (ticket !== sequence) return Boolean(ack || error);
        if (ack?.result === "Caja activa") show({ text: "Contenedor activo", tone: "box", code: ack.sku ?? raw });
        else if (ack) show({ text: ack.result + " · registrada", tone: "warn", code: ack.sku ?? raw });
        else if (error) show({ text: error, tone: "error", code: feedbackCode });
        return Boolean(ack || error);
      }
      const [saved, result] = await Promise.all([
        Promise.race([feedback.event.saved, after(900, false)]),
        Promise.race([confirmation, after<Confirmation>(1150, {})]),
      ]);
      if (closed || display(result)) return;
      if (ticket === sequence) show({
        text: saved ? "PENDIENTE DE SINCRONIZAR" : "Sin confirmación de guardado",
        tone: saved ? "warn" : "error", code: feedback.code,
      });
      void confirmation.then(display);
    }

    async function start() {
      try {
        if (!element || !navigator.mediaDevices?.getUserMedia) throw new Error("Abre el enlace del sitio en Safari o Chrome para usar la cámara.");
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (closed) return;
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
          facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 },
        } });
        if (closed) { stream.getTracks().forEach(track => track.stop()); return; }
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { focusMode?: string[]; torch?: boolean } | undefined;
        setTorchAvailable(Boolean(capabilities?.torch));
        if (capabilities?.focusMode?.includes("continuous")) {
          void track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
        }
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanSuccess: 180, delayBetweenScanAttempts: 110 });
        controls = await reader.decodeFromStream(stream, element, result => {
          if (closed) return;
          const code = result?.getText() ?? "";
          if (ready(codeKey(code), performance.now())) void capture(code);
        });
        if (closed) controls.stop();
        else setState("Listo para escanear · centra el código.");
      } catch (reason) {
        stream?.getTracks().forEach(track => track.stop());
        if (!closed) {
          setError(true);
          setState(reason instanceof DOMException && reason.name === "NotAllowedError"
            ? "Permite el acceso a la cámara en tu navegador y vuelve a abrir el lector."
            : reason instanceof DOMException && reason.name === "NotFoundError" ? "No se encontró una cámara en este dispositivo."
              : reason instanceof Error ? reason.message : "No se pudo abrir la cámara.");
        }
      }
    }
    const resume = () => { if (!document.hidden && element?.srcObject) void element.play().catch(() => {}); };
    document.addEventListener("visibilitychange", resume);
    void start();
    return () => {
      closed = true;
      clearTimeout(timer);
      for (const expires of greenTimers) clearTimeout(expires);
      document.removeEventListener("visibilitychange", resume);
      controls?.stop();
      stream?.getTracks().forEach(track => track.stop());
      trackRef.current = null;
      if (element) element.srcObject = null;
    };
  }, []);
  const recent = last && (!latest || Date.parse(last.at) >= Date.parse(latest.at)) ? last : latest;
  const latestGreen = green.at(-1);
  const visible = latestGreen ? { text: "CONFIRMADO", tone: "good", code: latestGreen.sku } : flash;
  return <Dialog title="Escanear con cámara" intro="Lee el contenedor y después los códigos de las piezas." onDismiss={dismiss} className="camera-dialog">
    <div className="camera-frame">
      <video ref={video} muted playsInline autoPlay />
      {!error && <div className={"camera-reticle" + (visible ? " camera-confirmation " + visible.tone : "")} aria-hidden="true">
        {visible ? <div>{visible.tone === "good" ? <CircleCheck size={28} /> : visible.tone === "box" ? <Box size={25} /> : <CircleAlert size={25} />}
          <strong>{visible.text}</strong>{visible.code && <b>{visible.tone === "good" ? "SKU " : ""}{visible.code}</b>}</div> : <><span /><i /></>}
      </div>}
    </div>
    {green.length > 0 && <ul className="camera-acknowledgments" aria-live="polite">{green.map(item =>
      <li key={item.id}><CircleCheck size={16} /> CONFIRMADO · SKU {item.sku}{item.incident ? " · " + item.incident : ""}</li>)}</ul>}
    <p className={"notice camera-status " + (error || flash?.tone === "error" ? "error" : flash?.tone === "good" ? "success" : flash?.tone === "warn" ? "warn" : "")}
      role="status" aria-atomic="true">{flash ? [flash.text, flash.code].filter(Boolean).join(" · ") : state}</p>
    {recent && <div className="camera-last"><CircleCheck size={18} /><div><span>Último SKU confirmado</span><strong>{recent.sku}</strong></div>
      <time dateTime={recent.at}>{showTime(recent.at)}</time></div>}
    <div className="camera-meta"><Box size={18} /><strong>{box || "Sin contenedor activo"}</strong><span>Retira la etiqueta del recuadro antes de leer otra pieza con el mismo código.</span></div>
    <footer className="dialog-actions">
      {torchAvailable && <button className="button secondary" type="button" aria-pressed={torch} onClick={() => {
        void trackRef.current?.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] })
          .then(() => setTorch(!torch)).catch(() => setState("La luz de la cámara no está disponible."));
      }}>{torch ? "Apagar luz" : "Encender luz"}</button>}
      <button className="button secondary" type="button" onClick={dismiss}>Volver al lector</button>
    </footer>
  </Dialog>;
}

export function Scanner({ index, audit, box, feedback, onRead, onBox, onUndo, onIssue, closed, canceled, canUndo, paused, confirm, pending, owner, actorId, ownScans }: {
  index: ManifestIndex; audit: Audit; box: string; feedback: Feedback | null;
  onRead: (code: string, source: ScanSource) => Feedback | null;
  onBox: (box: string) => void;
  onUndo: () => void; onIssue: () => void; closed: boolean; canceled: boolean; canUndo: boolean; paused: boolean;
  confirm: (id: string) => Promise<Confirmation>; pending: Set<string>; owner?: string; actorId: string; ownScans: boolean;
}) {
  const [value, setValue] = useState("");
  const [manual, setManual] = useState(false);
  const [camera, setCamera] = useState(false);
  const [newBox, setNewBox] = useState(false);
  const [boxValue, setBoxValue] = useState("");
  const [sound, setSound] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const audio = useRef<AudioContext | undefined>(undefined);
  const handler = useRef(onRead);
  useEffect(() => { handler.current = onRead; }, [onRead]);
  useEffect(() => { if (!camera && !closed && !paused) field.current?.focus({ preventScroll: true }); }, [camera, closed, paused]);
  useEffect(() => () => { clearTimeout(timer.current); void audio.current?.close().catch(() => {}); }, []);
  const active = index.boxes.get(codeKey(box));
  const found = ownScans
    ? audit.scans.filter(item => codeKey(item.op.box) === codeKey(box) && !pending.has(item.op.id)
      && item.result !== "Anulada" && (item.op.scanResult ?? item.result) === "Recibida").length
    : active?.lines.reduce((sum, line) => sum + audit.received[line], 0) ?? 0;
  const expected = active?.lines.reduce((sum, line) => sum + index.rows[line].qty, 0) ?? 0;
  const recent = audit.scans.slice(-16).reverse();

  const cameraScan = audit.scans.findLast(item => item.op.actor.id === actorId && item.op.source === "Cámara"
    && item.result !== "Anulada" && (item.op.scanResult ?? item.result) === "Recibida" && !pending.has(item.op.id));
  const latest = cameraScan ? { sku: cameraScan.op.registeredSku ?? cameraScan.op.code, at: cameraScan.op.recordedAt ?? cameraScan.op.at } : undefined;

  function activateAudio() {
    if (!window.AudioContext) return;
    audio.current ??= new AudioContext();
    void audio.current.resume().catch(() => {});
  }

  function beep(result: CameraResult["tone"]) {
    const context = audio.current;
    if (sound && context?.state === "running") {
      const tone = context.createOscillator();
      const volume = context.createGain();
      tone.frequency.value = result === "good" || result === "box" ? 870 : 365;
      volume.gain.setValueAtTime(0.08, context.currentTime);
      volume.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.11);
      tone.connect(volume).connect(context.destination);
      tone.start();
      tone.stop(context.currentTime + 0.12);
    }
  }

  function capture(raw: string, source: ScanSource) {
    clearTimeout(timer.current);
    setValue("");
    if (raw.trim() && !closed && !paused) handler.current(raw, source);
    field.current?.focus();
  }

  function toggleMode() {
    clearTimeout(timer.current);
    setValue("");
    setManual(value => !value);
    field.current?.focus();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    capture(value, manual ? "Manual" : "Lector");
  }

  return <div className="scanner-grid">
    <div className="scanner-stack">
      <section className="panel scan-panel">
        <header className="panel-heading">
          <div className="section-icon"><ScanLine size={22} /></div>
          <div><h2>Estación de escaneo</h2><p>Un código de pieza por lectura.</p></div>
          <button className="icon-button sound" type="button" aria-label={sound ? "Silenciar lecturas" : "Activar sonido de lecturas"} aria-pressed={sound}
            onClick={() => { if (!sound) activateAudio(); setSound(!sound); }}>{sound ? <Volume2 size={19} /> : <VolumeX size={19} />}</button>
        </header>
        {paused && !closed ? <p className="notice warn">La jornada está pausada.</p> : closed ? <p className="notice"><CircleCheck size={19} /> {canceled ? "Esta jornada está cancelada. Consulta la conciliación para revisar las lecturas." : "Esta jornada está cerrada. Consulta la conciliación para revisar el resultado."}</p> : <>
          <div className={"active-box " + (box ? "has-box" : "")}>
            <div className="active-box-icon"><Box size={23} /></div>
            <div className="box-info"><span className="eyebrow">CONTENEDOR ACTIVO</span><strong>{box || (index.boxes.size ? "Selecciona o escanea una caja" : "Sin caja")}</strong>
              <small>{active ? number.format(found) + " / " + number.format(expected) + (ownScans ? " piezas conciliadas por ti" : " piezas conciliadas")
                : box ? "Caja fuera del manifiesto" : "Las lecturas se asignan a esta caja."}{owner ? " · Responsable: " + owner : ""}</small></div>
            {index.boxes.size > 0 && <div className="box-select"><select aria-label="Seleccionar contenedor" value={active ? codeKey(box) : box ? "__external" : ""}
              onChange={event => {
                const key = event.target.value;
                if (key === "__new") { setBoxValue(""); setNewBox(true); }
                else if (key !== "__external") { onBox(key === "__loose" ? "" : index.boxes.get(key)?.label ?? ""); field.current?.focus(); }
              }}>
              <option value="" disabled>Seleccionar</option>
              {[...index.boxes].map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
              {index.hasLooseRows && <option value="__loose">Sin caja</option>}
              {box && !active && <option value="__external">{box}</option>}
              <option value="__new">Otra caja…</option>
            </select><ChevronDown size={15} /></div>}
          </div>
          <div className="scan-tools">
            <span className="field-label">{manual ? "Ingresar código manualmente" : "Lector portátil"}</span>
            <button className="text-button" type="button" onClick={toggleMode}><Keyboard size={16} />{manual ? "Usar lector" : "Captura manual"}</button>
          </div>
          <form className="scan-field" onSubmit={submit}>
            <Barcode size={24} />
            <input ref={field} value={value} aria-label="Código de contenedor, SKU o UPC" placeholder="Escanea o escribe un código"
              inputMode={manual ? "text" : "none"} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} maxLength={180}
              onFocus={() => { if (sound) activateAudio(); }}
              onChange={event => {
                const text = event.target.value;
                setValue(text);
                clearTimeout(timer.current);
                if (!manual && text.trim() && !(event.nativeEvent as InputEvent).isComposing) {
                  timer.current = setTimeout(() => capture(field.current?.value ?? text, "Lector"), 150);
                }
              }}
              onKeyDown={event => {
                if (!manual && event.key === "Tab" && value.trim()) { event.preventDefault(); capture(value, "Lector"); }
                if (event.key === "Escape") { clearTimeout(timer.current); setValue(""); }
              }} />
            {manual && <button className="button primary" type="submit" disabled={!value.trim()}>Registrar</button>}
          </form>
          <p className="field-hint">{manual ? "Escribe el código completo y pulsa Registrar." : "Coloca el cursor en el campo. El lector guarda la lectura automáticamente."}</p>
          {feedback && <div className={"scan-feedback " + feedback.tone} role="status" key={feedback.at}>
            {feedback.tone === "good" ? <CircleCheck size={20} /> : <CircleAlert size={20} />}
            <div><strong>{feedback.text}</strong>{feedback.code && <span>{feedback.code}</span>}</div>
          </div>}
          <div className="scan-buttons">
            <button className="button primary" type="button" onClick={() => { if (sound) activateAudio(); setCamera(true); }}><Camera size={18} /> Abrir cámara</button>
            <button className="button secondary" type="button" disabled={!canUndo} onClick={() => { onUndo(); field.current?.focus(); }}><Undo2 size={17} /> Deshacer lectura</button>
            <button className="button secondary" type="button" onClick={onIssue}><TriangleAlert size={17} /> Incidencia</button>
          </div>
        </>}
      </section>
    </div>
    <section className="panel recent-panel">
      <header className="panel-heading"><div className="section-icon"><PackageCheck size={21} /></div><div><h2>Lecturas recientes</h2><p>{pending.size ? number.format(pending.size) + " por sincronizar" : "Lecturas registradas"}</p></div></header>
      {recent.length ? <ol className="recent">
        {recent.map(item => {
          const status = pending.has(item.op.id) ? "Pendiente de sincronizar" : item.result === "Anulada" ? item.result : item.op.scanResult ?? item.result;
          const time = item.op.recordedAt ?? item.op.at;
          return <li key={item.op.id}>
            <span className={"event-icon " + (status === "Recibida" ? "good" : status === "Caja activa" ? "neutral" : "warn")}>
              {status === "Caja activa" ? <Box size={17} /> : status === "Recibida" ? <CircleCheck size={17} /> : <CircleAlert size={17} />}
            </span>
            <div><strong>{item.op.code}</strong><span>{status}{status !== "Caja activa" && item.op.box ? " · " + item.op.box : ""}</span></div>
            <time dateTime={time}>{showTime(time)}</time>
          </li>;
        })}
      </ol> : <Empty title="Aún no hay lecturas" icon={Barcode}>Las cajas, piezas y correcciones aparecerán aquí.</Empty>}
    </section>
    {camera && !closed && !paused && <CameraDialog box={box} latest={latest} onRead={code => handler.current(code, "Cámara")}
      confirm={confirm} onTone={beep} dismiss={() => setCamera(false)} />}
    {newBox && <Dialog title="Registrar otra caja" intro="Indica el código que aparece en la caja física." onDismiss={() => setNewBox(false)}>
      <form onSubmit={event => {
        event.preventDefault();
        if (boxValue.trim()) { onBox(boxValue.trim()); setNewBox(false); }
      }}>
        <label className="field">Código de la caja<input value={boxValue} onChange={event => setBoxValue(event.target.value)} maxLength={90} required /></label>
        <footer className="dialog-actions"><button className="button primary" type="submit" disabled={!boxValue.trim()}>Activar caja</button></footer>
      </form>
    </Dialog>}
  </div>;
}
