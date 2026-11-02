import { FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { clearReturnTo, resolveReturnTo } from '../auth/returnTo';
import { ORGANIZER_SETUP_PATH } from '../auth/workspace';
import AuthShell from '../components/AuthShell';
import { SignupAgreement } from '../components/LegalLinks';
import { trackPageView } from '../lib/pageAnalytics';
import { apiCreateOrganization, apiCreatePlayerProfile } from '../api/client';
import { supabase } from '../lib/supabase';
import { PENDING_SIGNUP_STORAGE_KEY } from '../lib/pendingSignup';

type SignupRole = 'participant' | 'organizer';

export default function SignupPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [returnTo] = useState(() => resolveReturnTo(location.search));
  // Someone invited to a team isn't choosing between player and organizer.
  const organizerLink = new URLSearchParams(location.search).get('role') === 'organizer';
  const joiningTeam = !organizerLink && Boolean(returnTo?.startsWith('/invite/'));
  const [role, setRole] = useState<SignupRole>(organizerLink ? 'organizer' : 'participant');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [orgCity, setOrgCity] = useState('');
  const [orgState, setOrgState] = useState('');
  const [orgPhone, setOrgPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    trackPageView({ routeKey: 'signup', path: '/signup' });
  }, []);

  const signedIn = !auth.loading && Boolean(auth.user);
  useEffect(() => {
    if (signedIn && returnTo) clearReturnTo();
  }, [signedIn, returnTo]);

  // Not while submitting: signing up signs in first, and onSubmit still has work to finish.
  if (signedIn && !busy) {
    // Already has an account. The organizer link starts the setup; otherwise `/` knows their area.
    return <Navigate to={returnTo ?? (organizerLink ? ORGANIZER_SETUP_PATH : '/')} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (role === 'organizer' && !orgName.trim()) {
      setError('Please enter your Organization or Academy name.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await auth.signUpWithPassword(
      email.trim(),
      password,
      displayName.trim() || orgName.trim(),
    );
    if (res.error) {
      setBusy(false);
      setError(res.error);
      return;
    }

    const sessionRes = supabase ? await supabase.auth.getSession() : { data: { session: null } };
    const hasSession = Boolean(sessionRes.data.session);

    if (hasSession) {
      if (role === 'organizer') {
        const created = await apiCreateOrganization({
          name: orgName.trim(),
          city: orgCity.trim() || null,
          state: orgState.trim() || null,
          contactPhone: orgPhone.trim() || null,
          contactEmail: email.trim(),
        });
        if (!created.ok) {
          // The account exists, so the dashboard retries this and reports the error if it fails.
          rememberPendingSignup();
        }
        // The choice decides where they land, unless they came here on the way somewhere.
        navigate(returnTo ?? '/app', { replace: true });
        return;
      } else {
        if (displayName.trim()) {
          await apiCreatePlayerProfile({
            fullName: displayName.trim(),
            relationship: 'self',
            isPrimary: true,
            email: email.trim(),
          });
        }
        navigate(returnTo ?? '/player', { replace: true });
        return;
      }
    }

    rememberPendingSignup();
    setBusy(false);
    setMessage(email.trim());
  }

  function rememberPendingSignup() {
    try {
      localStorage.setItem(
        PENDING_SIGNUP_STORAGE_KEY,
        JSON.stringify({
          role,
          displayName: displayName.trim(),
          email: email.trim(),
          orgName: orgName.trim(),
          orgCity: orgCity.trim(),
          orgState: orgState.trim(),
          orgPhone: orgPhone.trim(),
        }),
      );
    } catch {
      /* ignore storage errors */
    }
  }

  if (message) {
    return (
      <AuthShell title="Check your email" subtitle="One more step to finish your account">
        <p className="form-hint" role="status">
          We sent a confirmation link to <strong>{message}</strong>. Open it, then sign in.
          {joiningTeam && ' You’ll go straight back to your invite.'} If it doesn’t arrive in a few
          minutes, check your spam folder.
        </p>
        <Link className="btn btn-primary" to="/login">
          Go to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create account"
      subtitle={
        joiningTeam
          ? 'Use the email address your invite was sent to'
          : role === 'participant'
            ? 'Follow your games, register for events, keep your certificates.'
            : 'Run your tournaments. Start with a free trial.'
      }
    >
      {!joiningTeam && (
      <div className="auth-tabs" role="group" aria-label="I am here to">
        <button
          type="button"
          aria-pressed={role === 'participant'}
          className={`cat-tab ${role === 'participant' ? 'active' : ''}`}
          onClick={() => setRole('participant')}
        >
          Play, or follow my child
        </button>
        <button
          type="button"
          aria-pressed={role === 'organizer'}
          className={`cat-tab ${role === 'organizer' ? 'active' : ''}`}
          onClick={() => setRole('organizer')}
        >
          Run tournaments
        </button>
      </div>
      )}

      <form className="auth-form" onSubmit={(e) => void onSubmit(e)}>
        <label>
          {role === 'participant' ? 'Your full name' : 'Your name'}
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required={role === 'participant'}
          />
        </label>

        {role === 'organizer' && (
          <>
            <label>
              Organization / Academy name
              <input
                className="input"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g. KL Junior Chess Academy"
                required
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
              <label>
                City
                <input
                  className="input"
                  value={orgCity}
                  onChange={(e) => setOrgCity(e.target.value)}
                  placeholder="Kuala Lumpur"
                />
              </label>
              <label>
                State
                <input
                  className="input"
                  value={orgState}
                  onChange={(e) => setOrgState(e.target.value)}
                  placeholder="Selangor / WP KL"
                />
              </label>
            </div>
            <label>
              Contact Phone / WhatsApp
              <input
                className="input"
                type="tel"
                value={orgPhone}
                onChange={(e) => setOrgPhone(e.target.value)}
                placeholder="+60 12-345 6789"
              />
            </label>
            <p className="form-hint" style={{ margin: '0.15rem 0' }}>
              Your trial allows 1 tournament of up to 24 players until we verify your organization.
            </p>
          </>
        )}

        <label>
          Email
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy || !auth.configured}>
          {busy
            ? 'Creating…'
            : joiningTeam
              ? 'Create account and continue'
              : role === 'participant'
                ? 'Create account'
                : 'Start your trial'}
        </button>
      </form>
      <SignupAgreement />
      {error && <div className="form-error">{error}</div>}
      {message && <p className="form-hint">{message}</p>}
      <p className="auth-footer">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
      <p className="auth-footer auth-footer-secondary">
        <Link to="/">← Back to Chess Alokas home</Link>
      </p>
    </AuthShell>
  );
}
