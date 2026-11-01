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
    const params = new URLSearchParams(window.location.search);
    const errParam = params.get('error_description') || params.get('error');
    if (errParam) {
      reportBootIssue('AUTH_SESSION_FAILED', errParam);
      setError(errParam);
      return;
    }

    let settled = false;
    const finishSuccess = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      navigate('/app', { replace: true });
    };

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reportBootIssue(
        'AUTH_CALLBACK_TIMEOUT',
        'Sign-in callback did not finish within 12 seconds.',
      );
      setError('Sign-in is taking too long. Try again, or open chess-manager.alokas.com.');
    }, 12_000);

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finishSuccess();
    });

    void supabase.auth.getSession().then(({ data, error: err }) => {
      if (settled) return;
      if (err) {
        settled = true;
        window.clearTimeout(timer);
        reportBootIssue('AUTH_SESSION_FAILED', err.message);
        setError(err.message);
      } else if (data.session) {
        finishSuccess();
      }
    });
    return () => {
      settled = true;
      window.clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
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
