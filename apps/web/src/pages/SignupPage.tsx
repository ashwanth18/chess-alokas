import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function SignupPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!auth.loading && auth.user) return <Navigate to="/app" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await auth.signUpWithPassword(email.trim(), password, displayName.trim());
    setBusy(false);
    if (res.error) setError(res.error);
    else {
      setMessage('Account created. Check your email if confirmation is required, then sign in.');
      navigate('/login');
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-knight">♞</span>
          <h1>Create manager account</h1>
          <p>Each account owns its own tournaments</p>
        </div>
        <form className="auth-form" onSubmit={(e) => void onSubmit(e)}>
          <label>
            Display name
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Tournament director"
            />
          </label>
          <label>
            Email
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy || !auth.configured}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <div className="auth-divider">or</div>
        <div className="auth-oauth">
          <button
            type="button"
            className="btn btn-outline"
            disabled={!auth.configured}
            onClick={() => void auth.signInWithOAuth('google')}
          >
            Google
          </button>
          <button
            type="button"
            className="btn btn-outline"
            disabled={!auth.configured}
            onClick={() => void auth.signInWithOAuth('github')}
          >
            GitHub
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
        {message && <p className="form-hint">{message}</p>}
        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
