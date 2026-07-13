import { useState, useEffect, useCallback } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { checkOnline } from '../api/client';
import { syncOnline } from '../sync/sync';
import { getLastSyncAt } from '../db/local';
import { useAuth } from '../auth/AuthContext';
import DesktopUpdateBanner from './DesktopUpdateBanner';

function formatSyncTime(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Layout() {
  const auth = useAuth();
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    getLastSyncAt().then(setLastSync);
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const interval = setInterval(async () => {
      const reachable = await checkOnline();
      setOnline(reachable);
    }, 30_000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const handleSync = useCallback(async () => {
    if (!online || syncing || !auth.user) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const { pushed, pulled } = await syncOnline();
      const now = new Date().toISOString();
      setLastSync(now);
      setSyncResult(`↑ ${pushed} pushed · ↓ ${pulled} pulled`);
      setTimeout(() => setSyncResult(null), 4000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      setSyncResult(message.length > 60 ? 'Sync failed' : message);
      console.error('[sync]', err);
      setTimeout(() => setSyncResult(null), 5000);
    } finally {
      setSyncing(false);
    }
  }, [online, syncing, auth.user]);

  useEffect(() => {
    if (!window.desktop?.isDesktop || !auth.user) return;
    let cancelled = false;
    void (async () => {
      const reachable = await checkOnline();
      if (cancelled || !reachable) return;
      setOnline(true);
      try {
        const { pushed, pulled } = await syncOnline();
        if (cancelled) return;
        setLastSync(new Date().toISOString());
        setSyncResult(`↑ ${pushed} pushed · ↓ ${pulled} pulled`);
        setTimeout(() => setSyncResult(null), 4000);
      } catch (err) {
        console.warn('[desktop auto-sync]', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.user]);

  const label = auth.displayName || auth.user?.email?.split('@')[0] || 'Account';
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/app" className="brand" onClick={closeMenu}>
          <span className="brand-knight" aria-hidden>
            ♕
          </span>
          <span className="brand-name">Chess Alokas</span>
        </NavLink>

        <button
          type="button"
          className="menu-toggle"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className={`hamburger ${menuOpen ? 'open' : ''}`} />
        </button>

        <nav className={`topnav ${menuOpen ? 'open' : ''}`} aria-label="Main">
          <NavLink to="/app" end onClick={closeMenu}>
            Tournaments
          </NavLink>
          <NavLink to="/tournaments/new" onClick={closeMenu}>
            New
          </NavLink>
          <NavLink to="/certificates" onClick={closeMenu}>
            Certificates
          </NavLink>
          <NavLink to="/simulator" onClick={closeMenu}>
            Simulator
          </NavLink>
          <NavLink to="/account" onClick={closeMenu}>
            Account
          </NavLink>
          <NavLink to="/settings" onClick={closeMenu}>
            Settings
          </NavLink>
          <div className="topnav-mobile-actions">
            <button
              type="button"
              className="btn btn-sm btn-sync"
              onClick={() => {
                void handleSync();
                closeMenu();
              }}
              disabled={!online || syncing || !auth.user}
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                closeMenu();
                void auth.signOut('local');
              }}
            >
              Sign out
            </button>
            {!window.desktop?.isDesktop && (
              <Link to="/" className="btn btn-sm btn-outline" onClick={closeMenu}>
                Marketing home
              </Link>
            )}
          </div>
        </nav>

        <div className="sync-bar">
          <Link to="/account" className="user-chip" title={auth.user?.email ?? 'Account'}>
            {label}
          </Link>
          <span
            className={`status-dot ${online ? 'online' : 'offline'}`}
            title={online ? 'API reachable' : 'Offline'}
          />
          <span className="status-label">{online ? 'Online' : 'Offline'}</span>
          {lastSync && (
            <span className="sync-time" title={lastSync}>
              Synced {formatSyncTime(lastSync)}
            </span>
          )}
          {syncResult && <span className="sync-result">{syncResult}</span>}
          <button
            type="button"
            className="btn btn-sm btn-sync"
            onClick={() => void handleSync()}
            disabled={!online || syncing || !auth.user}
            title={!auth.user ? 'Sign in to sync' : !online ? 'Offline' : 'Sync with cloud'}
          >
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void auth.signOut('local')}
          >
            Sign out
          </button>
        </div>
      </header>

      {menuOpen && (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="Close menu"
          onClick={closeMenu}
        />
      )}

      <DesktopUpdateBanner />

      <main className="page-content">
        <Outlet />
      </main>

      <footer className="app-footer">
        <span>
          Chess Alokas · Offline-first tournament management
          {window.desktop?.isDesktop ? (
            <>
              {' '}
              · <span className="app-footer-version">v{window.desktop.getAppVersion()}</span>
            </>
          ) : null}
        </span>
        <span className="app-footer-links">
          {!window.desktop?.isDesktop && (
            <Link to="/" className="app-footer-link">
              Home
            </Link>
          )}
          <Link to="/account" className="app-footer-link">
            Account
          </Link>
          <Link to="/settings" className="app-footer-link">
            Settings
          </Link>
        </span>
      </footer>
    </div>
  );
}
