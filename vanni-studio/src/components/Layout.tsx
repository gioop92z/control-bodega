import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  BarChart3, Briefcase, CalendarDays, CheckSquare, Clapperboard, Dumbbell, Film, FlaskConical, Home, Instagram, LayoutGrid, LineChart, ListChecks,
  LogOut, MapPin, NotebookPen, Plus, Settings, Sparkles, Target, Trophy, Wallet, BookOpen,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { SaveIndicator } from './ui';
import { QuickCapture } from './QuickCapture';

export const NAV: Array<{ group: string; items: Array<{ to: string; label: string; icon: typeof Home }> }> = [
  { group: 'Centro', items: [{ to: '/', label: 'Inicio', icon: Home }, { to: '/instagram', label: 'Instagram', icon: Instagram }, { to: '/analisis', label: 'Análisis', icon: LineChart }] },
  { group: 'Contenido', items: [{ to: '/series', label: 'Series', icon: Film }, { to: '/produccion', label: 'Producción', icon: Clapperboard }, { to: '/laboratorio', label: 'Laboratorio', icon: FlaskConical }, { to: '/instagram/publicaciones', label: 'Publicaciones', icon: BarChart3 }] },
  { group: 'Vida', items: [{ to: '/agenda', label: 'Agenda', icon: CalendarDays }, { to: '/tareas', label: 'Tareas', icon: CheckSquare }, { to: '/evolucion', label: 'Evolución física', icon: Dumbbell }, { to: '/objetivos', label: 'Objetivos', icon: Target }, { to: '/journey', label: 'The VANNI Journey', icon: BookOpen }] },
  { group: 'Negocio', items: [{ to: '/marca', label: 'Marca y colaboraciones', icon: Briefcase }, { to: '/finanzas', label: 'Finanzas', icon: Wallet }, { to: '/media-kit', label: 'Media kit', icon: Sparkles }] },
  { group: 'Explorar', items: [{ to: '/gimnasios', label: 'Gimnasios', icon: MapPin }, { to: '/gimnasios/ranking', label: 'Ranking', icon: Trophy }] },
  { group: 'Sistema', items: [{ to: '/colecciones', label: 'Colecciones', icon: ListChecks }, { to: '/notas', label: 'Notas', icon: NotebookPen }, { to: '/ajustes', label: 'Ajustes', icon: Settings }] },
];

const TABS = [
  { to: '/', label: 'Inicio', icon: Home, match: (p: string) => p === '/' },
  { to: '/series', label: 'Studio', icon: Film, match: (p: string) => /^\/(series|produccion|laboratorio|episodios)/.test(p) },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays, match: (p: string) => /^\/(agenda|tareas)/.test(p) },
  { to: '/instagram', label: 'Insights', icon: Instagram, match: (p: string) => /^\/(instagram|analisis)/.test(p) },
  { to: '/mas', label: 'Más', icon: LayoutGrid, match: (p: string) => !/^\/($|series|produccion|laboratorio|episodios|agenda|tareas|instagram|analisis)/.test(p) && p !== '/' },
];

export function Brand() {
  return (
    <NavLink to="/" className="brand" aria-label="VANNI STUDIO, inicio">
      <span className="brand-mark"><svg width="18" height="18" viewBox="0 0 512 512" aria-hidden><path d="M138 140h62l56 170 56-170h62l-90 240h-56z" fill="#f2f3ef" /><rect x="150" y="398" width="212" height="14" rx="7" fill="#3be58a" /></svg></span>
      <span className="brand-name">VANNI <b>STUDIO</b></span>
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { signOut } = useAuth();
  const [params, setParams] = useSearchParams();
  const [capture, setCapture] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  useEffect(() => { if (params.get('capture') === '1') { setCapture(true); params.delete('capture'); setParams(params, { replace: true }); } }, [params, setParams]);
  return (
    <div className="app">
      <aside className="sidebar" aria-label="Navegación principal">
        <Brand />
        {NAV.map((g) => (
          <nav key={g.group} className="nav-group" aria-label={g.group}>
            <span className="kicker">{g.group}</span>
            {g.items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/' || i.to === '/instagram' || i.to === '/gimnasios'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><i.icon size={17} />{i.label}</NavLink>)}
          </nav>
        ))}
        <div style={{ marginTop: 'auto', paddingTop: 16 }}>
          <button type="button" className="nav-item btn ghost" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => { void signOut().then(() => navigate('/')); }}><LogOut size={17} />Cerrar sesión</button>
          <p className="motto" style={{ padding: '10px 10px 0' }}>Build yourself. Build your legacy.</p>
        </div>
      </aside>
      <main className="main">
        <div className="topbar"><Brand /><SaveIndicator /></div>
        <div className="page">{children}</div>
      </main>
      <nav className="tabbar" aria-label="Secciones">
        {TABS.map((t) => <NavLink key={t.to} to={t.to} className={t.match(pathname) ? 'active' : ''} aria-current={t.match(pathname) ? 'page' : undefined}><t.icon size={21} />{t.label}</NavLink>)}
      </nav>
      <button type="button" className="fab" aria-label="Captura rápida" onClick={() => setCapture(true)}><Plus size={26} /></button>
      <QuickCapture open={capture} onClose={() => setCapture(false)} />
    </div>
  );
}
