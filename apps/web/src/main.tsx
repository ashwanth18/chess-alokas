import './instrument';

import { Component, StrictMode, Suspense, lazy, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { reactErrorHandler } from '@sentry/react';
import './design/app.css';

import { AuthProvider, useAuth } from './auth/AuthContext';
import DesktopUpdateBanner from './components/DesktopUpdateBanner';
import BootIssueCard from './components/BootIssueCard';
import { trackDesktopPresence } from './lib/productTelemetry';
import { reportBootIssue } from './lib/bootDiagnostics';
import RouteTitle from './components/RouteTitle';
import ParticipantShell from './shells/ParticipantShell';
import FloorSurface from './shells/FloorSurface';
import HallSurface from './shells/HallSurface';
import { BootSplash, RequireAuth, isDesktop } from './shells/gates';

// Dexie, sync and the desktop backup agent live behind this one lazy import. See src/shells.
const OrganizerShell = lazy(() => import('./shells/OrganizerShell'));
const Layout = lazy(() => import('./components/Layout'));
const BackupPage = lazy(() =>
  import('./components/IndexedDbRecovery').then((m) => ({ default: m.BackupPage })),
);
// Component sheet: stripped from production builds, because this condition is compile-time false there.
const UiGallery =
  import.meta.env.DEV || import.meta.env.MODE === 'e2e' ? lazy(() => import('./ui/UiGallery')) : null;

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
const TeamPage = lazy(() => import('./pages/team/TeamPage'));
const InvitePage = lazy(() => import('./pages/team/InvitePage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const PlayerPortalPage = lazy(() => import('./pages/PlayerPortalPage'));
const DiscoverEventsPage = lazy(() => import('./pages/DiscoverEventsPage'));
const EventRegistrationPage = lazy(() => import('./pages/EventRegistrationPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const TableScoringPage = lazy(() => import('./pages/TableScoringPage'));
const LivePage = lazy(() => import('./pages/LivePage'));
const LiveTvPage = lazy(() => import('./pages/LiveTvPage'));
const PrivacyPage = lazy(() => import('./pages/legal/PrivacyPage'));
const TermsPage = lazy(() => import('./pages/legal/TermsPage'));
const MobileAppPage = lazy(() => import('./pages/mobile-app/MobileAppPage'));

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

/** Guests see marketing landing; signed-in users go to the tournament dashboard. */
function RootEntry() {
  const auth = useAuth();
  if (isDesktop) return <Navigate to="/app" replace />;
  if (!auth.configured) return <Navigate to="/app" replace />;
  if (auth.loading) {
    return <BootSplash />;
  }
  if (auth.user) return <Navigate to="/app" replace />;
  return <LandingPage />;
}

function AppRoot() {
  return (
    <AuthProvider>
      <Router>
        <>
          <DesktopUpdateBanner />
          <ProductTelemetry />
          <RouteTitle />
          <Suspense fallback={<BootSplash />}>
          <Routes>
          {/* Family: no Dexie, no sync. e2e/shells.spec.ts enforces this. */}
          <Route element={<ParticipantShell />}>
            <Route path="/" element={<RootEntry />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/auth/reset" element={<ResetPasswordPage />} />
            <Route path="/live/:token" element={<LivePage />} />
            <Route path="/live/:token/p/:playerId" element={<LivePage />} />
            <Route path="/discover" element={<DiscoverEventsPage />} />
            <Route path="/register/:slug" element={<EventRegistrationPage />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/mobile-app" element={<MobileAppPage />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route path="/player" element={<PlayerPortalPage />} />
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
          </Route>
          {/* Chrome-free surfaces. */}
          <Route element={<FloorSurface />}>
            <Route path="/t/:slug" element={<TableScoringPage />} />
          </Route>
          <Route element={<HallSurface />}>
            <Route path="/live/:token/tv" element={<LiveTvPage />} />
          </Route>
          {/* The desk: opens the local database, then sync. */}
          <Route element={<OrganizerShell />}>
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
              <Route path="/team" element={<TeamPage />} />
              <Route path="/backups" element={<BackupPage />} />
              <Route path="/admin" element={<AdminPage />} />
            </Route>
          </Route>
          {UiGallery && <Route path="/__ui" element={<UiGallery />} />}
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
