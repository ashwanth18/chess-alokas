import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { loginPathFor } from '../auth/returnTo';
import { useWorkspace } from '../auth/WorkspaceContext';
import { deskHomeRedirect, isDesktop } from '../auth/workspace';
import BootIssueCard from '../components/BootIssueCard';
import { hasPendingOrganizerSignup } from '../lib/pendingSignup';
import { Mark } from '../ui/icons';

export { isDesktop };

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

/**
 * While a route's code loads: the same paper screen as the boot splash in index.html, whose styles
 * stay in the head. So a parent never sees a flash of legacy green between splash and page.
 */
export function BootSplash() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 4000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div id="boot-splash" role="status">
      <div>
        <Mark />
        Chess Alokas
        <p>{slow ? 'This is taking longer than usual.' : 'Loading…'}</p>
        {slow && <BootIssueCard />}
      </div>
    </div>
  );
}

/**
 * In front of OrganizerShell, so a player sent away from `/app` never downloads the desk. Every other
 * desk URL passes straight through, and it stays one `Outlet` so moving around never remounts the shell.
 */
export function DeskGate() {
  const auth = useAuth();
  const location = useLocation();
  const workspace = useWorkspace();
  if (location.pathname === '/app' && auth.configured) {
    if (auth.loading) return <BootSplash />;
    if (auth.user) {
      if (workspace.resolving) return <BootSplash />;
      const to = deskHomeRedirect(workspace.facts, {
        desktop: isDesktop,
        settingUp: new URLSearchParams(location.search).has('setup'),
        pendingOrganizer: hasPendingOrganizerSignup(),
      });
      if (to) return <Navigate to={to} replace />;
    }
  }
  return <Outlet />;
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
    // /app is the front door, and sign-in already finds each person's own, so it needs no return path.
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
