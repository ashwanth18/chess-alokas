# Multi-Tenant B2B Organizations, Sandbox Trial & Global Player Portal

This document covers the **Phase 1** multi-tenant B2B organizer architecture and B2C global participant/family portal in Chess Alokas 2.0.

---

## 1. Overview: Dual-Workspace Architecture

Chess Alokas has two areas under one Supabase Auth account. People open straight into theirs, with no switcher across the top. See "Who opens where" below.

| Workspace | Target Audience | Scope & Access Model |
|-----------|-----------------|----------------------|
| **Player & Family Portal (`/player`)** | Players, parents, and academy students (B2C) | **Global across the platform** — instant free signup, no admin approval required. One account manages a `Self` primary profile plus multiple `Child`, `Student`, or `Family` sub-profiles. |
| **Organizer Desk (`/app`)** | Tournament directors, chess clubs, schools, and academies (B2B) | **Tenant-scoped via `organizations` & `organization_members`**. Starts immediately in **Sandbox Trial** mode (`1` active tournament, up to `24` players) until verified by a Platform Admin. |

### Who opens where

The rules are in `apps/web/src/auth/workspace.ts`, with tests beside them.

| Who | Means | Opens on | Account menu offers |
|---|---|---|---|
| Player | No organization and an `account_role` of `participant` | `/player` | Run a tournament, which opens the organization form on `/app?setup=organization` |
| Organizer | Any membership, or `account_role` of `organizer` or `both` | `/app` | Nothing extra |
| Arbiter-only | Every membership is `arbiter` | `/team`, for Floor duty | Nothing extra |
| Both | An organizer with at least one player profile | `/app`, or `/player` if that was their last choice on this device | Switch to player view, or Switch to organizer view |

- **"Both" needs a player profile.** `account_role = 'both'` can't decide it: the database sets it on anyone who creates an organization, because every account starts as `participant`.
- **Desktop** is organizer tools only. `/player` redirects to `/app`, and nobody sees a switch.
- **A return path wins** over all of this after sign-in.
- **Every URL still works.** `/app` is the one exception to staying put: a known player goes on to `/player`, before the desk's code downloads. An organizer can still open `/player` by its URL, and gets a link back to the desk.
- **Offline**: the device keeps its last answer in `localStorage`, keyed by user, so a known organizer's desk opens at once and checks in the background. With no answer at all the desk opens, because it's the side that works offline. Landing waits at most 5 seconds.
- **Public pages** such as `/discover` show the account menu with plain links (My desk, My player page) and no switch.

---

## 2. Database Schema (`024` & `025`)

### 2.1 `supabase/migrations/024_organizations_and_roles.sql`
- **`organizations`**:
  - Identity & contact: `id`, `name`, `slug` (unique), `logo_url`, `description`, `website`, `contact_email`, `contact_phone`, `city`, `state`, `country` (default `'Malaysia'`).
  - B2B verification & quotas:
    - `verification_status`: `'pending_review' | 'verified' | 'rejected' | 'suspended'` (default `'pending_review'`)
    - `plan_tier`: `'trial' | 'event_pass' | 'pro' | 'enterprise'` (default `'trial'`)
    - `trial_ends_at`: `now() + interval '14 days'`
    - `max_tournaments_quota`: `1` (null = unlimited)
    - `max_players_per_tournament`: `24` (null = unlimited)
    - `event_credits_remaining`: integer (default `0`)
    - `can_publish_global`: boolean (default `false`)
    - `can_accept_paid_registrations`: boolean (default `false`)
  - Payment info: `payment_instructions`, `payment_qr_storage_path`.
  - Audit: `created_by`, `verified_at`, `verified_by`, `created_at`, `updated_at`.
  - **Privilege-Escalation Trigger (`trg_prevent_organization_privilege_escalation`)**: Prevents `authenticated` / `anon` JWT callers from self-upgrading `verification_status`, `plan_tier`, or quota columns via direct PostgREST queries.
- **`organization_members`**:
  - Composite primary key `(organization_id, user_id)` with `role IN ('owner', 'admin', 'director', 'arbiter')`.
- **`profiles` additions**:
  - `account_role IN ('participant', 'organizer', 'both')` (default `'participant'`)
  - `default_organization_id uuid references organizations(id)`
