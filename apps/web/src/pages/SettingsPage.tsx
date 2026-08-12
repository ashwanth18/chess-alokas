import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { checkOnline } from '../api/client';
import { getLastSyncAt } from '../db/local';
import { syncOnline } from '../sync/sync';
import type { DesktopUpdateStatus } from '../desktop';

export default function SettingsPage() {
  const auth = useAuth();
  const [online, setOnline] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const isDesktop = Boolean(window.desktop?.isDesktop);
  const desktopVersion = isDesktop ? window.desktop!.getAppVersion() : null;

  useEffect(() => {
    void checkOnline().then(setOnline);
    void getLastSyncAt().then(setLastSync);
  }, []);

  useEffect(() => {
    if (!window.desktop?.onUpdateStatus) return;
    return window.desktop.onUpdateStatus((status) => {
      setUpdateStatus(status);
      if (status.status !== 'checking') setCheckingUpdate(false);
    });
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
          <p className="page-breadcrumb">
            <Link to="/app">Tournaments</Link>
            <span aria-hidden> / </span>
            <span>Settings</span>
          </p>
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
          {isDesktop && (
            <div>
              <dt>Desktop version</dt>
              <dd>v{desktopVersion}</dd>
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

      {isDesktop && (
        <section className="account-panel">
          <h3>Desktop updates</h3>
          <p className="form-hint">
            Installed version <strong>v{desktopVersion}</strong>. Updates download in the app —
            Windows Setup builds restart and install silently; portable / macOS download an
            installer to your Downloads folder and open it (never opens GitHub).
          </p>
          <dl className="settings-dl">
            <div>
              <dt>Status</dt>
              <dd>
                {updateStatus?.message ||
                  (checkingUpdate ? 'Checking…' : 'No update check yet — click below.')}
              </dd>
            </div>
            {updateStatus?.version && (
              <div>
                <dt>Latest</dt>
                <dd>v{updateStatus.version}</dd>
              </div>
            )}
          </dl>
          <div className="account-actions">
            <button
              type="button"
              className="btn btn-outline"
              disabled={checkingUpdate || updateStatus?.status === 'downloading'}
              onClick={() => {
                setCheckingUpdate(true);
                void window.desktop?.checkForUpdates();
              }}
            >
              {checkingUpdate || updateStatus?.status === 'checking'
                ? 'Checking…'
                : 'Check for updates'}
            </button>
            {updateStatus?.status === 'available' && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void window.desktop?.downloadUpdate()}
              >
                Download update
              </button>
            )}
            {updateStatus?.status === 'downloading' && (
              <span className="form-hint">{updateStatus.percent ?? 0}%</span>
            )}
            {updateStatus?.status === 'downloaded' && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void window.desktop?.installUpdate()}
              >
                {updateStatus.canInstall ? 'Restart & update' : 'Install update'}
              </button>
            )}
          </div>
        </section>
      )}

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
