import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AuthShell from '../components/AuthShell';
import { reportBootIssue } from '../lib/bootDiagnostics';
import BootIssueCard from '../components/BootIssueCard';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setError('Auth is not configured');
      return;
    }
    const timer = window.setTimeout(() => {
      reportBootIssue(
        'AUTH_CALLBACK_TIMEOUT',
        'Sign-in callback did not finish within 12 seconds.',
      );
      setError('Sign-in is taking too long. Try again, or open chess-manager.alokas.com.');
    }, 12_000);
    void supabase.auth.getSession().then(({ data, error: err }) => {
      window.clearTimeout(timer);
      if (err) {
        reportBootIssue('AUTH_SESSION_FAILED', err.message);
        setError(err.message);
      } else if (data.session) navigate('/app', { replace: true });
      else {
        reportBootIssue(
          'AUTH_SESSION_FAILED',
          'No session returned after sign-in redirect.',
        );
        setError('No session returned. Try signing in again.');
      }
    });
    return () => window.clearTimeout(timer);
  }, [navigate]);

  return (
    <AuthShell title="Completing sign-in…" subtitle="Finishing your secure session">
      {error ? (
        <>
          <div className="form-error">{error}</div>
          <BootIssueCard />
          <div className="empty-actions" style={{ marginTop: '1rem' }}>
            <Link className="btn btn-primary" to="/login">
              Back to sign in
            </Link>
            <Link className="btn btn-outline" to="/">
              Home
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="form-hint">Please wait…</p>
          <BootIssueCard />
        </>
      )}
    </AuthShell>
  );
}
