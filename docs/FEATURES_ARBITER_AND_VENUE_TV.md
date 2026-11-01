# Floor Arbiter Zone Grid, Chief Arbiter Alerts, Morning Roll Call & Venue TV Mode

This guide documents **Chess Alokas 2.0 — Phase 3**: Floor Arbiter Zone Grid scoring, Chief Arbiter escalation alerts, Offline Floor Result Queue, Morning Roll Call check-in, and Live Venue TV / Projector Mode (`/live/:token/tv`).

---

## 1. Database Schema (`supabase/migrations/027_floor_alerts_and_checkin.sql`)

### `participants.checked_in`
- `checked_in boolean not null default false` — tracks morning venue arrival check-in status (also mirrored in `customFields.checkedIn` on `LocalParticipant` for offline-first Dexie operation).

### `public.floor_alerts`
Stores live escalation requests from floor arbiters to the Chief Arbiter / Tournament Director desk:
- `id` (`uuid`, PK)
- `tournament_id` (`uuid`, FK → `tournaments.id` ON DELETE CASCADE)
- `round` (`integer`)
- `table_number` (`integer`)
- `game_id` (`uuid`, nullable FK → `games.id` ON DELETE SET NULL)
- `arbiter_name` (`text`, nullable)
- `reason` (`text`, up to 300 chars, e.g. `"Illegal move dispute"`, `"Clock malfunction"`, `"Player missing"`)
- `created_at` (`timestamptz`)
- `resolved_at` (`timestamptz`, nullable — `NULL` while active)

Row-Level Security (RLS) is enabled on `public.floor_alerts` and scoped to the tournament owner and authorized organization members (`owner`, `admin`, `director`, `arbiter`).

---

## 2. REST API Endpoints (`apps/api/src/routes/publicTables.ts` & `floor.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/public/tables/:slug/zone` | Arbiter Round Token (`Bearer` / `X-Arbiter-Session`) | Returns `{ tournamentId, tournamentName, round, arbiterName, boards: FloorZoneBoard[] }` sorted by `tableNumber` for all boards in the active PIN round |
| `POST` | `/public/tables/:slug/result` | Arbiter Round Token | Locks a board result (`1-0`, `0-1`, `1/2-1/2`, `1-0F`, `0-1F`, `0-0`). Accepts any valid arbiter session token for the tournament and active round so arbiters can score across their entire zone from a single PIN unlock |
| `POST` | `/public/tables/:slug/call-chief` | Arbiter Round Token | Creates an active `FloorAlert` for the table and round (`{ reason, arbiterName? }`) and returns `{ alert }` |
| `GET` | `/tournaments/:id/floor/alerts` | Organizer JWT (`requireAuth`) | Lists active (or all via `?activeOnly=false`) floor alerts for the tournament |
| `POST` | `/tournaments/:id/floor/alerts/:alertId/resolve` | Organizer JWT (`requireAuth`) | Marks a floor alert as resolved (`resolved_at = now()`) |

---

## 3. Floor Arbiter Mobile Experience (`/t/:slug` — `TableScoringPage.tsx`)

1. **Single Unlock per Round**:
   - Unlocking any table QR sticker with the 6-digit Round PIN issues a tournament-round session token valid across all tables in that round.
   - A session belongs to the PIN that issued it: rotating the PIN ends all older sessions, even within the same round. Two arbiters scoring one board at once can't both succeed: the second gets `409`, and only one audit event is written.
2. **View Mode Toggle (`Single Table` vs. `Zone Grid (All Tables)`)**:
   - Floor arbiters covering a section of tables can switch to **Zone Grid (All Tables)** and filter by range (`All`, `1–15`, `16–30`, `31+`, `Pending Only`).
   - Pending boards can be scored inline (`1-0`, `0-1`, `1/2-1/2`, `1-0F`, `0-1F`, `0-0` + `Confirm`) or opened in Single Table view without scanning 15 separate QR stickers.
3. **🚨 Call Chief Arbiter Button**:
   - Opens a quick sheet with one-tap presets (`"Illegal move dispute"`, `"Clock malfunction"`, `"Player missing"`, or custom note) and alerts the Director Desk with confirmation `"Chief Arbiter alerted for Table X"`.
4. **Offline Floor Result Queue (`alokas-floor-offline-queue`)**:
   - If venue Wi-Fi drops when an arbiter confirms a result, the submission (`{ slug, token, result, arbiterName, tableNumber, queuedAt }`) is saved in `localStorage` under `alokas-floor-offline-queue`.
   - Displays `"Saved offline — will auto-submit when Wi-Fi reconnects"` and automatically flushes the queue as soon as connectivity returns.

---

## 4. Director Desk Enhancements (`TournamentPage.tsx`)

1. **Chief Arbiter Alert Banner (`Pairings` Tab)**:
   - Polls active `FloorAlert`s alongside round cards/games and renders a high-visibility red alert banner (`"🚨 Table 4 needs Chief Arbiter (Arbiter: Ravi — Clock malfunction)"`) with a one-click **Resolve / Dismiss** button.
2. **Morning Roll Call / Check-In Mode (`Players` Tab)**:
   - Toggling **Check-In Roll Call** adds a `Check-in` column (`Present` / `Unchecked`) stored in `customFields.checkedIn` on `LocalParticipant`.
   - Shows live `Checked in: X / Y` progress, `Check In All` / `Clear All` helpers, and **"Mark Unchecked Players Absent for Round 1"** to exclude no-shows before generating Round 1 pairings.
3. **Quick Launch for Venue TV Mode**:
   - When Public Live is enabled, an **"📺 Open TV / Projector Mode"** button appears in the tournament header and in the Public Live share box.

---

## 5. Live Venue TV / Projector Mode (`/live/:token/tv` — `LiveTvPage.tsx`)

Designed for 1080p/4K venue TVs, hall monitors, and projectors:
- **Top Venue Header Bar**:
  - Tournament title, current Round $N$, live board completion counter (`X/Y boards finished`), and online sync indicator.
  - **Round Countdown Clock**: Configurable presets (`15m`, `25m`, `30m`, `60m`) with `Start`, `Pause`, and `Reset` controls; turns amber under 5 minutes and red at `00:00`.
  - **View Mode Selector**: `Auto-Rotate Pairings & Standings`, `Pairings Only`, or `Standings Only`.
- **Auto-Paging Multi-Column Stage**:
  - High-contrast dark projector layout showing 12 boards per slide and top category standings with medals (`🥇`, `🥈`, `🥉`), scores, and tiebreaks (`BH`, `BH-C1`, `SB`), automatically advancing slides every 10 seconds.
