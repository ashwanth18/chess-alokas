import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { loginPathFor } from '../auth/returnTo';
import BootIssueCard from '../components/BootIssueCard';

export const isDesktop =
  Boolean(typeof window !== 'undefined' && window.desktop?.isDesktop) || import.meta.env.VITE_DESKTOP === '1';

export function SessionLoading({ title }: { title: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 4000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>{title}</h1>
        <p className="form-hint">
          {slow ? 'This is taking longer than usual. If it stays here, copy the error below.' : 'Please wait…'}
        </p>
        <BootIssueCard />
      </div>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (!auth.configured) {
    // Packaged desktop must never silently skip login.
    if (isDesktop) {
      return (
        <div className="auth-page">
          <div className="auth-card">
            <h1>Sign-in unavailable</h1>
            <p className="form-hint">
              This desktop build is missing auth configuration. Please download the latest installer from
              chess-manager.alokas.com.
            </p>
            <BootIssueCard />
          </div>
        </div>
      );
    }
    return <>{children}</>;
  }
  if (auth.loading) {
    return <SessionLoading title="Loading session" />;
  }
  if (!auth.user) {
    // /app is where sign-in leads anyway, so it needs no return path.
    const here = location.pathname + location.search;
    return <Navigate to={location.pathname === '/app' ? '/login' : loginPathFor(here)} replace />;
  }
  return (
    <>
      {auth.sessionOffline && (
        <div className="form-hint" role="status" style={{ padding: '0.35rem 1rem', textAlign: 'center' }}>
          Working offline with your saved sign-in. Your work stays on this device and syncs once the connection
          returns.
        </div>
      )}
      {children}
    </>
  );
}
