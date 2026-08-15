import './instrument';

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { reactErrorHandler } from '@sentry/react';
import './index.css';

import { AuthProvider, useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import DesktopUpdateBanner from './components/DesktopUpdateBanner';
import BootIssueCard from './components/BootIssueCard';
import IndexedDbRecovery from './components/IndexedDbRecovery';
import { trackDesktopPresence } from './lib/productTelemetry';
import { ensureDbOpen } from './db/local';
import { reportBootIssue } from './lib/bootDiagnostics';
import HomePage from './pages/HomePage';
import CreateTournamentPage from './pages/CreateTournamentPage';
import TournamentPage from './pages/TournamentPage';
import ImportPage from './pages/ImportPage';
import SimulatorPage from './pages/SimulatorPage';
import CertificatesPage from './pages/CertificatesPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import AccountPage from './pages/AccountPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';
import LandingPage from './pages/LandingPage';
import TableScoringPage from './pages/TableScoringPage';
import LivePage from './pages/LivePage';

const isDesktop =
  Boolean(typeof window !== 'undefined' && window.desktop?.isDesktop) ||
  import.meta.env.VITE_DESKTOP === '1';

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
  return <>{children}</>;
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
    void ensureDbOpen().then((result) => {
      if (cancelled) return;
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
          <Routes>
          <Route path="/" element={<RootEntry />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/auth/reset" element={<ResetPasswordPage />} />
          <Route path="/t/:slug" element={<TableScoringPage />} />
          <Route path="/live/:token" element={<LivePage />} />
          <Route path="/live/:token/p/:playerId" element={<LivePage />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/app" element={<HomePage />} />
            <Route path="/tournaments/new" element={<CreateTournamentPage />} />
            <Route path="/tournaments/:id" element={<TournamentPage />} />
            <Route path="/tournaments/:id/import" element={<ImportPage />} />
            <Route path="/certificates" element={<CertificatesPage />} />
            <Route path="/simulator" element={<SimulatorPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Route>
          </Routes>
        </>
      </Router>
    </AuthProvider>
  );
}

createRoot(document.getElementById('root')!, {
  onUncaughtError: reactErrorHandler(),
  onCaughtError: reactErrorHandler(),
  onRecoverableError: reactErrorHandler(),
}).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
