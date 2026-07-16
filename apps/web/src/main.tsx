import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';

import { AuthProvider, useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import DesktopUpdateBanner from './components/DesktopUpdateBanner';
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
import LandingPage from './pages/LandingPage';
import TableScoringPage from './pages/TableScoringPage';

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
          </div>
        </div>
      );
    }
    return <>{children}</>;
  }
  if (auth.loading) {
    return (
      <div className="auth-page">
        <p className="form-hint">Loading session…</p>
      </div>
    );
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
    return (
      <div className="auth-page">
        <p className="form-hint">Loading…</p>
      </div>
    );
  }
  if (auth.user) return <Navigate to="/app" replace />;
  return <LandingPage />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <Router>
        <>
          <DesktopUpdateBanner />
          <Routes>
          <Route path="/" element={<RootEntry />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/auth/reset" element={<ResetPasswordPage />} />
          <Route path="/t/:slug" element={<TableScoringPage />} />
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
          </Route>
          </Routes>
        </>
      </Router>
    </AuthProvider>
  </StrictMode>,
);
