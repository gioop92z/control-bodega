import { Link } from 'react-router';
import { NAV } from '../components/Layout';
import { PageHeader } from '../components/ui';
import { useAuth } from '../lib/auth';

/** Centro de navegación móvil con todos los módulos. */
export function MorePage() {
  const { signOut } = useAuth();
  return (
    <div>
      <PageHeader eyebrow="VANNI STUDIO" title="Todo" />
      {NAV.map((g) => (
        <section key={g.group} className="section">
          <div className="kicker" style={{ marginBottom: 8 }}>{g.group}</div>
          <div className="grid auto-sm">
            {g.items.map((i) => <Link key={i.to} to={i.to} className="card link tight stack tight"><i.icon size={22} color="var(--accent)" /><b className="small">{i.label}</b></Link>)}
          </div>
        </section>
      ))}
      <button className="btn ghost" type="button" onClick={() => void signOut()}>Cerrar sesión</button>
      <p className="motto" style={{ marginTop: 20 }}>Build yourself. Build your legacy.</p>
    </div>
  );
}