- **`tournaments` additions**:
  - `organization_id uuid references organizations(id)`

### 2.2 `supabase/migrations/025_player_profiles.sql`
- **`player_profiles`**:
  - `id`, `account_user_id` (`references auth.users(id) on delete cascade`), `is_primary`, `relationship IN ('self', 'child', 'student', 'family')`.
  - Identity & ratings: `username` (unique), `full_name`, `date_of_birth`, `year_of_birth`, `gender`, `national_id`, `fide_id`, `fide_standard`, `fide_rapid`, `fide_blitz`, `alokas_rating` (default `1000`).
  - Affiliation & contact: `school`, `club`, `city`, `state`, `country`, `email`, `phone`.
- **`participants` additions**:
  - `player_profile_id uuid references player_profiles(id) on delete set null` (indexed via `idx_participants_player_profile`).

---

## 3. B2B Sandbox Trial & Admin Approval Lifecycle

1. **Organizer Signup (`/signup?role=organizer`, or Run tournaments on `/signup`)**:
   - Collects Director Name, Organization/Academy Name, City/State, and Contact Phone/WhatsApp.
   - Calls `POST /organizations`, creating the organization in `trial` / `pending_review` mode (`maxTournamentsQuota = 1`, `maxPlayersPerTournament = 24`).
2. **Sandbox Trial Quota Enforcement**:
   - Enforced in both `MemoryStore` and `PostgresStore` (`apps/api/src/db.ts`) across `createTournament`, `createParticipant`, `upsertParticipants`, and `pushSync`.
   - Attempting to create a 2nd active tournament or exceed 24 active players in a trial organization returns `403 Forbidden` with a clear `Sandbox Trial quota reached` message.
   - One account can create one Sandbox Trial organization and five organizations overall, because each organization carries its own quota.
   - Reviving a soft-deleted tournament through sync counts against the quota, and players added while a tournament is soft-deleted count against the player limit.
   - `organizationId` on create and sync requires the caller to be an `owner`, `admin` or `director` of that organization. Sync never moves an existing tournament to another organization or owner.
3. **Platform Admin B2B Approval (`/admin`)**:
   - Platform admins view all organizations in the **Organizations & B2B Approvals** panel and can apply 1-click actions via `PATCH /admin/organizations/:id`:
     - **Verify + Event Pass**: `verificationStatus = 'verified'`, `planTier = 'event_pass'`, `maxTournamentsQuota = 3`, `canPublishGlobal = true`. An Event Pass allows 150 players per tournament; the API enforces this even if an organization row stores a higher number. Publishing an event for the first time uses one `eventCreditsRemaining`; republishing the same event is free, and with no credits left publishing returns `403`.
     - **Verify + Pro (Unlimited)**: `verificationStatus = 'verified'`, `planTier = 'pro'`, `maxTournamentsQuota = null`, `maxPlayersPerTournament = null`, `canPublishGlobal = true`.
     - **Reset to Trial**: Resets to `pending_review` / `trial` (`1` tournament, `24` players).
     - **Suspend**: Sets `verificationStatus = 'suspended'`, blocking new tournament creation.

---

## 4. Global Player & Family Portal (`/player`)

- **Family / Player Switcher Bar**:
  - Parents and coaches can switch between their own `Self` profile and any number of `Child`, `Student`, or `Family` sub-profiles.
- **Link Tournaments by Email (`POST /player/profiles/:id/claim`)**:
  - Links `participants` rows whose `email` matches the signed-in account's **confirmed** email. An unconfirmed account gets `403`.
  - Names, FIDE IDs and typed-in emails are not proof, because anyone can enter them. Request body fields are ignored.
  - A player's other route to a linked profile is registering from that profile and having the organizer approve it. Sync can't set or clear `player_profile_id`.
  - Certificates addressed by email appear on, and download for, the account whose confirmed email matches. `player_profiles.email` alone grants nothing.
- **Live Matchday Companion Card**:
  - When the selected profile is in a `ready` or `in_progress` tournament, displays a real-time card showing the tournament name, current round, **Board #**, **Piece Color (`♔ White` / `♚ Black` / `Bye`)**, **Opponent Name & Rating**, current score, and a direct link to the public live view.
