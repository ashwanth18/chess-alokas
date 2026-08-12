import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { resolveApiBaseUrl } from '../api/client';
import { copySupportInfo } from '../lib/supportInfo';

interface SessionRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  refreshedAt: string | null;
  userAgent: string | null;
  ip: string | null;
  current: boolean;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function shortAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return 'Chrome';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
  if (/Electron/i.test(ua)) return 'Desktop app';
  return ua.slice(0, 48) + (ua.length > 48 ? '…' : '');
}

export default function AccountPage() {
  const auth = useAuth();
  const [name, setName] = useState(auth.displayName ?? '');
  const [password, setPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsUnavailable, setSessionsUnavailable] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const providers = useMemo(() => {
    const ids = auth.user?.identities ?? [];
    return ids.map((i) => ({
      provider: i.provider,
      identityId: i.identity_id,
    }));
  }, [auth.user]);

  const initials = (auth.displayName || auth.user?.email || '?')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const loadSessions = useCallback(async () => {
    if (!auth.user) return;
    setSessionsLoading(true);
    try {
      const token = await auth.getAccessToken();
      const res = await fetch(`${resolveApiBaseUrl()}/me/sessions`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = (await res.json().catch(() => ({}))) as {
        sessions?: SessionRow[];
        unavailable?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        setSessionsUnavailable(body.error ?? `Could not load sessions (${res.status})`);
        setSessions([]);
        return;
      }
      if (body.unavailable) {
        setSessionsUnavailable(body.message ?? 'Sessions unavailable');
        setSessions([]);
      } else {
        setSessionsUnavailable(null);
        setSessions(body.sessions ?? []);
      }
    } catch (err) {
      setSessionsUnavailable(err instanceof Error ? err.message : 'Could not load sessions');
    } finally {
      setSessionsLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await auth.updateDisplayName(name);
    setBusy(false);
    if (res.error) setError(res.error);
    else setMessage('Profile saved.');
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await auth.updatePassword(password);
    setBusy(false);
    if (res.error) setError(res.error);
    else {
      setPassword('');
      setMessage('Password updated. You can keep using this browser session.');
    }
  }

  async function revokeSession(id: string) {
    setBusy(true);
    setError(null);
    try {
      const token = await auth.getAccessToken();
      const res = await fetch(`${resolveApiBaseUrl()}/me/sessions/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Revoke failed (${res.status})`);
      }
      setMessage('Session revoked.');
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (confirmDelete !== (auth.user?.email ?? '')) {
      setError('Type your email exactly to confirm deletion');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await auth.getAccessToken();
      const res = await fetch(`${resolveApiBaseUrl()}/me`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Delete failed (${res.status})`);
      }
      await auth.signOut('global');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  if (!auth.user) {
    return (
      <div className="page-container">
        <p>
          <Link to="/login">Sign in</Link> to manage your account.
        </p>
      </div>
    );
  }

  return (
    <div className="page-container account-page">
      <div className="page-header">
        <div>
          <p className="page-breadcrumb">
            <Link to="/app">Tournaments</Link>
            <span aria-hidden> / </span>
            <span>Account</span>
          </p>
          <h1>Account</h1>
          <p className="page-subtitle">Profile, security, and connected sign-in methods</p>
        </div>
      </div>

      <section className="account-hero">
        <div className="account-avatar" aria-hidden>
          {initials}
        </div>
        <div>
          <h2>{auth.displayName || 'Tournament manager'}</h2>
          <p>{auth.user.email}</p>
          <div className="account-badges">
            {providers.map((p) => (
              <span key={p.identityId} className="account-badge">
                {p.provider}
              </span>
            ))}
            {auth.isPlatformAdmin && (
              <span className="account-badge account-badge-admin">Platform admin</span>
            )}
          </div>
          {auth.isPlatformAdmin && (
            <p className="form-hint" style={{ marginTop: '0.5rem' }}>
              <Link to="/admin">Open Admin dashboard →</Link>
            </p>
          )}
        </div>
      </section>

      <div className="account-grid">
        <section className="account-panel">
          <h3>Profile</h3>
          <form className="auth-form" onSubmit={(e) => void saveProfile(e)}>
            <label>
              Display name
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Email
              <input className="input" value={auth.user.email ?? ''} disabled />
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Save profile
            </button>
          </form>
          <div className="account-actions">
            <button
              type="button"
              className="btn btn-outline"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  const res = await copySupportInfo({
                    email: auth.user?.email,
                    displayName: auth.displayName,
                  });
                  if (res.ok) setMessage('Support info copied to clipboard');
                  else setError(res.error);
                })();
              }}
            >
              Copy support info
            </button>
          </div>
          <p className="form-hint">
            Paste this when emailing support — includes app version, runtime, and last Sentry event
            id if any.
          </p>
        </section>

        <section className="account-panel">
          <h3>Security</h3>
          <form className="auth-form" onSubmit={(e) => void savePassword(e)}>
            <label>
              New password
              <input
                className="input"
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button className="btn btn-outline" type="submit" disabled={busy}>
              Update password
            </button>
          </form>
          <div className="account-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void auth.signOut('local')}
            >
              Sign out this browser
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void auth.signOut('global')}
            >
              Sign out all devices
            </button>
          </div>
        </section>

        <section className="account-panel">
          <h3>Connected devices</h3>
          {sessionsLoading && <p className="form-hint">Loading sessions…</p>}
          {sessionsUnavailable && <p className="form-hint">{sessionsUnavailable}</p>}
          {!sessionsLoading && !sessionsUnavailable && sessions.length === 0 && (
            <p className="form-hint">No active sessions found.</p>
          )}
          <ul className="account-sessions">
            {sessions.map((s) => (
              <li key={s.id}>
                <div className="account-sessions-row">
                  <div>
                    <strong>{shortAgent(s.userAgent)}</strong>
                    {s.current && <span className="account-session-current"> This browser</span>}
                    <div className="account-sessions-meta">
                      <span>Last active: {formatWhen(s.refreshedAt ?? s.updatedAt)}</span>
                      <span>Signed in: {formatWhen(s.createdAt)}</span>
                      {s.ip && <span>IP: {s.ip}</span>}
                    </div>
                  </div>
                  {!s.current && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => void revokeSession(s.id)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={sessionsLoading}
            onClick={() => void loadSessions()}
          >
            Refresh
          </button>
        </section>

        <section className="account-panel">
          <h3>Connected accounts</h3>
          <ul className="account-identity-list">
            {providers.map((p) => (
              <li key={p.identityId}>
                <span>{p.provider}</span>
                {providers.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void auth.unlinkIdentity(p.identityId)}
                  >
                    Unlink
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="auth-oauth">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => void auth.linkIdentity('google')}
            >
              Link Google
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => void auth.linkIdentity('github')}
            >
              Link GitHub
            </button>
          </div>
        </section>

        <section className="account-panel danger">
          <h3>Danger zone</h3>
          <p className="form-hint">
            Deletes your account and soft-deletes cloud tournaments you own. Local Dexie data on
            this device is not wiped automatically.
          </p>
          <label>
            Type <strong>{auth.user.email}</strong> to confirm
            <input
              className="input"
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => void deleteAccount()}
          >
            Delete account
          </button>
        </section>
      </div>

      {error && <div className="form-error">{error}</div>}
      {message && <p className="form-hint account-success">{message}</p>}
    </div>
  );
}
