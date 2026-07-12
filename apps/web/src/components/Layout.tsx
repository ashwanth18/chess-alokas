import { useState, useEffect, useCallback } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { checkOnline } from '../api/client';
import { syncOnline } from '../sync/sync';
import { getLastSyncAt } from '../db/local';

function formatSyncTime(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Layout() {
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

    // Poll actual API reachability
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

  const handleSync = useCallback(async () => {
    if (!online || syncing) return;
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
  }, [online, syncing]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand" onClick={() => setMenuOpen(false)}>
          <span className="brand-knight">♞</span>
          <span className="brand-name">Chess Alokas</span>
        </NavLink>

        <button
          className="menu-toggle"
          aria-label="Toggle menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className={`hamburger ${menuOpen ? 'open' : ''}`} />
        </button>

        <nav className={`topnav ${menuOpen ? 'open' : ''}`}>
          <NavLink to="/" end onClick={() => setMenuOpen(false)}>
            Tournaments
          </NavLink>
          <NavLink to="/tournaments/new" onClick={() => setMenuOpen(false)}>
            New Tournament
          </NavLink>
          <NavLink to="/simulator" onClick={() => setMenuOpen(false)}>
            Simulator
          </NavLink>
        </nav>

        <div className="sync-bar">
          <span className={`status-dot ${online ? 'online' : 'offline'}`} />
          <span className="status-label">{online ? 'Online' : 'Offline'}</span>
          {lastSync && (
            <span className="sync-time">Synced {formatSyncTime(lastSync)}</span>
          )}
          {syncResult && <span className="sync-result">{syncResult}</span>}
          <button
            className="btn btn-sm btn-sync"
            onClick={handleSync}
            disabled={!online || syncing}
          >
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
        </div>
      </header>

      <main className="page-content">
        <Outlet />
      </main>

      <footer className="app-footer">
        <span>Chess Alokas · Offline-first tournament management</span>
      </footer>
    </div>
  );
}
