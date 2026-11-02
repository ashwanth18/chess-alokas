import { useState, useEffect, FormEvent } from 'react';
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  apiCreateOrganization,
  apiUpdateOrganization,
  apiCreatePlayerProfile,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../auth/WorkspaceContext';
import { areaHome, currentArea, isArbiterOnly, isDesktop } from '../auth/workspace';
import AccountMenu, { AccountMenuItems } from './AccountMenu';
import { routeKeyFromAppPath, trackPageView } from '../lib/pageAnalytics';
import { isDemoUser } from '../lib/demoAccount';
import { DemoNotice } from './DemoNotice';
import { useDeskSync } from '../shells/deskSync';
import { PENDING_SIGNUP_STORAGE_KEY } from '../lib/pendingSignup';
import { BrandCrown } from '../ui/BrandCrown';

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

  const workspace = useWorkspace();
  const { facts, refresh: refreshWorkspace } = workspace;
  const organizations = workspace.organizations ?? [];
  // Only once the API has answered: offline, "no organization yet" would be a false prompt to register one.
  const orgsLoaded = workspace.organizations !== null;
  const primaryOrg = organizations[0] ?? null;
  const area = currentArea(location.pathname, facts, { desktop: isDesktop, preferredView: workspace.preferredView });
  // /account and /settings live on the desk's shell, but a player has nothing there to sync.
  const showDeskStatus = Boolean(desk) && area === 'organizer';
  const settingUp = new URLSearchParams(location.search).get('setup') === 'organization';

  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [orgFormName, setOrgFormName] = useState('');
  const [orgFormCity, setOrgFormCity] = useState('');
  const [orgFormState, setOrgFormState] = useState('');
  const [orgFormPhone, setOrgFormPhone] = useState('');
  const [orgFormPayment, setOrgFormPayment] = useState('');
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);

  const isOrganizerRoute =
    location.pathname === '/app' ||
    location.pathname.startsWith('/tournaments') ||
    location.pathname.startsWith('/certificates') ||
    location.pathname.startsWith('/simulator');

  useEffect(() => {
    if (!primaryOrg) return;
    setOrgFormName(primaryOrg.name);
    setOrgFormCity(primaryOrg.city ?? '');
    setOrgFormState(primaryOrg.state ?? '');
    setOrgFormPhone(primaryOrg.contactPhone ?? '');
    setOrgFormPayment(primaryOrg.paymentInstructions ?? '');
  }, [primaryOrg]);

  // "Run a tournament" in the account menu: the organization form, then the desk.
  useEffect(() => {
    if (!settingUp || !orgsLoaded) return;
    if (primaryOrg) {
      navigate(location.pathname, { replace: true });
      return;
    }
    setOrgError(null);
    setOrgModalOpen(true);
  }, [settingUp, orgsLoaded, primaryOrg, location.pathname, navigate]);

  function closeOrgModal() {
    setOrgModalOpen(false);
    // Backing out of the setup: a player goes back to their own page from here.
    if (settingUp) navigate(location.pathname, { replace: true });
  }

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
  }, [auth.user, location.pathname, navigate]);

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
    await refreshWorkspace();
    setOrgModalOpen(false);
  }

  const closeMenu = () => setMenuOpen(false);
  const arbiterOnly = Boolean(facts && isArbiterOnly(facts));

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to={areaHome(area, facts)} className="brand" aria-label="Chess Alokas home" onClick={closeMenu}>
          <span className="brand-knight" aria-hidden>
            <BrandCrown />
          </span>
          <span className="brand-name">Chess Alokas</span>
        </NavLink>

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
          {area === 'player' ? (
            <>
              <NavLink to="/player" end onClick={closeMenu}>
                My page
              </NavLink>
              <NavLink to="/discover" onClick={closeMenu}>
                Explore Events
              </NavLink>
            </>
          ) : arbiterOnly ? (
            <>
              <NavLink to="/team" onClick={closeMenu}>
                Floor duty
              </NavLink>
              <NavLink to="/discover" onClick={closeMenu}>
                Explore Events
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
            </>
          )}
          {auth.isPlatformAdmin && (
            <NavLink to="/admin" onClick={closeMenu}>
              Admin
            </NavLink>
          )}
          <div className="topnav-mobile-actions">
            {desk && showDeskStatus && (
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
            <AccountMenuItems place={area} onChoose={closeMenu} />
          </div>
        </nav>

        <div className="sync-bar">
          {desk && showDeskStatus && (
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
          <AccountMenu place={area} collapses />
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
                if (primaryOrg) {
                  navigate(`/team?org=${encodeURIComponent(primaryOrg.id)}`);
                  return;
                }
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
        <div className="modal-backdrop" onClick={closeOrgModal}>
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
                onClick={closeOrgModal}
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
                  onClick={closeOrgModal}
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
        {isDemoUser(auth.user) && (
          <DemoNotice>
            You are on a shared demo account. Everything here is fictional, nothing you do emails
            anyone, and a reset puts it all back.
          </DemoNotice>
        )}
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
