import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { ArrowLeft, Boxes, ScanLine, ShieldCheck } from "lucide-react";
import { environment, inventoryUrl, moduleUrl, rpc, supabase } from "../lib/recepcion/transport";
import type { TeamActor } from "../lib/recepcion/model";
import Vanifs from "./vanifs";
import { Brand } from "./ui";

type Account = TeamActor & { inventoryRole?: string; employeeNumber?: string };
const key = "vanifs:profile:" + environment;
const inviteKey = "vanifs:invite:" + environment;
const token = new URLSearchParams(location.hash.slice(1)).get("invitacion");
if (token && /^[0-9a-f]{64}$/i.test(token)) {
  try { localStorage.setItem(inviteKey, token); } catch {}
  history.replaceState(null, "", location.pathname + location.search);
}

function stored<T>(name: string): T | null {
  try { return JSON.parse(localStorage.getItem(name) ?? "null") as T | null; } catch { return null; }
}

function Invite({ complete, code }: { complete: (id: string) => void; code: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function join(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { receiptId } = await rpc<{ receiptId: string }>("access", "join", { name, code });
      try { localStorage.removeItem(inviteKey); } catch {}
      complete(receiptId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo aceptar la invitación."); }
    finally { setBusy(false); }
  }
  return <form className="team-form" onSubmit={join}>
    <h2>Activar invitación</h2>
    <label className="field">Nombre de operador<input value={name} onChange={e => setName(e.target.value)} required maxLength={140} autoComplete="name" /></label>
    {error && <p className="notice error" role="alert">{error}</p>}
    <button className="button primary" disabled={busy}>Aceptar y ver jornada</button>
  </form>;
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  async function connect(method: "email" | "google") {
    setBusy(true);
    setStatus("");
    setError(false);
    try {
      const target = moduleUrl("inicio").href;
      if (method === "google") {
        const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: target } });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: target } });
        if (error) throw error;
        setStatus("Revisa tu correo para abrir el enlace de acceso.");
      }
    } catch {
      setError(true);
      setStatus("No se pudo iniciar el acceso. Verifica tu cuenta con administración y vuelve a intentar.");
    } finally { setBusy(false); }
  }
  return <>
    <h1>Acceso individual a VANTIS</h1>
    <p>Usa el correo Gmail o Liverpool que administración autorizó para tu equipo.</p>
    <button type="button" className="button secondary" disabled={busy} onClick={() => void connect("google")}>
      <ShieldCheck size={18} /> Entrar con Google
    </button>
    <form className="team-form" onSubmit={event => { event.preventDefault(); void connect("email"); }}>
      <label className="field">Correo autorizado<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required /></label>
      <button className="button primary" disabled={busy}>Enviar enlace de acceso</button>
    </form>
    {status && <p className={"notice " + (error ? "error" : "")} role={error ? "alert" : "status"}>{status}</p>}
  </>;
}

function Entry() {
  const [account, setAccount] = useState<Account | null>(null);
  const [signed, setSigned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState("");
  const [invite, setInvite] = useState(() => {
    try { return localStorage.getItem(inviteKey) ?? ""; } catch { return token ?? ""; }
  });
  const search = new URLSearchParams(location.search);
  const [receiving, setReceiving] = useState(search.get("modulo") === "recepcion" || search.has("jornada"));
  async function refresh() {
    setIssue("");
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      const userId = session?.user.id;
      setSigned(Boolean(userId));
      if (!userId) { if (error) throw error; setAccount(null); return; }
      if (navigator.onLine) {
        try {
          const profile = await rpc<Account | null>("access", "profile");
          setAccount(profile);
          try {
            if (profile) localStorage.setItem(key, JSON.stringify(profile));
            else localStorage.removeItem(key);
          } catch {}
          return;
        } catch (error) {
          if (navigator.onLine) throw error;
        }
      }
      const cached = stored<Account>(key);
      setAccount(cached?.id === userId ? cached : null);
      if (cached?.id !== userId) setIssue("Necesitas conexión para comprobar este acceso.");
    } catch (reason) { setIssue(reason instanceof Error ? reason.message : "No se pudo verificar la sesión."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (window.isSecureContext && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("./vanifs-sw.generated.js").catch(() => {});
    }
  }, []);
  async function logout() {
    setIssue("");
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) { setIssue("Conéctate para cerrar la sesión."); return; }
    try { localStorage.removeItem(key); } catch {}
    location.assign(moduleUrl("inicio"));
  }
  const showModules = () => {
    history.replaceState(null, "", moduleUrl("inicio"));
    setReceiving(false);
  };
  if (account && receiving && !invite) return <Vanifs actor={account} onModules={showModules} onLogout={logout} />;
  return <main className="vantis-module-entry">
    <section className="panel vantis-module-panel">
      <Brand goHome={() => location.assign(moduleUrl("inicio"))} />
      {issue && <p className="notice error" role="alert">{issue}</p>}
      {loading ? <p role="status">Verificando tu cuenta…</p> : !signed ? <SignIn />
        : invite ? <Invite code={invite} complete={id => {
          const url = moduleUrl();
          url.searchParams.set("jornada", id);
          history.replaceState(null, "", url);
          setInvite("");
          setReceiving(true);
          void refresh();
        }} /> : account ? <>
          <h1>VANTIS</h1>
          <p>Hola, {account.name}. Selecciona tu módulo de trabajo.</p>
          <div className="vantis-module-options">
            {account.inventoryRole ? <a className="button secondary" href={inventoryUrl().href}><Boxes size={22} /> VANTIS · Inventario</a>
              : <button className="button secondary" disabled><Boxes size={22} /> Inventario · requiere permiso</button>}
            <button className="button primary" onClick={() => {
              history.replaceState(null, "", moduleUrl("recepcion"));
              setReceiving(true);
            }}><ScanLine size={22} /> VANIFS · Recepción</button>
          </div>
        </> : <><h1>Cuenta verificada</h1><p>Abre la invitación que emitió administración para esta cuenta.</p></>}
      <div className="dialog-actions">
        <a className="button plain" href={new URL("../", location.href).href}><ArrowLeft size={16} /> Inicio VANTIS</a>
        {signed && <button className="button secondary" onClick={() => void logout()}>Cerrar sesión</button>}
      </div>
    </section>
  </main>;
}

createRoot(document.getElementById("vanifs-root")!).render(<Entry />);
