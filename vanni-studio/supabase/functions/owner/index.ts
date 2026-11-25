// VANNI STUDIO · Alta única de la cuenta propietaria y recuperación de acceso.
// El registro público está cerrado en la base de datos; solo esta función puede crear la cuenta,
// y únicamente con el código de propietario entregado al configurar el proyecto.
import { HttpError, corsHeaders, json, validEmail } from '../_shared/http.ts';
import { admin, allowedOrigins, getConfig, requireOwner, rpc } from '../_shared/server.ts';
import { humanCode, normalizeCode, randomToken, safeEqual, sha256Hex } from '../_shared/crypto.ts';

const sb = admin();

function validPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= 10 && p.length <= 128;
}

async function issueRecoveryCode(): Promise<string> {
  const code = humanCode(5, 4);
  await rpc(sb, 'svc_config_set', { p_key: 'owner_recovery_hash', p_value: await sha256Hex(normalizeCode(code)) });
  return code;
}

async function guard(kind: string, max: number, windowMin: number) {
  const ok = await rpc<boolean>(sb, 'svc_attempts_allowed', { p_kind: kind, p_window_minutes: windowMin, p_max: max });
  if (!ok) throw new HttpError(429, `Demasiados intentos. Espera ${windowMin} minutos e inténtalo de nuevo.`, 'too_many_attempts');
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'), allowedOrigins());
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido', 'method');
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    if (action === 'status') {
      const owner = await rpc<Array<{ user_id: string }>>(sb, 'svc_owner_info');
      const cfg = await getConfig(sb, ['owner_claim_hash']);
      return json({ claimed: !!owner?.length, claimable: !owner?.length && !!cfg.owner_claim_hash }, 200, cors);
    }

    if (action === 'claim') {
      await guard('claim', 8, 15);
      const { email, password, code } = body;
      if (!validEmail(email)) throw new HttpError(400, 'Escribe un correo válido.', 'invalid_email');
      if (!validPassword(password)) throw new HttpError(400, 'La contraseña debe tener al menos 10 caracteres.', 'weak_password');
      const owner = await rpc<Array<unknown>>(sb, 'svc_owner_info');
      if (owner?.length) throw new HttpError(409, 'La cuenta propietaria ya existe. Inicia sesión.', 'already_claimed');
      const cfg = await getConfig(sb, ['owner_claim_hash']);
      const provided = await sha256Hex(normalizeCode(String(code ?? '')));
      if (!cfg.owner_claim_hash || !safeEqual(provided, cfg.owner_claim_hash)) {
        await rpc(sb, 'svc_attempt_record', { p_kind: 'claim', p_ok: false });
        throw new HttpError(403, 'El código de propietario no es válido.', 'invalid_code');
      }
      const claimToken = randomToken(32);
      await rpc(sb, 'svc_signup_token_create', { p_hash: await sha256Hex(claimToken), p_ttl_seconds: 120 });
      const { data, error } = await sb.auth.admin.createUser({
        email: email.trim().toLowerCase(),
        password,
        email_confirm: true,
        user_metadata: { vanni_claim: claimToken },
      });
      if (error || !data.user) throw new HttpError(400, `No se pudo crear la cuenta: ${error?.message ?? 'error desconocido'}`, 'create_failed');
      // El token de alta ya se consumió; se retira de los metadatos para que no viaje en el JWT.
      await sb.auth.admin.updateUserById(data.user.id, { user_metadata: { vanni_claim: null } });
      await rpc(sb, 'svc_config_delete', { p_key: 'owner_claim_hash' });
      await rpc(sb, 'svc_attempt_record', { p_kind: 'claim', p_ok: true });
      const recoveryCode = await issueRecoveryCode();
      return json({ ok: true, recoveryCode }, 200, cors);
    }

    if (action === 'recover') {
      await guard('recover', 5, 30);
      const { email, recoveryCode, newPassword } = body;
      if (!validPassword(newPassword)) throw new HttpError(400, 'La nueva contraseña debe tener al menos 10 caracteres.', 'weak_password');
      const owner = (await rpc<Array<{ user_id: string; email: string }>>(sb, 'svc_owner_info'))?.[0];
      const cfg = await getConfig(sb, ['owner_recovery_hash']);
      const provided = await sha256Hex(normalizeCode(String(recoveryCode ?? '')));
      const emailOk = owner && typeof email === 'string' && owner.email?.toLowerCase() === email.trim().toLowerCase();
      if (!owner || !emailOk || !cfg.owner_recovery_hash || !safeEqual(provided, cfg.owner_recovery_hash)) {
        await rpc(sb, 'svc_attempt_record', { p_kind: 'recover', p_ok: false });
        throw new HttpError(403, 'Correo o código de recuperación incorrectos.', 'invalid_recovery');
      }
      const { error } = await sb.auth.admin.updateUserById(owner.user_id, { password: newPassword });
      if (error) throw new HttpError(400, `No se pudo cambiar la contraseña: ${error.message}`, 'update_failed');
      await rpc(sb, 'svc_attempt_record', { p_kind: 'recover', p_ok: true });
      return json({ ok: true, recoveryCode: await issueRecoveryCode() }, 200, cors);
    }

    if (action === 'rotate-recovery') {
      await requireOwner(sb, req);
      return json({ ok: true, recoveryCode: await issueRecoveryCode() }, 200, cors);
    }

    throw new HttpError(400, `Acción desconocida: ${action}`, 'unknown_action');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status, cors);
    console.error(e);
    return json({ error: (e as Error).message || 'Error interno', code: 'internal' }, 500, cors);
  }
});
