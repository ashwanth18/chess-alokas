import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import AuthShell from '../components/AuthShell';

export default function ResetPasswordPage() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const recovering = Boolean(auth.session);

  async function onRequest(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await auth.resetPassword(email.trim());
    setBusy(false);
    if (res.error) setError(res.error);
    else setMessage('Password reset email sent. Open the link, then set a new password here.');
  }

  async function onUpdate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await auth.updatePassword(password);
    setBusy(false);
    if (res.error) setError(res.error);
    else setMessage('Password updated. You can continue to your tournaments.');
  }

  return (
    <AuthShell
      title={recovering ? 'Set new password' : 'Reset password'}
      subtitle={recovering ? 'Choose a new password for your account' : 'We’ll email you a reset link'}
    >
      {recovering ? (
        <form className="auth-form" onSubmit={(e) => void onUpdate(e)}>
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
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Update password
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={(e) => void onRequest(e)}>
          <label>
            Email
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Send reset link
          </button>
        </form>
      )}
      {error && <div className="form-error">{error}</div>}
      {message && <p className="form-hint">{message}</p>}
      <p className="auth-footer">
        <Link to="/login">Back to sign in</Link>
        {recovering && (
          <>
            {' · '}
            <Link to="/app">Tournaments</Link>
          </>
        )}
      </p>
      <p className="auth-footer auth-footer-secondary">
        <Link to="/">← Back to Chess Alokas home</Link>
      </p>
    </AuthShell>
  );
}
