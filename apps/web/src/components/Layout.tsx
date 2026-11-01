import { useState, useEffect, useCallback, FormEvent } from 'react';
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  apiListOrganizations,
  apiCreateOrganization,
  apiUpdateOrganization,
  apiCreatePlayerProfile,
  type UserOrganization,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { routeKeyFromAppPath, trackPageView } from '../lib/pageAnalytics';
import { useDeskSync } from '../shells/deskSync';
import { PENDING_SIGNUP_STORAGE_KEY } from '../lib/pendingSignup';

function formatSyncTime(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Layout() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // Null outside OrganizerShell: /player has no local database, so nothing here may mention sync.
  const desk = useDeskSync();
  const online = desk?.online ?? true;
  const syncing = desk?.syncing ?? false;
  const syncResult = desk?.message ?? null;
  const syncFailed = desk?.failed ?? false;
  const lastSync = desk?.lastSync ?? null;
  const rejections = desk?.rejections ?? [];
  const [menuOpen, setMenuOpen] = useState(false);

  const [organizations, setOrganizations] = useState<UserOrganization[]>([]);
  const [orgsLoaded, setOrgsLoaded] = useState(false);
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [orgFormName, setOrgFormName] = useState('');
  const [orgFormCity, setOrgFormCity] = useState('');
  const [orgFormState, setOrgFormState] = useState('');
  const [orgFormPhone, setOrgFormPhone] = useState('');
  const [orgFormPayment, setOrgFormPayment] = useState('');
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);

  const isPlayerWorkspace = location.pathname.startsWith('/player');
  const isOrganizerRoute =
    location.pathname === '/app' ||
    location.pathname.startsWith('/tournaments') ||
    location.pathname.startsWith('/certificates') ||
    location.pathname.startsWith('/simulator');

  const loadOrganizations = useCallback(async () => {
    if (!auth.user) return;
    const res = await apiListOrganizations();
    if (res.ok) {
      setOrganizations(res.data.organizations);
      const primary = res.data.organizations[0];
      if (primary) {
        setOrgFormName(primary.name);
        setOrgFormCity(primary.city ?? '');
        setOrgFormState(primary.state ?? '');
        setOrgFormPhone(primary.contactPhone ?? '');
        setOrgFormPayment(primary.paymentInstructions ?? '');
      }
      // Only on success: offline, "no organization yet" would be a false prompt to register one.
      setOrgsLoaded(true);
    }
  }, [auth.user]);

  useEffect(() => {
    void loadOrganizations();
  }, [loadOrganizations]);

  // Complete any pending signup action stored before email verification
  useEffect(() => {
    if (!auth.user) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PENDING_SIGNUP_STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      localStorage.removeItem(PENDING_SIGNUP_STORAGE_KEY);
      const pending = JSON.parse(raw) as {
        role?: 'participant' | 'organizer';
        displayName?: string;
        email?: string;
        orgName?: string;
        orgCity?: string;
        orgState?: string;
        orgPhone?: string;
      };
      void (async () => {
        if (pending.role === 'organizer' && pending.orgName) {
          const created = await apiCreateOrganization({
            name: pending.orgName,
            city: pending.orgCity || null,
            state: pending.orgState || null,
            contactPhone: pending.orgPhone || null,
            contactEmail: pending.email || auth.user?.email || null,
          });
          if (!created.ok) {
            setOrgFormName(pending.orgName);
            setOrgFormCity(pending.orgCity ?? '');
            setOrgFormState(pending.orgState ?? '');
            setOrgFormPhone(pending.orgPhone ?? '');
            setOrgError(`Your account is ready, but the organization was not registered: ${created.error}`);
            setOrgModalOpen(true);
            return;
          }
          await loadOrganizations();
        } else if (pending.role === 'participant') {
          if (pending.displayName) {
            await apiCreatePlayerProfile({
              fullName: pending.displayName,
              relationship: 'self',
              isPrimary: true,
              email: pending.email || auth.user?.email || null,
            });
          }
          if (location.pathname === '/app') {
            navigate('/player', { replace: true });
          }
        }
      })();
    } catch {
      /* ignore */
    }
  }, [auth.user, loadOrganizations, location.pathname, navigate]);

  useEffect(() => {
    const routeKey = routeKeyFromAppPath(location.pathname);
    if (!routeKey) return;
    const tournamentMatch = location.pathname.match(/^\/tournaments\/([^/]+)/);
    const tournamentId =
      tournamentMatch && tournamentMatch[1] && tournamentMatch[1] !== 'new'
        ? tournamentMatch[1]
        : null;
    trackPageView({
      routeKey,
      path: location.pathname,
      tournamentId,
    });
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  async function handleSaveOrganization(e: FormEvent) {
    e.preventDefault();
    if (!orgFormName.trim()) {
      setOrgError('Organization name is required.');
      return;
    }
    setOrgBusy(true);
    setOrgError(null);
    const activeOrg = organizations[0];
    if (activeOrg) {
      const res = await apiUpdateOrganization(activeOrg.id, {
        name: orgFormName.trim(),
        city: orgFormCity.trim() || null,
        state: orgFormState.trim() || null,
        contactPhone: orgFormPhone.trim() || null,
        paymentInstructions: orgFormPayment.trim() || null,
      });
      setOrgBusy(false);
      if (!res.ok) {
        setOrgError(res.error);
        return;
      }
    } else {
      const res = await apiCreateOrganization({
        name: orgFormName.trim(),
        city: orgFormCity.trim() || null,
        state: orgFormState.trim() || null,
        contactPhone: orgFormPhone.trim() || null,
        contactEmail: auth.user?.email ?? null,
        paymentInstructions: orgFormPayment.trim() || null,
      });
      setOrgBusy(false);
      if (!res.ok) {
        setOrgError(res.error);
        return;
      }
    }
    await loadOrganizations();
    setOrgModalOpen(false);
  }

  const label = auth.displayName || auth.user?.email?.split('@')[0] || 'Account';
  const closeMenu = () => setMenuOpen(false);
  const primaryOrg = organizations[0] ?? null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to={isPlayerWorkspace ? '/player' : '/app'} className="brand" onClick={closeMenu}>
          <span className="brand-knight" aria-hidden>
            ♕
          </span>
          <span className="brand-name">Chess Alokas</span>
        </NavLink>

        <div className="workspace-switcher" role="navigation" aria-label="Workspace switcher">
          <NavLink
            to="/player"
            className={({ isActive }) => `workspace-pill ${isActive ? 'active' : ''}`}
            onClick={closeMenu}
          >
            ♟ Player Portal
          </NavLink>
          <NavLink
            to="/app"
            className={() => `workspace-pill ${!isPlayerWorkspace ? 'active' : ''}`}
            onClick={closeMenu}
          >
            ♕ Organizer Desk
          </NavLink>
        </div>

        <button
          type="button"
          className="menu-toggle"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className={`hamburger ${menuOpen ? 'open' : ''}`} />
        </button>

        <nav className={`topnav ${menuOpen ? 'open' : ''}`} aria-label="Main">
          {isPlayerWorkspace ? (
            <>
              <NavLink to="/player" end onClick={closeMenu}>
                Dashboard &amp; Family
              </NavLink>
              <NavLink to="/discover" onClick={closeMenu}>
                Explore Events
              </NavLink>
              <NavLink to="/account" onClick={closeMenu}>
                Account
              </NavLink>
              <NavLink to="/settings" onClick={closeMenu}>
                Settings
              </NavLink>
            </>
          ) : (
            <>
              <NavLink to="/app" end onClick={closeMenu}>
                Tournaments
              </NavLink>
              <NavLink to="/tournaments/new" onClick={closeMenu}>
                New
              </NavLink>
              <NavLink to="/discover" onClick={closeMenu}>
                Explore Events
              </NavLink>
              <NavLink to="/certificates" onClick={closeMenu}>
                Certificates
              </NavLink>
              <NavLink to="/simulator" onClick={closeMenu}>
                Simulator
              </NavLink>
              <NavLink to="/account" onClick={closeMenu}>
                Account
              </NavLink>
              <NavLink to="/settings" onClick={closeMenu}>
                Settings
              </NavLink>
            </>
          )}
          {auth.isPlatformAdmin && (
            <NavLink to="/admin" onClick={closeMenu}>
              Admin
            </NavLink>
          )}
          <div className="topnav-mobile-actions">
            {desk && (
              <button
                type="button"
                className="btn btn-sm btn-sync"
                onClick={() => {
                  desk.sync();
                  closeMenu();
                }}
                disabled={!online || syncing || !auth.user}
              >
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                closeMenu();
                void auth.signOut('local');
              }}
            >
              Sign out
            </button>
            {!window.desktop?.isDesktop && (
              <Link to="/" className="btn btn-sm btn-outline" onClick={closeMenu}>
                Marketing home
              </Link>
            )}
          </div>
        </nav>

        <div className="sync-bar">
          <Link to="/account" className="user-chip" title={auth.user?.email ?? 'Account'}>
            {label}
          </Link>
          {desk && (
            <>
              <span
                className={`status-dot ${online ? 'online' : 'offline'}`}
                title={online ? 'API reachable' : 'Offline'}
              />
              <span className="status-label">{online ? 'Online' : 'Offline'}</span>
              {/* Never "Synced" while the banner below says something was refused. */}
              {lastSync && rejections.length === 0 && (
                <span className="sync-time" title={lastSync}>
                  Synced {formatSyncTime(lastSync)}
                </span>
              )}
              <button
                type="button"
                className="btn btn-sm btn-sync"
                onClick={desk.sync}
                disabled={!online || syncing || !auth.user}
                title={!auth.user ? 'Sign in to sync' : !online ? 'Offline' : 'Sync with cloud'}
              >
                {syncing ? 'Syncing…' : 'Sync'}
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void auth.signOut('local')}
          >
            Sign out
          </button>
        </div>
      </header>

      {syncResult && (
        <div className={`sync-toast${syncFailed ? ' is-error' : ''}`} role="status">
          {syncResult}
        </div>
      )}

      {rejections.length > 0 && (
        <div className="sync-rejections" role="alert">
          <strong>
            {rejections.length} change{rejections.length === 1 ? ' was' : 's were'} not saved online
          </strong>
          <span className="form-hint">
            They are still on this device and retry at every sync. Other devices and the live page
            won’t show them until this is resolved.
          </span>
          <ul>
            {rejections.slice(0, 6).map((r) => (
              <li key={`${r.entity}:${r.id}`}>
                {r.label}: {r.reason}
              </li>
            ))}
          </ul>
          {rejections.length > 6 && <span className="form-hint">…and {rejections.length - 6} more</span>}
        </div>
      )}

      {isOrganizerRoute && orgsLoaded && (!primaryOrg || primaryOrg.planTier === 'trial' || primaryOrg.verificationStatus !== 'verified') && (
        <div className="desktop-update-banner" role="region" aria-label="Organization status">
          <div className="desktop-update-banner-copy">
            {primaryOrg ? (
              <>
                <strong>
                  {primaryOrg.name} ·{' '}
                  {primaryOrg.planTier === 'trial'
                    ? 'Sandbox Trial'
                    : primaryOrg.planTier.toUpperCase()}{' '}
                  ({primaryOrg.verificationStatus.replace('_', ' ')})
                </strong>
                <span>
                  {primaryOrg.planTier === 'trial'
                    ? `Trial quota: up to ${primaryOrg.maxTournamentsQuota ?? 1} active tournament and ${primaryOrg.maxPlayersPerTournament ?? 24} players per tournament. Verified organizers unlock public event discovery & higher limits.`
                    : 'Verification pending — once verified by platform admin, global event discovery is enabled.'}
                </span>
              </>
            ) : (
              <>
                <strong>Set up your Organizer / Academy profile</strong>
                <span>
                  Register your organization to manage team members, payment instructions, and B2B verification.
                </span>
              </>
            )}
          </div>
          <div className="desktop-update-banner-actions">
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => {
                setOrgError(null);
                setOrgModalOpen(true);
              }}
            >
              {primaryOrg ? 'Organization & Trial Info' : '+ Register Organization'}
            </button>
          </div>
        </div>
      )}

      {orgModalOpen && (
        <div className="modal-backdrop" onClick={() => setOrgModalOpen(false)}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Organization settings"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>{primaryOrg ? 'Organization & B2B Status' : 'Register Organization / Academy'}</h2>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setOrgModalOpen(false)}
              >
                ✕
              </button>
            </div>
            {primaryOrg && (
              <div className="org-quota-box" style={{ marginBottom: '1rem' }}>
                <p className="form-hint" style={{ margin: 0 }}>
                  <strong>Plan tier:</strong> {primaryOrg.planTier.toUpperCase()} ·{' '}
                  <strong>Verification:</strong> {primaryOrg.verificationStatus.replace('_', ' ')} ·{' '}
                  <strong>Max tournaments:</strong>{' '}
                  {primaryOrg.maxTournamentsQuota ?? 'Unlimited'} ·{' '}
                  <strong>Max players/event:</strong>{' '}
                  {primaryOrg.maxPlayersPerTournament ?? 'Unlimited'}
                </p>
              </div>
            )}
            <form className="auth-form" onSubmit={(e) => void handleSaveOrganization(e)}>
              <label>
                Organization / Academy Name
                <input
                  className="input"
                  value={orgFormName}
                  onChange={(e) => setOrgFormName(e.target.value)}
                  placeholder="e.g. KL Junior Chess Academy"
                  required
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                <label>
                  City
                  <input
                    className="input"
                    value={orgFormCity}
                    onChange={(e) => setOrgFormCity(e.target.value)}
                    placeholder="Kuala Lumpur"
                  />
                </label>
                <label>
                  State
                  <input
                    className="input"
                    value={orgFormState}
                    onChange={(e) => setOrgFormState(e.target.value)}
                    placeholder="Selangor / WP KL"
                  />
                </label>
              </div>
              <label>
                Contact Phone / WhatsApp
                <input
                  className="input"
                  value={orgFormPhone}
                  onChange={(e) => setOrgFormPhone(e.target.value)}
                  placeholder="+60 12-345 6789"
                />
              </label>
              <label>
                Payment Instructions (DuitNow / Bank Transfer info for participants)
                <textarea
                  className="input"
                  rows={3}
                  value={orgFormPayment}
                  onChange={(e) => setOrgFormPayment(e.target.value)}
                  placeholder="Maybank 5140-xxxx-xxxx (KL Junior Chess Academy)"
                />
              </label>
              {orgError && <div className="form-error">{orgError}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setOrgModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={orgBusy}>
                  {orgBusy ? 'Saving…' : primaryOrg ? 'Save Organization' : 'Create Organization'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {menuOpen && (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="Close menu"
          onClick={closeMenu}
        />
      )}

      <main className="page-content">
        <Outlet />
      </main>

      <footer className="app-footer">
        <span>
          Chess Alokas · Tournament management that keeps working offline
          {window.desktop?.isDesktop ? (
            <>
              {' '}
              · <span className="app-footer-version">v{window.desktop.getAppVersion()}</span>
            </>
          ) : null}
        </span>
        <span className="app-footer-links">
          {!window.desktop?.isDesktop && (
            <Link to="/" className="app-footer-link">
              Home
            </Link>
          )}
          <Link to="/discover" className="app-footer-link">
            Explore Events
          </Link>
          <Link to="/player" className="app-footer-link">
            Player Portal
          </Link>
          <Link to="/app" className="app-footer-link">
            Organizer Desk
          </Link>
          <Link to="/account" className="app-footer-link">
            Account
          </Link>
          <Link to="/settings" className="app-footer-link">
            Settings
          </Link>
        </span>
      </footer>
    </div>
  );
}
