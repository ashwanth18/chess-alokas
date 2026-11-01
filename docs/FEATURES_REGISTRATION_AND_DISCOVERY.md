# Tournament Discovery (GPS), Shareable Registration Forms & Organizer Approval Queue

This document covers **Phase 2** of Chess Alokas 2.0: public tournament discovery (`/discover`), Haversine GPS nearby search, shareable registration links (`/register/:slug`) with 1-click player/family autofill and payment receipt upload, and the organizer approval queue (`TournamentPage.tsx`).

---

## 1. Database Schema (`026_tournament_discovery_and_registrations.sql`)

### 1.1 `tournaments` Discovery & Registration Columns
- `public_slug text unique` — human-readable registration slug (e.g., `kl-junior-rapid-2026`).
- `is_published_global boolean not null default false` — lists the event on `/discover` (requires verified B2B organization `can_publish_global = true`).
- `registration_open boolean not null default false` — enables online registration submissions at `/register/:slug`.
- `registration_deadline timestamptz` — optional registration cutoff timestamp.
- `max_participants integer` — optional roster capacity cap.
- `venue_name text`, `venue_address text`, `city text`, `state text`, `country text default 'Malaysia'`.
- `latitude double precision`, `longitude double precision` — WGS84 coordinates for GPS Haversine distance sorting and Google Maps deep links.
- `description_md text`, `rules_md text`, `time_control text`, `prize_summary_json jsonb`, `poster_storage_path text`.
- `entry_fee_cents integer not null default 0`, `currency text not null default 'MYR'`, `payment_instructions text`, `payment_qr_url text` (paid fees require verified B2B organization `can_accept_paid_registrations = true`).
- `registration_form_schema jsonb` — configurable toggles (`collectSchool`, `collectFideId`, `collectPhone`) and custom questions (`customQuestions`).

### 1.2 `tournament_registrations` Table
- `id uuid primary key default gen_random_uuid()`
- `tournament_id uuid not null references tournaments(id) on delete cascade`
- `player_profile_id uuid references player_profiles(id) on delete set null`
- `submitted_by_user_id uuid references auth.users(id) on delete set null`
- `selected_category_id uuid references categories(id) on delete set null`
- `player_snapshot jsonb not null default '{}'::jsonb` — immutable snapshot of player details at registration time (`name`, `age`, `yearOfBirth`, `gender`, `fideId`, `rating`, `school`, `club`, `city`, `state`, `country`, `email`, `phone`).
- `custom_answers jsonb not null default '{}'::jsonb`
- `payment_status text not null default 'not_required'` (`'not_required' | 'pending_receipt' | 'submitted' | 'verified' | 'refunded'`)
- `receipt_data_url text` — uploaded payment receipt screenshot/PDF data URL.
- `amount_cents integer not null default 0`
- `status text not null default 'pending'` (`'pending' | 'approved' | 'waitlisted' | 'rejected' | 'cancelled'`)
- `reviewer_note text`, `reviewed_at timestamptz`
- `participant_id uuid references participants(id) on delete set null` — populated automatically when the organizer approves the registration into the tournament roster.
- Partial unique index `idx_unique_active_profile_registration` prevents duplicate active (`status not in ('cancelled', 'rejected')`) registrations for the same `(tournament_id, player_profile_id)`.

---

## 2. Public Discovery & Haversine GPS Search (`/discover`)

- Accessible both signed-out and signed-in at **`/discover`**.
- **Text Search**: Filters published tournaments across tournament name, venue name, venue address, city, state, country, and organizing academy name.
- **Near Me (GPS)**:
  - Uses `navigator.geolocation.getCurrentPosition` to capture the user's latitude and longitude.
  - Computes great-circle distance in kilometers using `haversineDistanceKm(lat1, lon1, lat2, lon2)` from `@chess-alokas/shared`.
  - Supports radius filter pills (`10 km`, `25 km`, `50 km`, `All distances`) and sorts nearby events closest-first with a `📍 X.X km away` badge.

