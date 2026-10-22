import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { api, type Health } from '../api';
import { API_BASE_URL } from '../config';
import { IconArrowRight } from './Icons';
import { Sky } from './Sky';

export function Layout() {
  const { pathname } = useLocation();
  // État réel du backend (base de données, IA) affiché en pied de page
  const [health, setHealth] = useState<Health | 'down' | null>(null);
  useEffect(() => {
    let alive = true;
    api.getHealth().then(
      (h) => alive && setHealth(h),
      () => alive && setHealth('down'),
    );
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      <Sky />
      <div className="app">
        <header className="topbar">
          <Link to="/" className="topbar__logo" aria-label="ref& — home">
            <img src="/brand/refand-mark.png" alt="" width={38} />
          </Link>

          <nav className="topbar__nav" aria-label="Main">
            <NavLink to="/" end>
              Dashboard
            </NavLink>
            <NavLink to="/audit/new">New audit</NavLink>
            <NavLink to="/design-system" className="topbar__minor">
              Design system
            </NavLink>
          </nav>

          <Link to="/audit/new" className="topbar__cta">
            Start an audit <IconArrowRight width={16} height={16} strokeWidth={2.2} />
          </Link>
        </header>

        {/* La clé relance l'entrée de page : chaque écran « avance » vers la droite */}
        <main className="content" key={pathname}>
          <Outlet />
        </main>

        <footer className="footer">
          <span
            className={`dot ${health && health !== 'down' && health.db.ok ? 'dot--ok' : 'dot--warn'}`}
            aria-hidden
          />
          {health === 'down' ? (
            <>
              Backend unreachable at <span className="mono">{API_BASE_URL}</span>
            </>
          ) : health ? (
            <>
              Backend connected · database {health.db.ok ? 'ok' : 'down'} · live AI{' '}
              {health.ai.configured ? 'on' : 'off (demo documents only)'}
            </>
          ) : (
            'Checking backend…'
          )}
          <span className="footer__right">ref&amp; helps you get what’s yours</span>
        </footer>
      </div>
    </>
  );
}