- **Career Overview & Digital Certificate Vault**:
  - Aggregates career games played, total points, Win/Draw/Loss breakdown, Alokas & FIDE ratings (Standard / Rapid / Blitz), tournament history, and 1-click PDF downloads for issued certificates (`GET /certificates/:issueId/download`).

---

## 4b. Team: roles and invites (`030`, `routes/team.ts`, `/team`, `/invite/:token`)

| | Owner | Admin | Director | Arbiter |
|---|---|---|---|---|
| Create and run tournaments, sync, pairings, results, certificates, registrations | Yes | Yes | Yes | No |
| Floor: table links, new scoring PIN, arbiter calls | Yes | Yes | Yes | Yes |
| Set up floor tables | Yes | Yes | Yes | No |
| See tournament names in the list | Yes | Yes | Yes | Yes |
| See player records, or sync tournaments to a device | Yes | Yes | Yes | No |
| See the member list | Yes | Yes | Yes | Yes |
| Invite, change roles, remove members | Yes | Up to admin | No | No |
| Leave | Yes, unless the last owner | Yes | Yes | Yes |

- **Invite links** hold a random token. Only its SHA-256 is stored (`organization_invites.token_hash`), so a link can be shown only when issued. Resend and New link each issue a new link and stop the old one working.
- **Accepting** needs a signed-in user whose confirmed email equals the invite's address. Links work once and expire after 7 days. An existing member keeps their current role.
- **Access is API-only.** `organization_invites` has RLS on, no policies and no client grants. The token goes in request bodies, not API paths, so it stays out of access logs.
- **Leaving or dropping to arbiter** hands the person's `owner_id` tournaments, and `organizations.created_by`, to the longest-serving other owner. Both fields grant access in the API and in older RLS policies.
- **Sync**: `organization_members.access_changed_at` makes a pull redeliver an organization's tournaments to someone who just joined or was promoted, because those rows are older than their cursor.
- **Choosing an organization**: the create form lists organizations where the person's role can create tournaments, defaults to the highest-role one, shows its plan limits, and hides the choice when there is only one. The API checks membership and role on `POST /tournaments` and on sync. A tournament that names no organization, such as one created offline before the list loaded, goes to the same default.
- **No seat limits**: the data model has none, so none are enforced. Sending is limited to 30 invites per person per hour, in memory per process.
- **Email** uses Resend when `RESEND_API_KEY` is set. The API always returns the link, with `emailStatus` of `sent`, `failed`, `not_configured` or `skipped`. `PUBLIC_APP_URL` sets the link's base.

### Removing a tournament from a device after access is lost (`031`)

`tournament_access_revocations` records, per person, the organization's tournaments at the moment they were removed, left, or dropped to arbiter. Being promoted or invited back to a role that runs tournaments clears the rows. `GET /sync/pull` returns `revokedTournamentIds` and `revokedForUserId`. The list comes on every pull until access returns, so a device that was offline still hears. A record is needed because comparing a device's tournaments with what the current user may see can't tell a lost tournament from another account's copy on a shared computer.

The client (`apps/web/src/sync/revocation.ts`, rules in `revocationPlan.ts`) removes a tournament and its rows from Dexie only when:

- the pull succeeded with a complete response
- `revokedForUserId` equals the signed-in user at both the start of the sync and after the pull
- the id is on the server's list and is not among the tournaments that same response delivered

So an error, a partial response or an older server removes nothing, and neither does a never-synced tournament, because the server can't list what it has never seen. Older clients ignore the fields.

Pending changes to a removed tournament are dropped and counted in the notice, which names the tournaments and stays until dismissed.

**Shared computer.** The local database is per device, not per account, so:

- After a removal, other accounts' sync cursors on the device are reset, so their own copy comes back at their next sync.
- If another account has used the device and the tournament has pending changes, nobody can tell whose they are. The tournament stays, the person is told once, and removal waits until those changes are gone. Until then it is still readable here.

