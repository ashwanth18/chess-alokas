import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  canActOnRole,
  canManageTeam,
  type InviteEmailStatus,
  type OrganizationInvite,
  type OrganizationMemberRole,
  type OrganizationTeamMember,
} from '@chess-alokas/shared';
import { useAuth } from '../../auth/AuthContext';
import {
  apiChangeMemberRole,
  apiCreateInvite,
  apiLeaveOrganization,
  apiListInvites,
  apiListMembers,
  apiListOrganizations,
  apiRemoveMember,
  apiResendInvite,
  apiRevokeInvite,
  type InviteRow,
  type UserOrganization,
} from '../../api/client';
import ArbiterFloorPanel from './ArbiterFloorPanel';
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from './roles';
import './team.css';

type IssuedLink = { email: string; url: string; emailStatus: InviteEmailStatus };

function emailNote(status: InviteEmailStatus, email: string): string {
  switch (status) {
    case 'sent':
      return `Invite emailed to ${email}. You can also send them this link.`;
    case 'failed':
      return `The email to ${email} didn't send. Send them this link yourself.`;
    case 'not_configured':
      return `Email isn't set up on this server. Send ${email} this link yourself.`;
    case 'skipped':
      return `New link for ${email}. The previous link no longer works.`;
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function LinkPanel({ link }: { link: IssuedLink }) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  useEffect(() => setCopied(null), [link]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied('yes');
    } catch {
      setCopied('no');
    }
  }
  return (
    <div className={`tm-note ${link.emailStatus === 'failed' ? 'tm-note-wait' : 'tm-note-ok'}`} role="status">
      {emailNote(link.emailStatus, link.email)}
      <div className="tm-link-row">
        <input
          className="tm-input"
          readOnly
          value={link.url}
          aria-label="Invite link"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="tm-btn" onClick={() => void copy()}>
          {copied === 'yes' ? 'Copied' : 'Copy link'}
        </button>
      </div>
      {copied === 'no' && <p className="tm-muted">Couldn't copy. Select the link and copy it by hand.</p>}
      <p className="tm-muted">This link is shown once. It works once, for this address, for 7 days.</p>
    </div>
  );
}

export default function TeamPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [orgs, setOrgs] = useState<UserOrganization[] | null>(null);
  const [members, setMembers] = useState<OrganizationTeamMember[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [yourRole, setYourRole] = useState<OrganizationMemberRole | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrganizationMemberRole>('director');
  const [issued, setIssued] = useState<IssuedLink | null>(null);

  const loadOrgs = useCallback(async () => {
    setLoadError(null);
    const res = await apiListOrganizations();
    if (res.ok) setOrgs(res.data.organizations);
    else setLoadError(res.error);
  }, []);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  const requested = params.get('org');
  const org = orgs?.find((o) => o.id === requested) ?? orgs?.[0] ?? null;
  const orgId = org?.id ?? null;

  const loadTeam = useCallback(async () => {
    if (!orgId) return;
    setLoadError(null);
    const res = await apiListMembers(orgId);
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    setMembers(res.data.members);
    setYourRole(res.data.yourRole);
    if (canManageTeam(res.data.yourRole)) {
      const list = await apiListInvites(orgId);
      if (list.ok) setInvites(list.data.invites);
      else setLoadError(list.error);
    } else {
      setInvites([]);
    }
  }, [orgId]);

  useEffect(() => {
    setIssued(null);
    setActionError(null);
    void loadTeam();
  }, [loadTeam]);

  /** Runs a change, reports a refusal in words, and reloads what the server now holds. */
  async function act(run: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setActionError(null);
    const res = await run();
    if (!res.ok) setActionError(res.error ?? 'That did not work.');
    await loadTeam();
    setBusy(false);
    return res.ok;
  }

  async function sendInvite(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    const address = email.trim();
    await act(async () => {
      const res = await apiCreateInvite(orgId, { email: address, role });
      if (!res.ok) return res;
      setIssued({ email: address, url: res.data.inviteUrl, emailStatus: res.data.emailStatus });
      setEmail('');
      return res;
    });
  }

  async function reissue(invite: OrganizationInvite, sendEmail: boolean) {
    if (!orgId) return;
    await act(async () => {
      const res = await apiResendInvite(orgId, invite.id, sendEmail);
      if (!res.ok) return res;
      setIssued({
        email: invite.email,
        url: res.data.inviteUrl,
        emailStatus: res.data.emailStatus,
      });
      return res;
    });
  }

  async function leave() {
    if (!orgId || !org) return;
    if (!window.confirm(`Leave ${org.name}? You'll lose access to its tournaments.`)) return;
    const left = await act(() => apiLeaveOrganization(orgId));
    if (left) {
      setParams({}, { replace: true });
      await loadOrgs();
      navigate('/app');
    }
  }

  function memberName(m: OrganizationTeamMember): string {
    return m.displayName || m.email || 'Team member';
  }

  if (loadError && !orgs) {
    return (
      <div className="tm-page">
        <h1>Team</h1>
        <p className="tm-note tm-note-error" role="alert">
          Couldn't load your organizations: {loadError}
        </p>
        <button type="button" className="tm-btn" onClick={() => void loadOrgs()}>
          Try again
        </button>
      </div>
    );
  }
  if (!orgs) {
    return (
      <div className="tm-page">
        <h1>Team</h1>
        <p className="tm-muted" role="status">
          Loading…
        </p>
      </div>
    );
  }
  if (!org) {
    return (
      <div className="tm-page">
        <h1>Team</h1>
        <p>
          You aren't in an organization yet. Register one from your tournaments page, or open the
          invite link someone sent you.
        </p>
      </div>
    );
  }

  const manages = canManageTeam(yourRole);
  const grantable = ROLES.filter((r) => canActOnRole(yourRole, r));

  return (
    <div className="tm-page">
      <h1>Team</h1>
      {orgs.length > 1 ? (
        <label className="tm-muted">
          Organization{' '}
          <select
            className="tm-input"
            style={{ width: 'auto' }}
            value={org.id}
            onChange={(e) => setParams({ org: e.target.value }, { replace: true })}
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="tm-muted">{org.name}</p>
      )}
      {yourRole && (
        <p className="tm-muted">
          You are {ROLE_LABELS[yourRole]}. {ROLE_DESCRIPTIONS[yourRole]}
        </p>
      )}

      {loadError && (
        <p className="tm-note tm-note-error" role="alert">
          {loadError}{' '}
          <button type="button" className="tm-btn" onClick={() => void loadTeam()}>
            Try again
          </button>
        </p>
      )}
      {actionError && (
        <p className="tm-note tm-note-error" role="alert">
          {actionError}
        </p>
      )}

      {yourRole === 'arbiter' && <ArbiterFloorPanel organizationId={org.id} />}

      {manages && (
        <section className="tm-section" aria-labelledby="tm-invite-heading">
          <h2 id="tm-invite-heading">Invite someone</h2>
          <form className="tm-form" onSubmit={(e) => void sendInvite(e)}>
            <label>
              Email address
              <input
                className="tm-input"
                type="email"
                required
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Role
              <select
                className="tm-input"
                value={role}
                onChange={(e) => setRole(e.target.value as OrganizationMemberRole)}
              >
                {grantable.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="tm-btn tm-btn-primary" disabled={busy}>
              Send invite
            </button>
          </form>
          <p className="tm-muted">{ROLE_DESCRIPTIONS[role]}</p>
          {issued && <LinkPanel link={issued} />}
        </section>
      )}

      <section className="tm-section" aria-labelledby="tm-members-heading">
        <h2 id="tm-members-heading">Members</h2>
        <table className="tm-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col">Joined</th>
              <th scope="col">
                <span className="tm-sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isYou = m.userId === auth.user?.id;
              const editable = canActOnRole(yourRole, m.role);
              return (
                <tr key={m.userId}>
                  <td>
                    {memberName(m)}
                    {isYou && ' (you)'}
                    {m.displayName && m.email && <div className="tm-muted">{m.email}</div>}
                  </td>
                  <td>
                    {editable ? (
                      <select
                        className="tm-input"
                        aria-label={`Role for ${memberName(m)}`}
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => {
                          const next = e.target.value as OrganizationMemberRole;
                          void act(() => apiChangeMemberRole(org.id, m.userId, next));
                        }}
                      >
                        {grantable.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      ROLE_LABELS[m.role]
                    )}
                  </td>
                  <td>{formatDate(m.joinedAt)}</td>
                  <td>
                    <div className="tm-actions">
                      {isYou ? (
                        <button
                          type="button"
                          className="tm-btn"
                          disabled={busy}
                          onClick={() => void leave()}
                        >
                          Leave
                        </button>
                      ) : (
                        editable && (
                          <button
                            type="button"
                            className="tm-btn tm-btn-danger"
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(`Remove ${memberName(m)} from ${org.name}?`)) {
                                void act(() => apiRemoveMember(org.id, m.userId));
                              }
                            }}
                          >
                            Remove
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!manages && yourRole && (
          <p className="tm-muted">Owners and admins can invite people and change roles.</p>
        )}
      </section>

      {manages && (
        <section className="tm-section" aria-labelledby="tm-pending-heading">
          <h2 id="tm-pending-heading">Pending invites</h2>
          {invites.length === 0 ? (
            <p className="tm-muted">No invites waiting.</p>
          ) : (
            <table className="tm-table">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="tm-sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => {
                  const editable = canActOnRole(yourRole, invite.role);
                  return (
                    <tr key={invite.id}>
                      <td>{invite.email}</td>
                      <td>{ROLE_LABELS[invite.role]}</td>
                      <td>
                        {invite.status === 'expired'
                          ? 'Expired'
                          : `Expires ${formatDate(invite.expiresAt)}`}
                      </td>
                      <td>
                        {editable && (
                          <div className="tm-actions">
                            <button
                              type="button"
                              className="tm-btn"
                              disabled={busy}
                              onClick={() => void reissue(invite, true)}
                            >
                              Resend
                            </button>
                            <button
                              type="button"
                              className="tm-btn"
                              disabled={busy}
                              title="Makes a new link. The old one stops working."
                              onClick={() => void reissue(invite, false)}
                            >
                              New link
                            </button>
                            <button
                              type="button"
                              className="tm-btn tm-btn-danger"
                              disabled={busy}
                              onClick={() => void act(() => apiRevokeInvite(org.id, invite.id))}
                            >
                              Withdraw
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {invites.length > 0 && (
            <p className="tm-muted">
              Links are shown only once, so Resend and New link both replace the old link.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