---

## 3. Shareable Registration Form & 1-Click Family Autofill (`/register/:slug`)

- Accessible via **`/register/:slug`** (or `/register/:tournamentId`).
- **Event Hero**: Displays organizer name, tournament title, date, format, rounds, time control, entry fee, confirmed roster count, rules, and a **📍 Open Venue in Google Maps** button.
- **1-Click Player & Family Autofill**:
  - When signed in, fetches all `player_profiles` (`Self`, `Child`, `Student`, `Family`) managed by the account.
  - Clicking any profile chip immediately populates Full Name, Year of Birth, Gender, FIDE ID, Rating, School, Club, City, State, Email, and Phone, and automatically selects the matching tournament category using `matchesFilter` from `@chess-alokas/shared`.
  - After submitting a child's registration, parents can click **+ Register Another Child / Player** to register siblings in seconds.
- **Payment QR & Receipt Upload**:
  - When `entryFeeCents > 0`, displays the organizer's DuitNow / bank transfer instructions, payment QR code image, and a receipt upload input (`receiptDataUrl`), setting `paymentStatus = 'submitted'`.

---

## 4. Organizer Registration & Approval Queue (`TournamentPage.tsx`)

Inside each tournament's **`Registrations`** tab:
1. **Shareable Registration Link & GPS Discovery Settings**:
   - Configure `publicSlug`, toggle **Accept Online Registrations** (`registrationOpen`) and **Publish to Global `/discover` Feed** (`isPublishedGlobal`).
   - Set Venue Name, Address, City, State, and GPS Latitude/Longitude (with a **📍 Use my current GPS** button).
   - Set Time Control, Entry Fee (`MYR`), Payment Instructions, and upload a Payment QR image.
   - **B2B Verification Gate**: Unverified Sandbox Trial organizations are blocked (`403 Forbidden`) from enabling global discovery or collecting paid entry fees until verified by a Platform Admin.
2. **Incoming Registrations & Receipt Approval Queue**:
   - Filter registrations by `All`, `Pending`, `Approved`, `Waitlisted`, or `Rejected`.
   - Inspect uploaded payment receipts in a modal (`View Receipt`).
   - Clicking **Approve into Roster** (or **Approve All Pending**) calls `POST /tournaments/:id/registrations/:regId/review`:
     - Automatically creates/upserts the `Participant` in the tournament roster with `playerProfileId` linked.
     - Evaluates category filters via `assignCategories` (plus `selectedCategoryId`).
     - Marks `paymentStatus = 'verified'` and `status = 'approved'`.
     - Syncs the new participant directly into local Dexie (`db.participants.put(...)`) so the `Players` tab updates immediately.

---

## 5. API Endpoints Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/public/events` | Public | List globally published tournaments with optional `lat`, `lng`, `radiusKm`, and `search` filters |
| `GET` | `/public/events/:slugOrId` | Public | Sanitized event details, categories, registration form config, payment QR/instructions, and confirmed roster |
| `POST` | `/public/events/:slugOrId/register` | Optional Auth | Submit player registration (merges `playerProfileId` when signed in, attaches `receiptDataUrl`, prevents duplicates) |
| `PATCH` | `/tournaments/:id/publishing` | `requireAuth` (owner/org) | Update slug, `registrationOpen`, `isPublishedGlobal`, GPS venue, entry fee, and payment QR (enforces B2B verification gate) |
| `GET` | `/tournaments/:id/registrations` | `requireAuth` (owner/org) | List all registrations submitted for a tournament |
| `POST` | `/tournaments/:id/registrations/:regId/review` | `requireAuth` (owner/org) | Approve, waitlist, or reject a registration; approval auto-creates the roster `Participant` |
| `GET` | `/player/registrations` | `requireAuth` | List registrations submitted by or linked to the signed-in player/parent account |