**Desktop backups.** No snapshot is taken before removal, because it would keep the data the person just lost access to. Automatic snapshots in `%APPDATA%\Chess Alokas\backups` are rewritten without those tournaments, and a restore leaves them out, from any file. A snapshot that can't be rewritten is counted in the notice. On a shared computer this also removes the tournament from snapshots another account might use. Their copy comes back from the cloud.

**What this cannot do:**

- A device that never syncs again keeps its copy, and that copy stays readable offline.
- A signed-out or offline person keeps theirs until the next successful sync.
- Exported backup files, anywhere the person saved them, are out of reach. So are copies made outside the app.
- A snapshot that failed to rewrite still holds the data. The app tries again at each sync and says so in the notice. A damaged file that isn't readable as a backup is left as it is and not counted. The app can't restore it, but its text may still hold data.
- A restore on a device that has never heard about the loss, such as a new computer, brings the tournament back until its first sync removes it.
- Anything already printed, downloaded or copied, such as certificates and CSV files, is untouched.

This limits what the app keeps. It does not guarantee erasure.

### Consent notices (`032`)

A founder decision: relaxed now, stricter later. See "Later: stricter privacy" in `docs/PLAN.md`.

The registration form and child-profile form show one line by the submit button, and submitting is the acceptance. Nothing is ticked and the API refuses nothing.

`POST /public/events/:slugOrId/register`, `POST /player/profiles` and `PATCH /player/profiles/:id` take an optional `guardianConsent: true`. When it arrives, the server stamps `guardian_consent_at`, `guardian_consent_notice_version` (`PRIVACY_NOTICE_VERSION`) and `guardian_consent_by_user_id`, and ignores anything a client sends for them. Without it the request works as usual and no acceptance is recorded, which is how older mobile builds behave. On a profile, the first acceptance stands.

Web shows the profile notice where `guardianConsentRequired` says so: a child, or anyone not shown to be an adult, but not an adult's or name-only profile of their own. The helper and the error codes stay in `packages/shared/src/guardianConsent.ts` for later. No route refuses on them.

**Roster import:** the web app shows a similar line and sends `rosterConsentConfirmedAt` with the tournament at the next sync. `POST /tournaments/:id/import` takes an optional `consentConfirmed=true` and imports either way. A confirmation lands in `roster_consent_confirmations`, once each.

### Account deletion (`DELETE /me`)

`prepareAccountDeletion` runs first, in one transaction, then the sign-in account is deleted. If that second step fails, the person sees an error and can retry safely.

- **Registrations** they submitted, or made with their profiles: details and answers removed, open entries cancelled, approved entries keep only the name, payment status and amount stay, and any receipt is scheduled for 30 days.
- **Player profiles:** deleted, and unlinked from rosters.
- **Organization tournaments they created:** stay, passing to the organization's owner. This replaces the old behaviour, which soft-deleted them and took the organization's results with them.
- **Tournaments outside any organization:** hidden now, erased after 30 days.
- **Last owner of an organization:** the longest-serving admin, or else director, becomes owner. An arbiter is never promoted, because that would hand them player records. With nobody to take over, the organization closes: suspended, tournaments hidden and scheduled, invites withdrawn, arbiters removed. A platform admin can reinstate it by hand during the 30 days. After that its tournaments are erased and its name and contact details removed.

**The purge** is `runPrivacyPurge` in `apps/api/src/lib/privacyPurge.ts`. It runs inside the API process a minute after start, then every 6 hours, with no external scheduler. `PRIVACY_PURGE_DISABLED=1` turns it off. If the API is down it runs late rather than not at all, and a file that can't be removed keeps its row and is retried. There is no alert if it keeps failing, only a log line.

**Not covered:**

- Registrations made without signing in, and rosters typed or imported by an organizer: nothing links them to the account.
- Certificates, roster entries and results in an organizer's event, and certificate templates.
- Usage statistics, logs and error reports already sent.
- The person's own devices, and provider backups.
- Anyone told about a transfer: the new owner is not notified.

---

