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
- `registration_form_schema jsonb` — the form. See "The form builder" below.

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

---

## Adding a receipt after registering

`POST /player/registrations/:id/receipt` with `{ "receiptDataUrl": "data:<type>;base64,..." }` needs sign-in. It uses the same file check and private storage as registering, and answers `200 { registration }`, with `hasReceipt: true` and `paymentStatus: "submitted"`.

- **Who:** the account that submitted the entry, or whose saved profile made it. Anyone else, the organizer included, gets 404. An entry made without signing in can't use this.
- **When:** while the entry is `pending` or `waitlisted` and its payment is `pending_receipt` or `submitted`. Otherwise 409. That covers an approved, rejected or cancelled entry, a free one, and settled payments.
- **Replacing:** each upload gets a new file name and the old file is then removed, so a late upload can't overwrite the file an organizer based a decision on. If the old file can't be removed it is logged and left behind, unlinked.
- **Limits:** PNG, JPEG, WebP or PDF up to 5 MB (otherwise 400), and 20 uploads per person per 15 minutes (otherwise 429).

## Registration review rules

Each review runs in one transaction, locking the tournament and the registration.

| Action | Allowed from |
|--------|--------------|
| Approve | `pending`, `waitlisted`, `rejected` |
| Reject | `pending`, `waitlisted`, `approved` |
| Waitlist | `pending`, `approved`, `rejected` |

- Any other transition returns `409`, including approving an already approved registration and anything on a `cancelled` one.
- Rejecting or waitlisting an approved registration soft-deletes its participant. If that player has games in a confirmed round, the review returns `409` and nothing changes.
- Re-approving brings the same participant back.
- `selectedCategoryId` must belong to the tournament, or registering returns `400`.
- Approving a paid registration needs a receipt or `confirmPaymentWithoutReceipt: true`. Without either, it returns `409` and nothing changes.
- The organizer list sets `possibleDuplicate` when another live registration has the same name and at least one of the two has no email. Both registrations stay allowed.

## The form builder

Each event has one form, on the Registrations step of its tournament page, used by the public link (`/register/:slug`, no app or account) and by the apps. Both land in one queue. An entry shows "Link, no account" or "Signed-in account"; nothing in the data separates a browser from the app.

**Form (`RegistrationFormConfig`):** `collectSchool`, `collectFideId`, `collectPhone` (on by default), `collectNric`, `collectAgeProof` (off; required when on), `malayLabels`, and `customQuestions`: `{ id, label, labelMs?, type, required, options?, retiredOptions?, hidden? }` where `type` is `text`, `select`, `checkbox` or `file`. At most 30 visible questions and 3 file questions.

**Editing is non-destructive.** `PATCH /tournaments/:id/publishing` compares with what entries have answered (`mergeRegistrationForm`). A removed question with answers becomes `hidden`; a removed option with answers moves to `retiredOptions`; changing the type of an answered question is a 409. Sync never writes the form: only this route does.

**What public clients get** (`publicRegistrationForm`): no hidden questions or retired options. `questions` lists every visible question with `label` and `labelMs`. `customQuestions` lists text and select only, with both languages in `label`, for app builds that predate `questions`.

**Submitting** `POST /public/events/:slugOrId/register` also takes `customAnswers` (string, or boolean for a checkbox), `customFiles` (question id to data URL), `nricNumber` and `ageProofDataUrl`. The server checks required answers, dropdown values, types, lengths, file types and bytes (`checkRegistrationAnswers`), and answers `400 { error }` with text to show as it is. An answer to a question not on the form is dropped, not refused, so a page opened before an edit still works. A body is limited to 36 MB.

**Private data.** `nric_number` and `private_files` sit on the registration, and clients can't read the table directly (`034`). `toClientRegistration` replaces them with `nricMasked` (`******-**-1234`) and `files` (no storage paths). Neither is ever copied to a participant. Files use the receipts bucket and `decodeReceiptDataUrl`: PNG, JPEG, WebP or PDF, checked by signature, 5 MB.

| Method | Path | Who | What |
|---|---|---|---|
| `GET` | `/tournaments/:id/publishing` | Owner, admin, director | Settings, form with hidden questions, answer counts, what the org `can` do |
| `GET` | `/tournaments/:id/registrations/:regId/nric` | Owner, admin, director | The full number |
| `GET` | `/tournaments/:id/registrations/:regId/files/:fileId` | Owner, admin, director | File bytes, `nosniff`, `no-store` |
| `POST` | `/tournaments/:id/registrations/delete-age-proofs` | Owner, admin, director | Body `{ "confirm": true }`. Removes age proof files and NRIC numbers. Receipts and file answers stay |
| `GET` | `/public/events/:slugOrId/schools?q=` | Public, open events | School names from the organizer's earlier entries used at least twice |

Those private routes, the registrations list and the receipt route refuse an arbiter even if they created the tournament, because they check organization role as well as ownership. Account deletion clears the NRIC at once and removes files through the existing 30-day purge.

**Who can open a link:** any account, verified or not, for a free event. Listing on `/discover` needs a verified academy with `canPublishGlobal`, and a fee needs `canAcceptPaidRegistrations`. A suspended or rejected organization's link stops working.

**Exports.** The queue's "Download CSV" has answers and whether each file was attached, never NRIC numbers. It is the only registration export.
