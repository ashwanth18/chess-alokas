import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { checkOnline } from '../api/client';
import { getLastSyncAt } from '../db/local';
import { syncOnline } from '../sync/sync';

export default function SettingsPage() {
  const auth = useAuth();
  const [online, setOnline] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void checkOnline().then(setOnline);
    void getLastSyncAt().then(setLastSync);
  }, []);

  async function runSync() {
    if (!auth.user) {
      setError('Sign in to sync');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const { pushed, pulled } = await syncOnline();
      const now = new Date().toISOString();
      setLastSync(now);
      setMessage(`Synced ↑ ${pushed} · ↓ ${pulled}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="page-container settings-page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-subtitle">Cloud connection and sync preferences</p>
        </div>
      </div>

      <section className="account-panel">
        <h3>Cloud</h3>
        <dl className="settings-dl">
          <div>
            <dt>API</dt>
            <dd>{online ? 'Reachable' : 'Offline / unreachable'}</dd>
          </div>
          <div>
            <dt>Signed in</dt>
            <dd>{auth.user ? auth.user.email : 'No'}</dd>
          </div>
          <div>
            <dt>Last sync</dt>
            <dd>{lastSync ? new Date(lastSync).toLocaleString() : 'Never'}</dd>
          </div>
          {window.desktop?.isDesktop && (
            <div>
              <dt>Desktop version</dt>
              <dd>{window.desktop.getAppVersion()}</dd>
            </div>
          )}
        </dl>
        <div className="account-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={syncing || !auth.user || !online}
            onClick={() => void runSync()}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          {!auth.user && (
            <Link className="btn btn-outline" to="/login">
              Sign in
            </Link>
          )}
        </div>
        {error && <div className="form-error">{error}</div>}
        {message && <p className="form-hint">{message}</p>}
      </section>

      <section className="account-panel">
        <h3>About</h3>
        <p className="form-hint">
          Production host: <code>https://chess-manager.alokas.com</code>. Secrets stay on the
          server — this app only uses your login session.
        </p>
        <p className="form-hint">
          Manage profile and linked providers on the <Link to="/account">Account</Link> page.
        </p>
      </section>
    </div>
  );
}
