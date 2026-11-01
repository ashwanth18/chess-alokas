# Chess Alokas

Cloud-capable chess tournament pairing system with offline-first React UI (PWA + **Electron desktop**), Fastify API, FIDE Swiss pairing engine, and digital certificates.

> **Agents / future you:** start at [`docs/AGENT_HANDOFF.md`](docs/AGENT_HANDOFF.md) for working memory (architecture, gaps, how to resume).

## Features

- **Configurable categories** — Under 12, Under 18, Female/Male, or any custom filter on age/gender/rating
- **FIDE Swiss pairing** — score groups, rematch avoidance, color balance, byes
- **Tournament styles** — Swiss implemented; Round Robin selectable as “coming soon”
- **CSV / Excel import** — map columns, auto-assign categories
- **Offline-first** — Dexie (IndexedDB) local store; **Sync online** push/pull (last-write-wins)
- **Auth & Multi-Tenant B2B Organizations** — email/password, OTP/magic link, Google & GitHub; role-based signup (`Player / Parent` vs `Organizer / Academy`), Sandbox Trial quotas (1 tournament / 24 players), and Platform Admin B2B verification
- **Global Player & Family Portal (`/player`)** — manage `Self` + `Child / Student` sub-profiles under one parent account, claim past tournaments, Live Matchday Companion card (board, color, opponent, score), career W/D/L stats, and Digital Certificate Vault
- **GPS Tournament Discovery & 1-Click Registration (`/discover`, `/register/:slug`)** — Haversine GPS nearby event search, shareable registration forms with 1-click family profile autofill, DuitNow/QR payment receipt upload, and organizer approval queue that auto-populates the tournament roster
- **Floor Arbiter Zone Grid, Chief Arbiter Alerts & Offline Queue (`/t/:slug`)** — score an entire zone of tables (`1–15`, `16–30`, `31+`, `Pending Only`) from one round PIN unlock, raise one-tap `"Call Chief Arbiter"` alerts to the Director Desk, and queue floor results offline when venue Wi-Fi drops
- **Morning Roll Call Check-In & Venue TV / Projector Mode (`/live/:token/tv`)** — check in arriving players on the `Players` tab and exclude unchecked no-shows before Round 1; display auto-rotating pairings, category standings, and a round countdown clock on 1080p/4K venue screens
- **Certificates** — PDF designer, print pack, Issue digital → Supabase Storage (or local disk)
- **Desktop app** — Electron shell; production builds use cloud API (no user secrets)
- **Simulator** — generate players, auto-play rounds, visualize boards/standings/diagnostics

## Production host

- Web + API: **`https://chess-manager.alokas.com`** (Dokploy)
- **Deployment pipeline (ship web / desktop / migrations):** [`deploy/PIPELINE.md`](deploy/PIPELINE.md)
- Dokploy one-time setup: [`deploy/DOKPLOY.md`](deploy/DOKPLOY.md)
- Self-hosted Supabase migration guide: [`deploy/SUPABASE_MIGRATION.md`](deploy/SUPABASE_MIGRATION.md)
- Engineering & agent rules handbook: [`docs/ENGINEERING_AND_AGENT_RULES.md`](docs/ENGINEERING_AND_AGENT_RULES.md)
- Organizations & Player Portal feature guide: [`docs/FEATURES_ORGANIZATIONS_AND_PLAYERS.md`](docs/FEATURES_ORGANIZATIONS_AND_PLAYERS.md)
- Registration & GPS Discovery feature guide: [`docs/FEATURES_REGISTRATION_AND_DISCOVERY.md`](docs/FEATURES_REGISTRATION_AND_DISCOVERY.md)
- Floor Arbiter Zone Grid, Chief Arbiter Alerts & Venue TV guide: [`docs/FEATURES_ARBITER_AND_VENUE_TV.md`](docs/FEATURES_ARBITER_AND_VENUE_TV.md)
- Agent handoff: [`docs/AGENT_HANDOFF.md`](docs/AGENT_HANDOFF.md)

## Monorepo

| Path | Package | Role |
|------|---------|------|
| `apps/api` | `@chess-alokas/api` | Fastify API, import, pairing, sync, certificates |
| `apps/web` | `@chess-alokas/web` | React UI (browser PWA + Electron renderer) |
| `apps/desktop` | `@chess-alokas/desktop` | Electron main / preload / installer |
| `packages/pairing-engine` | `@chess-alokas/pairing-engine` | Swiss engine + simulator |
| `packages/shared` | `@chess-alokas/shared` | Types, Zod schemas, category filters |
| `packages/certificates` | `@chess-alokas/certificates` | PDF stamp / batch / light compress |
| `supabase/migrations` | — | Postgres schema |
| `docs/AGENT_HANDOFF.md` | — | Agent working memory |

### Branching policy

