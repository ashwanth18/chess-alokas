import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { OrganizationInvitePreview, OrganizationMemberRole } from '@chess-alokas/shared';
import { useAuth } from '../../auth/AuthContext';
import { clearReturnTo, loginPathFor, signupPathFor } from '../../auth/returnTo';
import { apiAcceptInvite, apiLookupInvite } from '../../api/client';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from './roles';
import './team.css';

type Load =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'failed'; error: string }
  | { kind: 'ready'; invite: OrganizationInvitePreview };

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="tm-invite">
      <div className="tm-card">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

/** Public page: this is where someone who has never heard of the app first lands. */
export default function InvitePage() {
  const { token = '' } = useParams();
  const auth = useAuth();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ organizationId: string; role: OrganizationMemberRole } | null>(
    null,
  );
  const sessionToken = auth.session?.access_token ?? null;

  const lookup = useCallback(async () => {
    setLoad({ kind: 'loading' });
    const res = await apiLookupInvite(token);
    if (res.ok) setLoad({ kind: 'ready', invite: res.data });
    else if (res.status === 404) setLoad({ kind: 'invalid' });
    else setLoad({ kind: 'failed', error: res.error });
  }, [token]);

  // Runs again after sign-in or sign-out, since the answer depends on who is looking.
  useEffect(() => {
    if (auth.loading) return;
    void lookup();
  }, [auth.loading, sessionToken, lookup]);

  async function accept() {
    setAccepting(true);
    setAcceptError(null);
    const res = await apiAcceptInvite(token);
    setAccepting(false);
    if (res.ok) {
      clearReturnTo();
      setJoined({ organizationId: res.data.organizationId, role: res.data.role });
    } else {
      setAcceptError(res.error);
      void lookup();
    }
  }

  if (joined) {
    return (
      <Shell title="You're on the team">
        <p className="tm-note tm-note-ok">
          You joined as {ROLE_LABELS[joined.role]}. {ROLE_DESCRIPTIONS[joined.role]}
        </p>
        <div className="tm-stack">
          <Link className="tm-btn tm-btn-primary" to={`/team?org=${joined.organizationId}`}>
            Open the team page
          </Link>
          {joined.role !== 'arbiter' && (
            <Link className="tm-btn" to="/app">
              Go to tournaments
            </Link>
          )}
        </div>
      </Shell>
    );
  }

  if (load.kind === 'loading' || auth.loading) {
    return (
      <Shell title="Opening your invite">
        <p className="tm-muted" role="status">
          One moment.
        </p>
      </Shell>
    );
  }

  if (load.kind === 'invalid') {
    return (
      <Shell title="This link doesn't work">
        <p>
          The link may be incomplete, or a newer invite may have replaced it. Ask the person who
          invited you to send a new one.
        </p>
      </Shell>
    );
  }

  if (load.kind === 'failed') {
    return (
      <Shell title="Couldn't open your invite">
        <p className="tm-note tm-note-error" role="alert">
          {load.error}
        </p>
        <button type="button" className="tm-btn tm-btn-primary" onClick={() => void lookup()}>
          Try again
        </button>
      </Shell>
    );
  }

  const { invite } = load;
  const here = `/invite/${token}`;

  if (invite.status === 'expired') {
    return (
      <Shell title="This invite has expired">
        <p>
          Invites last 7 days. Ask someone at {invite.organizationName} to send you a new one.
        </p>
      </Shell>
    );
  }
  if (invite.status === 'accepted') {
    return (
      <Shell title="This invite has been used">
        <p>Each invite works once. If it was yours, you're already on the team.</p>
        {auth.user ? (
          <Link className="tm-btn tm-btn-primary" to="/team">
            Open the team page
          </Link>
        ) : (
          <Link className="tm-btn tm-btn-primary" to="/login">
            Sign in
          </Link>
        )}
      </Shell>
    );
  }
  if (invite.status === 'revoked') {
    return (
      <Shell title="This invite was withdrawn">
        <p>Ask someone at {invite.organizationName} if you think you should still have one.</p>
      </Shell>
    );
  }

  const facts = (
    <dl className="tm-facts">
      <dt>Organization</dt>
      <dd>{invite.organizationName}</dd>
      <dt>Your role</dt>
      <dd>{ROLE_LABELS[invite.role]}</dd>
      <dt>Sent to</dt>
      <dd>{invite.emailHint}</dd>
    </dl>
  );
  const title = `Join ${invite.organizationName}`;
  const error = acceptError && (
    <p className="tm-note tm-note-error" role="alert">
      {acceptError}
    </p>
  );

  if (invite.viewer === 'match') {
    return (
      <Shell title={title}>
        {facts}
        <p className="tm-muted">{ROLE_DESCRIPTIONS[invite.role]}</p>
        {error}
        <div className="tm-stack">
          <button
            type="button"
            className="tm-btn tm-btn-primary"
            disabled={accepting}
            onClick={() => void accept()}
          >
            {accepting ? 'Joining…' : 'Accept invite'}
          </button>
        </div>
      </Shell>
    );
  }

  if (invite.viewer === 'wrong_email') {
    return (
      <Shell title={title}>
        {facts}
        <p className="tm-note tm-note-wait" role="alert">
          You're signed in as {auth.user?.email ?? 'another account'}, but this invite was sent to{' '}
          {invite.emailHint}. Sign out, then use that address.
        </p>
        <div className="tm-stack">
          <button type="button" className="tm-btn tm-btn-primary" onClick={() => void auth.signOut()}>
            Sign out
          </button>
        </div>
      </Shell>
    );
  }

  if (invite.viewer === 'unconfirmed') {
    return (
      <Shell title={title}>
        {facts}
        <p className="tm-note tm-note-wait" role="status">
          Confirm your email address first, using the link we sent you, then come back to this page.
        </p>
        <div className="tm-stack">
          <button type="button" className="tm-btn" onClick={() => void lookup()}>
            I've confirmed it
          </button>
        </div>
      </Shell>
    );
  }

  // The API saw no valid session, yet this device has a saved sign-in: it can't reach the server.
  if (auth.user) {
    return (
      <Shell title={title}>
        {facts}
        <p className="tm-note tm-note-wait" role="status">
          We can't confirm your sign-in right now. Check your connection and try again.
        </p>
        <button type="button" className="tm-btn" onClick={() => void lookup()}>
          Try again
        </button>
      </Shell>
    );
  }

  return (
    <Shell title={title}>
      {facts}
      <p className="tm-muted">
        Sign in or create an account with the address this invite was sent to. You'll come straight
        back here.
      </p>
      <div className="tm-stack">
        <Link className="tm-btn tm-btn-primary" to={signupPathFor(here)}>
          Create an account
        </Link>
        <Link className="tm-btn" to={loginPathFor(here)}>
          I already have an account
        </Link>
      </div>
    </Shell>
  );
}
