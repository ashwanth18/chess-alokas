import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

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
      else if (data.session) navigate('/', { replace: true });
      else setError('No session returned. Try signing in again.');
    });
  }, [navigate]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Completing sign-in…</h1>
        {error ? (
          <>
            <div className="form-error">{error}</div>
            <Link className="btn btn-primary" to="/login">
              Back to login
            </Link>
          </>
        ) : (
          <p className="form-hint">Please wait</p>
        )}
      </div>
    </div>
  );
}
