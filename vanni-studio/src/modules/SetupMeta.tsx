import { useState } from 'react';
import { Link } from 'react-router';
import { Copy, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { callFunction } from '../lib/supabase';
import { Card, Notice, PageHeader } from '../components/ui';
import { useToast, confirmAction } from '../components/toast';
import { useInstagramStatus, ConnectionCard } from './Instagram';

function Copyable({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div className="code-copy"><code>{value}</code>
      <button type="button" className="btn sm" onClick={() => { void navigator.clipboard?.writeText(value).then(() => toast('Copiado', 'success')); }}><Copy size={14} />Copiar</button>
    </div>
  );
}

export function SetupMetaPage() {
  const { status, error, reload } = useInstagramStatus();
  const toast = useToast();
  const [appId, setAppId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const configured = !!status?.configured;
  const connected = status?.account?.status === 'connected';
  const redirect = status?.redirectUri ?? 'https://xfmwpndnefzpobvsbdyu.supabase.co/functions/v1/instagram/callback';

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await callFunction('instagram', { action: 'save-config', appId: appId.trim(), appSecret: secret.trim() }); toast('Credenciales guardadas y cifradas en el servidor', 'success'); setSecret(''); await reload(); }
    catch (err) { toast((err as Error).message, 'error'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirmAction('¿Eliminar las credenciales de Meta guardadas en el servidor?')) return;
    await callFunction('instagram', { action: 'delete-config' }).catch((e) => toast((e as Error).message, 'error'));
    await reload();
  };

  return (
    <div>
      <PageHeader eyebrow="Asistente · 15 minutos" title="Conectar Meta Developers" description="Instagram API with Instagram Login (oficial). No necesitas página de Facebook ni revisión de Meta para usar tu propia cuenta en modo desarrollo. Todo es gratuito." />
      {error && <Notice tone="crit">{error}</Notice>}
      <div className="steps">
        <div className="step">
          <h3>Cuenta profesional de Instagram</h3>
          <ul><li>En Instagram: <b>Configuración y privacidad → Tipo de cuenta y herramientas → Cambiar a cuenta profesional</b> y elige <b>Creador</b> (o Empresa).</li><li>Las cuentas personales no tienen estadísticas en la API.</li></ul>
        </div>
        <div className="step">
          <h3>Cuenta de desarrollador de Meta</h3>
          <ul><li>Entra a <a href="https://developers.facebook.com/" target="_blank" rel="noreferrer">developers.facebook.com <ExternalLink size={12} style={{ display: 'inline' }} /></a> con tu Facebook y pulsa <b>Empezar</b>. Verifica tu correo o teléfono si te lo pide.</li></ul>
        </div>
        <div className="step">
          <h3>Crear la app</h3>
          <ul>
            <li><b>Mis apps → Crear app</b>. Nombre sugerido: <b>VANNI STUDIO</b>.</li>
            <li>Caso de uso: <b>«Administrar mensajes y contenido en Instagram»</b> (Instagram API). Si te pide tipo de app, elige <b>Empresa</b>. No necesitas portafolio comercial para tu propia cuenta.</li>
          </ul>
        </div>
        <div className="step">
          <h3>Configurar el inicio de sesión de Instagram</h3>
          <ul>
            <li>En el panel de la app: <b>Casos de uso → Instagram API → Personalizar → Configuración de la API con inicio de sesión de Instagram</b>.</li>
            <li>En <b>«Configurar el inicio de sesión para empresas de Instagram» → Configuración de inicio de sesión para empresas</b>, agrega este URI de redireccionamiento de OAuth y guarda:</li>
          </ul>
          <Copyable value={redirect} />
          <p className="xs faint" style={{ marginBottom: 0 }}>Debe coincidir exactamente, sin espacios ni «/» extra.</p>
        </div>
        <div className="step">
          <h3>Agregar tu cuenta como evaluadora</h3>
          <ul>
            <li>En la misma pantalla, sección <b>«Generar tokens de acceso» → Agregar cuenta</b>, o en <b>Roles de la app → Roles → Agregar personas → Evaluador de Instagram</b>, escribe tu usuario de Instagram.</li>
            <li>Acepta la invitación en Instagram: <b>Configuración → Apps y sitios web → Invitaciones de evaluador → Aceptar</b> (en la web: instagram.com/accounts/manage_access).</li>
            <li>La app puede quedarse en <b>modo de desarrollo</b>: así solo tu cuenta puede autorizarla.</li>
          </ul>
        </div>
        <div className={`step ${configured ? 'done' : ''}`}>
          <h3>Copiar el App ID y el App Secret de Instagram</h3>
          <ul><li>En <b>Configuración de la API con inicio de sesión de Instagram</b> copia el <b>Identificador de la app de Instagram</b> y la <b>Clave secreta de la app de Instagram</b> (no el identificador general de la app de Meta).</li><li>El secreto se cifra con AES-256 y se guarda solo en el servidor; nunca vuelve al navegador.</li></ul>
          {configured ? (
            <div className="stack" style={{ marginTop: 10 }}>
              <Notice tone="ok">Credenciales configuradas{status?.source === 'env' ? ' mediante variables del servidor' : ''} · App ID {status?.appId}</Notice>
              {status?.source === 'db' && <button className="btn sm ghost" type="button" onClick={() => void remove()}>Reemplazar o eliminar credenciales</button>}
            </div>
          ) : (
            <form className="form-grid two" style={{ marginTop: 10 }} onSubmit={(e) => void save(e)}>
              <label className="field"><span>Instagram App ID</span><input className="input mono" inputMode="numeric" autoComplete="off" value={appId} onChange={(e) => setAppId(e.target.value.replace(/\D/g, ''))} required /></label>
              <label className="field"><span>Instagram App Secret</span><input className="input mono" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value.trim())} required /></label>
              <div className="span-2"><button className="btn primary" type="submit" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}Guardar en el servidor</button></div>
            </form>
          )}
        </div>
        <div className={`step ${connected ? 'done' : ''}`}>
          <h3>Conectar y autorizar</h3>
          <ul><li>Pulsa <b>Conectar mi Instagram</b>, inicia sesión en Instagram (en su página oficial) y acepta los permisos <b>instagram_business_basic</b> e <b>instagram_business_manage_insights</b>.</li><li>Volverás aquí automáticamente; la primera sincronización importa 30 días de métricas y tus publicaciones.</li></ul>
          <div style={{ marginTop: 10 }}><ConnectionCard compact /></div>
        </div>
      </div>
      <section className="section">
        <Card title="Preguntas frecuentes">
          <div className="stack small muted">
            <p style={{ margin: 0 }}><b>«Invalid redirect_uri» o «URL bloqueada»:</b> el URI del paso 4 no coincide exactamente. Cópialo de nuevo y guarda los cambios en Meta.</p>
            <p style={{ margin: 0 }}><b>«Insufficient developer role»:</b> tu cuenta de Instagram aún no aceptó la invitación de evaluador (paso 5).</p>
            <p style={{ margin: 0 }}><b>Faltan seguidores por día o demografía:</b> Meta solo los entrega a cuentas con 100+ seguidores. VANNI STUDIO registra tu historial diario por su cuenta desde que conectas.</p>
            <p style={{ margin: 0 }}><b>¿Cuesta algo?</b> No. La API de Instagram, Supabase (plan gratuito) y GitHub Pages son gratuitos para este uso.</p>
          </div>
        </Card>
      </section>
      <Link to="/instagram" className="btn">Ir a mis estadísticas</Link>
    </div>
  );
}
