import './instrument';

import { Component, StrictMode, Suspense, lazy, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { reactErrorHandler } from '@sentry/react';
import './index.css';

import { AuthProvider, useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import DesktopUpdateBanner from './components/DesktopUpdateBanner';
import BootIssueCard from './components/BootIssueCard';
import IndexedDbRecovery, { BackupPage, DesktopBackupAgent } from './components/IndexedDbRecovery';
import { trackDesktopPresence } from './lib/productTelemetry';
import { ensureDbOpen } from './db/local';
import { reportBootIssue } from './lib/bootDiagnostics';
import RouteTitle from './components/RouteTitle';

const HomePage = lazy(() => import('./pages/HomePage'));
const CreateTournamentPage = lazy(() => import('./pages/CreateTournamentPage'));
const TournamentPage = lazy(() => import('./pages/TournamentPage'));
const ImportPage = lazy(() => import('./pages/ImportPage'));
const SimulatorPage = lazy(() => import('./pages/SimulatorPage'));
const CertificatesPage = lazy(() => import('./pages/CertificatesPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const PlayerPortalPage = lazy(() => import('./pages/PlayerPortalPage'));
const DiscoverEventsPage = lazy(() => import('./pages/DiscoverEventsPage'));
const EventRegistrationPage = lazy(() => import('./pages/EventRegistrationPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const TableScoringPage = lazy(() => import('./pages/TableScoringPage'));
const LivePage = lazy(() => import('./pages/LivePage'));
const LiveTvPage = lazy(() => import('./pages/LiveTvPage'));

const isDesktop =
  Boolean(typeof window !== 'undefined' && window.desktop?.isDesktop) ||
  import.meta.env.VITE_DESKTOP === '1';

if (import.meta.env.VITE_DESKTOP !== '1') {
  void import('./pwaRegister');
}

if (typeof document !== 'undefined' && isDesktop) {
  document.documentElement.classList.add('is-desktop');
  const platform = window.desktop?.platform;
  if (platform === 'darwin') document.documentElement.classList.add('is-desktop-mac');
  else if (platform === 'win32') document.documentElement.classList.add('is-desktop-win');
  else document.documentElement.classList.add('is-desktop-linux');
}

const Router = isDesktop ? HashRouter : BrowserRouter;

function ProductTelemetry() {
  useEffect(() => {
    trackDesktopPresence();
  }, []);
  return null;
}

function SessionLoading({ title }: { title: string }) {
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

function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  if (!auth.configured) {
    // Packaged desktop must never silently skip login.
    if (isDesktop) {
      return (
        <div className="auth-page">
          <div className="auth-card">
            <h1>Sign-in unavailable</h1>
            <p className="form-hint">
              This desktop build is missing auth configuration. Please download the latest installer
              from chess-manager.alokas.com.
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
  if (!auth.user) return <Navigate to="/login" replace />;
  return (
    <>
      {auth.sessionOffline && (
        <div className="form-hint" role="status" style={{ padding: '0.35rem 1rem', textAlign: 'center' }}>
          Working offline with your saved sign-in. Your work stays on this device and syncs once the
          connection returns.
        </div>
      )}
      {children}
    </>
  );
}

/** Guests see marketing landing; signed-in users go to the tournament dashboard. */
function RootEntry() {
  const auth = useAuth();
  if (isDesktop) return <Navigate to="/app" replace />;
  if (!auth.configured) return <Navigate to="/app" replace />;
  if (auth.loading) {
    return <SessionLoading title="Loading" />;
  }
  if (auth.user) return <Navigate to="/app" replace />;
  return <LandingPage />;
}

function AppRoot() {
  const [dbReady, setDbReady] = useState(false);
  const [dbFailed, setDbFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      reportBootIssue(
        'INDEXEDDB_OPEN_FAILED',
        'The local tournament database took too long to open.',
        'Timed out after 12s',
      );
      setDbFailed('Timed out opening the local database.');
    }, 12_000);

    void ensureDbOpen().then((result) => {
      if (cancelled) return;
      window.clearTimeout(timeout);
      if (result.ok) {
        setDbReady(true);
        return;
      }
      reportBootIssue(
        'INDEXEDDB_OPEN_FAILED',
        'The local tournament database could not open on this computer.',
        result.error.message,
      );
      setDbFailed(result.error.message);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  if (dbFailed) return <IndexedDbRecovery details={dbFailed} />;
  if (!dbReady) return <SessionLoading title="Starting" />;

  return (
    <AuthProvider>
      <Router>
        <>
          <DesktopUpdateBanner />
          <ProductTelemetry />
          {isDesktop && <DesktopBackupAgent />}
          <RouteTitle />
          <Suspense fallback={<SessionLoading title="Loading" />}>
          <Routes>
          <Route path="/" element={<RootEntry />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/auth/reset" element={<ResetPasswordPage />} />
          <Route path="/t/:slug" element={<TableScoringPage />} />
          <Route path="/live/:token" element={<LivePage />} />
          <Route path="/live/:token/tv" element={<LiveTvPage />} />
          <Route path="/live/:token/p/:playerId" element={<LivePage />} />
          <Route path="/discover" element={<DiscoverEventsPage />} />
          <Route path="/register/:slug" element={<EventRegistrationPage />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/app" element={<HomePage />} />
            <Route path="/player" element={<PlayerPortalPage />} />
            <Route path="/tournaments/new" element={<CreateTournamentPage />} />
            <Route path="/tournaments/:id" element={<TournamentPage />} />
            <Route path="/tournaments/:id/import" element={<ImportPage />} />
            <Route path="/certificates" element={<CertificatesPage />} />
            <Route path="/simulator" element={<SimulatorPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/backups" element={<BackupPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Route>
          <Route
            path="*"
            element={
              <div className="auth-page">
                <div className="auth-card">
                  <h1>Page not found</h1>
                  <p className="form-hint">This screen did not match a route. Open the tournament list to continue.</p>
                  <Link className="btn btn-primary" to="/app">
                    Go to tournaments
                  </Link>
                </div>
              </div>
            }
          />
          </Routes>
          </Suspense>
        </>
      </Router>
    </AuthProvider>
  );
}

/** A render error must not leave a blank window in the middle of a tournament. */
class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    reportBootIssue('RENDER_ERROR', error.message.slice(0, 300), info.componentStack ?? '');
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>This screen hit a problem</h1>
          <p className="form-hint">Your tournament data is safe on this device.</p>
          <BootIssueCard />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              window.location.hash = '';
              window.location.reload();
            }}
          >
            Reload the app
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!, {
  onUncaughtError: reactErrorHandler(),
  onCaughtError: reactErrorHandler(),
  onRecoverableError: reactErrorHandler(),
}).render(
  <StrictMode>
    <AppErrorBoundary>
      <AppRoot />
    </AppErrorBoundary>
  </StrictMode>,
);