- **One monorepo on `main`** — do **not** maintain long-lived separate “electron frontend” vs “web frontend” branches.
- Use short-lived `feat/*` branches; push after major milestones; merge to `main`.
- Web and desktop share `apps/web` + `apps/api`.

## Prerequisites

- Node.js 22+ (matches Docker / Dokploy; see `.nvmrc`)
- [pnpm](https://pnpm.io) 11 (`packageManager` in root `package.json`)
- Optional: [Supabase](https://supabase.com) project for cloud Postgres + Storage
- Desktop builds: Windows (NSIS / portable via electron-builder)

## Setup

```bash
pnpm install
```

Copy env examples:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

### API without Supabase

Leave `DATABASE_URL` unset. The API uses an in-memory store (fine for local demos; data resets on restart).

### API with Supabase

1. Create a Supabase project
2. Apply migrations under `supabase/migrations/` (including certificates)
3. Set `DATABASE_URL` in `apps/api/.env`
4. For digital certificates: `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (bucket `certificates`, 10 MB/file)

### Web

```bash
# apps/web/.env
VITE_API_URL=http://localhost:3001
```

## Develop

```bash
# API (3001) + web (5173)
pnpm dev

# or separately
pnpm --filter @chess-alokas/api dev
pnpm --filter @chess-alokas/web dev
```

### Desktop (Electron)

See [`apps/desktop/README.md`](apps/desktop/README.md).

```bash
# Terminal 1 — Vite
pnpm --filter @chess-alokas/web dev

# Terminal 2 — Electron (starts its own API sidecar)
pnpm --filter @chess-alokas/desktop dev
```

Desktop stores API secrets in `%APPDATA%\Chess Alokas\api.env` (seeded from `apps/api/.env` on first run in dev).

## Production desktop build

```bash
pnpm run build:desktop
```

Output: `apps/desktop/release/` (installer + portable).

## Test

```bash
pnpm --filter @chess-alokas/pairing-engine test
```

## Offline vs online

| Concern | Where |
|---------|--------|
| Tournament data day-to-day | Dexie in the UI |
| Sync to cloud | Fastify `/sync/*` → Supabase Postgres |
| Digital certificate PDFs | Fastify → Supabase Storage or local `CERTIFICATES_DIR` |
| Pairing / standings | Client (`pairing-engine`) |

## API overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health + store mode + storage backend |
| GET/POST | `/tournaments` | List / create |
| GET/PATCH/DELETE | `/tournaments/:id` | Detail / update / soft-delete |
| POST | `/tournaments/:id/categories` | Add category |
| POST | `/tournaments/:id/import` | Multipart CSV/XLSX import |
| POST | `/tournaments/:id/rounds/:n/pair` | Generate pairings |
| PATCH | `/games/:id/result` | Set result |
| GET | `/tournaments/:id/standings` | Standings |
| GET | `/sync/pull?since=` | Pull LWW sync |
| POST | `/sync/push` | Push LWW sync |
| POST | `/tournaments/:id/certificates/issue` | Store digital PDFs |
| POST | `/tournaments/:id/certificates/email` | Email issued PDFs |
| GET | `/certificates/:issueId/download` | Download issued PDF (organizer or linked player) |
| GET/POST | `/organizations` | List / create B2B organization (Sandbox Trial) |
| PATCH | `/organizations/:id` | Update organization contact & payment info |
| GET/PATCH | `/admin/organizations` | Platform admin B2B organization review & tier upgrades |
| GET/POST/PATCH/DELETE | `/player/profiles` | Manage global `Self` + `Child / Student` player profiles |
| POST | `/player/profiles/:id/claim` | Claim past/live tournament participations |
| GET | `/player/dashboard` | Player career stats, live matchday card, and certificate vault |
| GET | `/public/events` | Public tournament discovery feed with GPS Haversine distance & search |
| GET/POST | `/public/events/:slugOrId`, `/public/events/:slugOrId/register` | Public event details & 1-click player/family registration with receipt upload |
| PATCH | `/tournaments/:id/publishing` | Configure registration slug, GPS venue, entry fee, payment QR & global discovery |
| GET/POST | `/tournaments/:id/registrations`, `/tournaments/:id/registrations/:regId/review` | Organizer registration queue & 1-click roster approval |
| GET/POST | `/public/tables/:slug/zone`, `/public/tables/:slug/call-chief` | Floor arbiter Zone Grid view & Call Chief Arbiter alert |
| GET/POST | `/tournaments/:id/floor/alerts`, `/tournaments/:id/floor/alerts/:alertId/resolve` | List & resolve active Chief Arbiter floor alerts |

## Typical flow

1. Open web or desktop → **New Tournament** → add categories
2. Import CSV or register players
3. Generate round pairings, enter results, view standings
4. **Sync** when connected to push/pull cloud state
5. **Certificates** → template → Issue digital (optional email)
6. Use **Simulator** to stress-test Swiss logic

## License

Private — Chess Alokas
