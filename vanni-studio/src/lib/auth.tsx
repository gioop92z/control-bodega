import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { startDataLayer, stopDataLayer } from './store';

interface AuthState { session: Session | null; user: User | null; loading: boolean; signOut: () => Promise<void> }
const Ctx = createContext<AuthState>({ session: null, user: null, loading: true, signOut: async () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (!alive) return; setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (session?.user) startDataLayer(session.user.id);
    else if (!loading) stopDataLayer();
  }, [session?.user?.id, loading]);
  // Cerrar sesión nunca debe depender de la red: si el servidor no responde, se borra la sesión local igualmente.
  const signOut = async () => {
    try {
      const { error } = await Promise.race([
        supabase.auth.signOut({ scope: 'local' }),
        new Promise<{ error: Error }>((r) => setTimeout(() => r({ error: new Error('timeout') }), 4000)),
      ]);
      if (error) throw error;
    } catch {
      try { localStorage.removeItem('vanni-studio-auth'); } catch { /* almacenamiento no disponible */ }
    }
    stopDataLayer();
    setSession(null);
  };
  return <Ctx.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>{children}</Ctx.Provider>;
}
