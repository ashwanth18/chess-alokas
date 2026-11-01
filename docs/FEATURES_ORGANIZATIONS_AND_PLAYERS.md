# Multi-Tenant B2B Organizations, Sandbox Trial & Global Player Portal

This document covers the **Phase 1** multi-tenant B2B organizer architecture and B2C global participant/family portal in Chess Alokas 2.0.

---

## 1. Overview: Dual-Workspace Architecture

Chess Alokas supports two complementary workspaces under a single unified Supabase Auth account, switchable at any time via the top-navigation **Workspace Switcher** (`♟ Player Portal` `/player` ↔ `♕ Organizer Desk` `/app`):

| Workspace | Target Audience | Scope & Access Model |
|-----------|-----------------|----------------------|
| **Player & Family Portal (`/player`)** | Players, parents, and academy students (B2C) | **Global across the platform** — instant free signup, no admin approval required. One account manages a `Self` primary profile plus multiple `Child`, `Student`, or `Family` sub-profiles. |
| **Organizer Desk (`/app`)** | Tournament directors, chess clubs, schools, and academies (B2B) | **Tenant-scoped via `organizations` & `organization_members`**. Starts immediately in **Sandbox Trial** mode (`1` active tournament, up to `24` players) until verified by a Platform Admin. |

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

1. **Organizer Signup (`/signup` → `♕ Organizer / Academy`)**:
   - Collects Director Name, Organization/Academy Name, City/State, and Contact Phone/WhatsApp.
   - Calls `POST /organizations`, creating the organization in `trial` / `pending_review` mode (`maxTournamentsQuota = 1`, `maxPlayersPerTournament = 24`).
2. **Sandbox Trial Quota Enforcement**:
   - Enforced in both `MemoryStore` and `PostgresStore` (`apps/api/src/db.ts`) across `createTournament`, `createParticipant`, `upsertParticipants`, and `pushSync`.
   - Attempting to create a 2nd active tournament or exceed 24 active players in a trial organization returns `403 Forbidden` with a clear `Sandbox Trial quota reached` message.
3. **Platform Admin B2B Approval (`/admin`)**:
   - Platform admins view all organizations in the **Organizations & B2B Approvals** panel and can apply 1-click actions via `PATCH /admin/organizations/:id`:
     - **Verify + Event Pass**: `verificationStatus = 'verified'`, `planTier = 'event_pass'`, `maxTournamentsQuota = 3`, `maxPlayersPerTournament = 250`, `canPublishGlobal = true`.
     - **Verify + Pro (Unlimited)**: `verificationStatus = 'verified'`, `planTier = 'pro'`, `maxTournamentsQuota = null`, `maxPlayersPerTournament = null`, `canPublishGlobal = true`.
     - **Reset to Trial**: Resets to `pending_review` / `trial` (`1` tournament, `24` players).
     - **Suspend**: Sets `verificationStatus = 'suspended'`, blocking new tournament creation.

---

## 4. Global Player & Family Portal (`/player`)

- **Family / Player Switcher Bar**:
  - Parents and coaches can switch between their own `Self` profile and any number of `Child`, `Student`, or `Family` sub-profiles.
- **Claim Past Tournaments (`POST /player/profiles/:id/claim`)**:
  - Automatically links historical `participants` rows across tournaments where `fide_id`, `email`, or `name` matches the player profile.
- **Live Matchday Companion Card**:
  - When the selected profile is in a `ready` or `in_progress` tournament, displays a real-time card showing the tournament name, current round, **Board #**, **Piece Color (`♔ White` / `♚ Black` / `Bye`)**, **Opponent Name & Rating**, current score, and a direct link to the public live view.
- **Career Overview & Digital Certificate Vault**:
  - Aggregates career games played, total points, Win/Draw/Loss breakdown, Alokas & FIDE ratings (Standard / Rapid / Blitz), tournament history, and 1-click PDF downloads for issued certificates (`GET /certificates/:issueId/download`).

---

## 5. API Endpoints Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/organizations` | `requireAuth` | List organizations where the signed-in user is owner or member |
| `POST` | `/organizations` | `requireAuth` | Create a new organization in Sandbox Trial mode (`trial` / `pending_review`) |
| `PATCH` | `/organizations/:id` | `requireAuth` (owner/admin) | Update organization contact details, location, or payment instructions |
| `GET` | `/admin/organizations` | `requirePlatformAdmin` | List all organizations with member & active tournament counts |
| `PATCH` | `/admin/organizations/:id` | `requirePlatformAdmin` | Approve, verify, suspend, or change plan tier & quotas |
| `GET` | `/player/profiles` | `requireAuth` | List all player/family profiles managed by the signed-in account |
| `POST` | `/player/profiles` | `requireAuth` | Create a primary (`self`) or sub-profile (`child`, `student`, `family`) |
| `PATCH` | `/player/profiles/:id` | `requireAuth` | Update a player profile owned by the signed-in account |
| `DELETE` | `/player/profiles/:id` | `requireAuth` | Delete a sub-profile owned by the signed-in account |
| `POST` | `/player/profiles/:id/claim` | `requireAuth` | Claim past/live tournament `participants` rows matching FIDE ID, email, or name |
| `GET` | `/player/dashboard` | `requireAuth` | Return profiles, live matchday card, career W/D/L stats, tournament history & certificates |
