import { FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import AuthShell from '../components/AuthShell';
import BootIssueCard from '../components/BootIssueCard';
import { trackPageView } from '../lib/pageAnalytics';

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

  useEffect(() => {
    trackPageView({ routeKey: 'login', path: '/login' });
  }, []);

  if (!auth.loading && auth.user) return <Navigate to="/app" replace />;

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await auth.signInWithPassword(email.trim(), password);
    setBusy(false);
    if (res.error) setError(res.error);
    else navigate('/app');
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
    else navigate('/app');
  }

  return (
    <AuthShell title="Sign in" subtitle="Manage your tournaments on any device">
      <BootIssueCard />
      {!auth.configured && (
        <div className="form-error">
          Auth is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
        </div>
      )}

      <div className="auth-tabs" role="tablist" aria-label="Sign-in method">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'password'}
          className={`cat-tab ${tab === 'password' ? 'active' : ''}`}
          onClick={() => setTab('password')}
        >
          Email &amp; password
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'otp'}
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
      <p className="auth-footer auth-footer-secondary">
        <Link to="/">← Back to Chess Alokas home</Link>
      </p>
    </AuthShell>
  );
}