## 5. API Endpoints Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/me` | `requireAuth` | The signed-in account, including `accountRole`. The browser can't read `profiles.account_role` itself: its grant on `profiles` is by column |
| `GET` | `/organizations` | `requireAuth` | List organizations where the signed-in user is owner or member |
| `POST` | `/organizations` | `requireAuth` | Create a new organization in Sandbox Trial mode (`trial` / `pending_review`) |
| `PATCH` | `/organizations/:id` | `requireAuth` (owner/admin) | Update organization contact details, location, or payment instructions |
| `GET` | `/organizations/:id/members` | any member | Members and the caller's role |
| `PATCH` / `DELETE` | `/organizations/:id/members/:userId` | owner/admin, not above own role | Change a role or remove a member. The last owner is protected |
| `POST` | `/organizations/:id/leave` | any member | Leave. The last owner is refused |
| `GET` / `POST` | `/organizations/:id/invites` | owner/admin | List open invites, or create one (rate limited; returns the link) |
| `POST` | `/organizations/:id/invites/:inviteId/resend` | owner/admin | New link, and email it unless `sendEmail` is false |
| `DELETE` | `/organizations/:id/invites/:inviteId` | owner/admin | Withdraw an invite |
| `POST` | `/public/invites/lookup` | public, rate limited | Invite status, organization, role and a masked address |
| `POST` | `/invites/accept` | `requireAuth` + confirmed email | Accept an invite |
| `GET` | `/admin/organizations` | `requirePlatformAdmin` | List all organizations with member & active tournament counts |
| `PATCH` | `/admin/organizations/:id` | `requirePlatformAdmin` | Approve, verify, suspend, or change plan tier & quotas |
| `GET` | `/player/profiles` | `requireAuth` | List all player/family profiles managed by the signed-in account |
| `POST` | `/player/profiles` | `requireAuth` | Create a primary (`self`) or sub-profile (`child`, `student`, `family`) |
| `PATCH` | `/player/profiles/:id` | `requireAuth` | Update a player profile owned by the signed-in account |
| `DELETE` | `/player/profiles/:id` | `requireAuth` | Delete a sub-profile owned by the signed-in account |
| `POST` | `/player/profiles/:id/claim` | `requireAuth` + confirmed email | Link participations entered under the account's confirmed email; returns `{ claimedCount, participantIds }` |
| `GET` | `/player/dashboard` | `requireAuth` | Return profiles, live matchday card, career W/D/L stats, tournament history & certificates |

---

## Sync rules (`POST /sync/push`, `GET /sync/pull`)

The rules live in `apps/api/src/lib/syncEngine.ts`, shared by both stores. A batch runs in one transaction.

- **Ownership**: a caller writes only tournaments they own or manage through an organization (`owner`, `admin`, `director`). This includes soft-deleted rows: only the owner can revive one. Rows with no owner can't be claimed through sync.
- **Results**: a game in a confirmed round can't be changed unless the same batch undoes the confirmation. A floor-locked result can be replaced only by a director result, and the lock stays. Each result change writes a `game_result_events` row. Corrections through `PATCH /games/:id/result` work as before. A late correction with a reason can change a confirmed round: see `docs/FEATURES_LATE_CORRECTIONS.md`.
- **Timestamps**: an `updatedAt` ahead of the server's clock is clamped to server time. If a pushed row has the same millisecond as the stored one, its content decides: the same row is a no-op, as a retry is, and a different one goes one millisecond past the stored row and is saved.
- **Pull cursor**: `server_updated_at`, set by a database trigger, decides what a pull returns, so an edit made offline and pushed late still reaches other devices. Each pull re-reads the last minute. Request and response shapes are unchanged.
- **Response**: `{ accepted, rejected: [{ entity, id, code, reason }], serverTime }`. `accepted` counts rows actually saved.
- **Older clients**: a request without `reportRejections: true` gets a whole-batch `4xx` for `forbidden`, `forbidden_organization`, `quota` or `invalid`, and nothing is saved, so its rows stay dirty. Other codes (`stale`, `round_confirmed`, `result_locked`, `tournament_not_found`) return `200`, and such a client ignores them.

## Certificate email limits

Rolling 24-hour caps, counted in `email_sends`:

| Sender | Test emails | Bulk emails |
|--------|-------------|-------------|
| Trial or unverified | 5 | Not allowed |
| Verified Event Pass | 50 | 500 |
| Verified Pro | 50 | 2,000 |
| Verified Enterprise | 50 | 5,000 |

A test email goes only to the sender's own confirmed address.
