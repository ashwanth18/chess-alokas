import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AuthShell from '../components/AuthShell';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setError('Auth is not configured');
      return;
    }
    void supabase.auth.getSession().then(({ data, error: err }) => {
      if (err) setError(err.message);
      else if (data.session) navigate('/app', { replace: true });
      else setError('No session returned. Try signing in again.');
    });
  }, [navigate]);

  return (
    <AuthShell title="Completing sign-in…" subtitle="Finishing your secure session">
      {error ? (
        <>
          <div className="form-error">{error}</div>
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
        <p className="form-hint">Please wait…</p>
      )}
    </AuthShell>
  );
}
