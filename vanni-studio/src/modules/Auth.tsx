import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { callFunction, supabase } from '../lib/supabase';
import { Notice } from '../components/ui';

type Mode = 'login' | 'claim' | 'recover' | 'saved';

function PasswordInput({ value, onChange, autoComplete, id }: { value: string; onChange: (v: string) => void; autoComplete: string; id: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="row" style={{ gap: 6 }}>
      <input id={id} className="input" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required minLength={10} />
      <button type="button" className="icon-btn bordered" aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShow(!show)}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
    </div>
  );
}

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [claimable, setClaimable] = useState(false);

  useEffect(() => {
    callFunction<{ claimed: boolean; claimable: boolean }>('owner', { action: 'status' }, { auth: false, timeoutMs: 15_000 })
      .then((s) => { setClaimable(s.claimable); if (s.claimable) setMode('claim'); })
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw new Error(err.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : err.message);
      } else if (mode === 'claim') {
        const r = await callFunction<{ recoveryCode: string }>('owner', { action: 'claim', email: email.trim(), password, code }, { auth: false });
        setRecovery(r.recoveryCode);
        setMode('saved');
      } else if (mode === 'recover') {
        const r = await callFunction<{ recoveryCode: string }>('owner', { action: 'recover', email: email.trim(), recoveryCode: code, newPassword: password }, { auth: false });
        setRecovery(r.recoveryCode);
        setMode('saved');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const enter = async () => {
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) { setError(err.message); setMode('login'); }
  };

  return (
    <div className="auth">
      <div className="auth-card stack" style={{ gap: 18 }}>
        <div>
          <div className="eyebrow">Personal Creator Management System</div>
          <h1 style={{ marginTop: 8 }}>VANNI <b>STUDIO</b></h1>
          <p className="motto" style={{ marginTop: 10 }}>Build yourself. Build your legacy.</p>
        </div>

        {mode === 'saved' && recovery ? (
          <div className="card stack">
            <div className="row"><ShieldCheck size={20} color="var(--accent)" /><h3>Guarda tu código de recuperación</h3></div>
            <p className="muted small" style={{ margin: 0 }}>Es la única forma de restablecer tu contraseña sin correo. Guárdalo en tu gestor de contraseñas o en un lugar seguro. No se volverá a mostrar.</p>
            <div className="code-copy"><code style={{ fontSize: 16, letterSpacing: '0.08em' }}>{recovery}</code><button className="btn sm" type="button" onClick={() => void navigator.clipboard?.writeText(recovery)}>Copiar</button></div>
            <button className="btn primary block" type="button" disabled={busy} onClick={() => void enter()}>{busy ? <Loader2 size={16} className="spin" /> : null}Ya lo guardé · Entrar</button>
          </div>
        ) : (
          <form className="card stack" onSubmit={(e) => void submit(e)}>
            <h3>{mode === 'login' ? 'Iniciar sesión' : mode === 'claim' ? 'Activar tu cuenta privada' : 'Recuperar acceso'}</h3>
            {mode === 'claim' && <p className="muted small" style={{ margin: 0 }}>VANNI STUDIO es privado: solo una cuenta puede existir. Usa el código de propietario que recibiste al configurar el proyecto.</p>}
            {(mode === 'claim' || mode === 'recover') && (
              <label className="field"><span>{mode === 'claim' ? 'Código de propietario' : 'Código de recuperación'}</span>
                <input className="input mono" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} required placeholder="XXXX-XXXX-XXXX-XXXX" />
              </label>
            )}
            <label className="field" htmlFor="auth-email"><span>Correo</span>
              <input id="auth-email" className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="field" htmlFor="auth-pass"><span>{mode === 'recover' ? 'Nueva contraseña' : 'Contraseña'}{mode !== 'login' ? ' (mínimo 10 caracteres)' : ''}</span>
              <PasswordInput id="auth-pass" value={password} onChange={setPassword} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </label>
            {error && <Notice tone="crit">{error}</Notice>}
            <button className="btn primary block" type="submit" disabled={busy}>{busy && <Loader2 size={16} className="spin" />}{mode === 'login' ? 'Entrar' : mode === 'claim' ? 'Crear mi cuenta' : 'Cambiar contraseña'}</button>
            <div className="row wrap between small">
              {mode !== 'login' && <button type="button" className="btn ghost sm" onClick={() => { setMode('login'); setError(null); }}>Ya tengo cuenta</button>}
              {mode === 'login' && <button type="button" className="btn ghost sm" onClick={() => { setMode('recover'); setError(null); }}><KeyRound size={14} />Olvidé mi contraseña</button>}
              {mode === 'login' && claimable && <button type="button" className="btn ghost sm" onClick={() => setMode('claim')}>Activar cuenta</button>}
            </div>
          </form>
        )}
        <p className="xs faint" style={{ textAlign: 'center' }}>Sesión cifrada · Datos privados protegidos con seguridad por fila · Sin contraseñas de Instagram</p>
      </div>
    </div>
  );
}
