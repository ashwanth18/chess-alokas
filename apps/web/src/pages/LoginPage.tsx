import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

type Tab = 'password' | 'otp';

export default function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!auth.loading && auth.user) return <Navigate to="/" replace />;

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await auth.signInWithPassword(email.trim(), password);
    setBusy(false);
    if (res.error) setError(res.error);
    else navigate('/');
  }

  async function onSendOtp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await auth.signInWithOtp(email.trim());
    setBusy(false);
    if (res.error) setError(res.error);
    else {
      setOtpSent(true);
      setMessage('Check your email for a magic link or 6-digit code.');
    }
  }

  async function onVerifyOtp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await auth.verifyOtp(email.trim(), otp.trim());
    setBusy(false);
    if (res.error) setError(res.error);
    else navigate('/');
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-knight">♞</span>
          <h1>Chess Alokas</h1>
          <p>Sign in to manage your tournaments</p>
        </div>

        {!auth.configured && (
          <div className="form-error">
            Auth is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
          </div>
        )}

        <div className="auth-tabs">
          <button
            type="button"
            className={`cat-tab ${tab === 'password' ? 'active' : ''}`}
            onClick={() => setTab('password')}
          >
            Email &amp; password
          </button>
          <button
            type="button"
            className={`cat-tab ${tab === 'otp' ? 'active' : ''}`}
            onClick={() => setTab('otp')}
          >
            Email code
          </button>
        </div>

        {tab === 'password' ? (
          <form className="auth-form" onSubmit={(e) => void onPassword(e)}>
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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy || !auth.configured}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form
            className="auth-form"
            onSubmit={(e) => void (otpSent ? onVerifyOtp(e) : onSendOtp(e))}
          >
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
            {otpSent && (
              <label>
                6-digit code
                <input
                  className="input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  required
                />
              </label>
            )}
            <button className="btn btn-primary" type="submit" disabled={busy || !auth.configured}>
              {busy ? 'Please wait…' : otpSent ? 'Verify code' : 'Send code / magic link'}
            </button>
          </form>
        )}

        <div className="auth-divider">or continue with</div>
        <div className="auth-oauth">
          <button
            type="button"
            className="btn btn-outline"
            disabled={!auth.configured || busy}
            onClick={() => void auth.signInWithOAuth('google')}
          >
            Google
          </button>
          <button
            type="button"
            className="btn btn-outline"
            disabled={!auth.configured || busy}
            onClick={() => void auth.signInWithOAuth('github')}
          >
            GitHub
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}
        {message && <p className="form-hint">{message}</p>}

        <p className="auth-footer">
          No account? <Link to="/signup">Create one</Link>
          {' · '}
          <Link to="/auth/reset">Forgot password</Link>
        </p>
      </div>
    </div>
  );
}
