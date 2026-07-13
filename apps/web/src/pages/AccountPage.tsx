import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { resolveApiBaseUrl } from '../api/client';

export default function AccountPage() {
  const auth = useAuth();
  const [name, setName] = useState(auth.displayName ?? '');
  const [password, setPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await auth.updateDisplayName(name);
    setBusy(false);
    if (res.error) setError(res.error);
    else setMessage('Profile saved');
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await auth.updatePassword(password);
    setBusy(false);
    if (res.error) setError(res.error);
    else {
      setPassword('');
      setMessage('Password updated');
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
          </div>
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
              Sign out this device
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void auth.signOut('global')}
            >
              Sign out everywhere
            </button>
          </div>
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
      {message && <p className="form-hint">{message}</p>}
    </div>
  );
}
