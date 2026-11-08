"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowRight, Box, FileSpreadsheet, PackageCheck, PackageOpen, ScanLine, X, type LucideIcon } from "lucide-react";
import { incidentCount, type Receipt, type Totals } from "../lib/recepcion/model";

export const number = new Intl.NumberFormat("es-MX");
const dateTime = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" });
const time = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Mexico_City" });
export const showDate = (date: string) => dateTime.format(new Date(date));
export const showTime = (date: string) => time.format(new Date(date));
export const percent = (total: Totals) => total.expected ? Math.floor(total.matched / total.expected * 100) : 0;

export function Brand({ mobile = false, goHome }: { mobile?: boolean; goHome: () => void }) {
  return <button type="button" className={mobile ? "brand mobile-brand" : "brand"} onClick={goHome} aria-label="VANIFS · Inicio">
    <span className="brand-main">
      <span className="brand-mark"><PackageCheck size={22} strokeWidth={1.8} /></span>
      <img className="brand-wordmark" src="./vanifs-wordmark.svg" alt="" width={254} height={71} />
    </span>
    <small>RECEPCIÓN INTELIGENTE DE MERCANCÍA</small>
  </button>;
}

export function Status({ receipt }: { receipt: Receipt }) {
  if (receipt.canceled) return <span className="pill canceled-pill"><i /> Cancelada</span>;
  if (!receipt.closedAt && receipt.pausedAt) return <span className="pill warn-pill"><i /> Pausada</span>;
  if (!receipt.closedAt) return <span className="pill live-pill"><i /> En curso</span>;
  return receipt.totals && incidentCount(receipt.totals)
    ? <span className="pill warn-pill"><i /> Con incidencias</span>
    : <span className="pill good-pill"><i /> Completo 100%</span>;
}

export function Empty({ title, children, action, icon: Icon = PackageOpen }: { title: string; children: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
  return <div className="empty">
    <span className="empty-icon"><Icon size={23} /></span>
    <h3>{title}</h3>
    <p>{children}</p>
    {action}
  </div>;
}

export function Dialog({ title, intro, children, onDismiss, className = "" }: {
  title: string; intro?: string; children: ReactNode; onDismiss: () => void; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className={"dialog " + className} aria-labelledby="dialog-title"
    onCancel={event => { event.preventDefault(); onDismiss(); }}>
    <header className="dialog-heading">
      <div><h2 id="dialog-title">{title}</h2>{intro && <p>{intro}</p>}</div>
      <button className="icon-button" type="button" aria-label="Cerrar ventana" onClick={onDismiss}><X size={21} /></button>
    </header>
    {children}
  </dialog>;
}

export function WorkflowSteps({ stage }: { stage: number }) {
  const steps = [
    { name: "Cargar", description: "Excel, CSV o Google Sheets", icon: FileSpreadsheet },
    { name: "Escanear", description: "Contenedor y piezas", icon: ScanLine },
    { name: "Cerrar", description: "Conciliación y reporte", icon: Box },
  ];
  return <ol className="steps">
    {steps.map(({ name, description, icon: Icon }, i) => <li className={stage >= i ? "stage-on" : ""} key={name}>
      <span className="step-icon"><Icon size={20} /></span>
      <div><span className="step-no">0{i + 1}</span><strong>{name}</strong><small>{description}</small></div>
      {i < steps.length - 1 && <ArrowRight className="step-arrow" size={16} />}
    </li>)}
  </ol>;
}

export function ScannerIllustration() {
  return <svg className="hero-art" viewBox="0 0 392 262" fill="none" aria-hidden="true">
    <defs>
      <pattern id="grid" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M22 0H0V22" stroke="#E9DBF3" strokeWidth="1" /></pattern>
      <linearGradient id="soft" x1="70" y1="22" x2="319" y2="246" gradientUnits="userSpaceOnUse"><stop stopColor="#FEF9FF"/><stop offset="1" stopColor="#F2E4FA"/></linearGradient>
    </defs>
    <rect x="52" y="13" width="286" height="234" rx="30" fill="url(#soft)" />
    <rect x="52" y="13" width="286" height="234" rx="30" fill="url(#grid)" />
    <path d="M104 81v-25a8 8 0 0 1 8-8h25m121 0h25a8 8 0 0 1 8 8v25m0 100v25a8 8 0 0 1-8 8h-25m-121 0h-25a8 8 0 0 1-8-8v-25" stroke="#A55BB6" strokeWidth="2.2" strokeLinecap="round"/>
    <path d="m196 72 67 34v69l-67 34-67-34v-69z" fill="#fff" stroke="#562087" strokeWidth="2.8" strokeLinejoin="round"/>
    <path d="m129 106 67 34 67-34-67-34z" fill="#EAD3F4" stroke="#562087" strokeWidth="2.6" strokeLinejoin="round"/>
    <path d="m196 140 67-34v69l-67 34z" fill="#DDACE5" stroke="#562087" strokeWidth="2.6" strokeLinejoin="round"/>
    <path d="m163 89 66 34v24l-15 7v-23l-66-34" fill="#FBEBFA" stroke="#562087" strokeWidth="2.1" strokeLinejoin="round"/>
    <path d="m142 150 41 20v17l-41-20z" fill="#FFF7FD" stroke="#AC67B8" strokeWidth="1.2"/>
    <path d="m149 155 0 10m5-7 0 9m5-7 0 10m5-8 0 10m5-7 0 9m5-7 0 10" stroke="#71328E" strokeWidth="1.45" strokeLinecap="round"/>
    <path d="M91 131h211" stroke="#D8449A" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 7"/>
    <circle cx="297" cy="176" r="23" fill="#562087" stroke="#FBF2FF" strokeWidth="4"/>
    <path d="m289 176 5 5 10-11" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M76 53h12m-6-6v12m235 156h10m-5-5v10M319 57h13m-6.5-6.5v13" stroke="#9E55B6" strokeWidth="1.7" strokeLinecap="round"/>
    <circle cx="72" cy="183" r="2.4" fill="#B46FC2"/><circle cx="324" cy="114" r="2.4" fill="#B46FC2"/>
  </svg>;
}
