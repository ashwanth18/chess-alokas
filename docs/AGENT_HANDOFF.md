# Agent working memory — Chess Alokas

**Read this first** when context is full or starting a new session on this repo.

Last updated: 2026-11-01 (Chess Alokas 2.0 Phase 2: GPS Tournament Discovery `/discover`, Shareable Registration Forms `/register/:slug` with 1-Click Family Profile Autofill & Payment Receipt Upload, and Organizer Approval Queue — migration `026`)

## What this product is

Offline-first chess tournament manager with **per-manager accounts**:

- **UI:** React + Dexie (`apps/web`) — browser + Electron renderer
- **API:** Fastify (`apps/api`) — JWT-gated sync, certs, tournaments, floor scoring, public live/analytics
- **Pairing:** in-house Swiss engine, plus a Dutch-system engine wrapping FIDE-approved `bbpPairings` v6 (`packages/pairing-engine/src/dutch/`)
- **Auth:** Supabase Auth — email/password, OTP/magic link, Google, GitHub
- **Cloud host:** `https://chess-manager.alokas.com` (Dokploy on Hostinger VPS)
- **Desktop:** Electron (currently v0.1.53); packaged builds call cloud API (no user secrets); auto-updates in-app; Sentry error monitoring wired for web/API/desktop

## Status

- [x] `owner_id` + `profiles` + RLS (`005_auth_owners.sql`)
- [x] Fastify `requireAuth` + owner-scoped sync/tournaments/certs
- [x] Login / signup / OTP / OAuth / Account / Settings UI
- [x] `deploy/` Docker + `DOKPLOY.md`; desktop defaults to `https://chess-manager.alokas.com/api` when packaged
- [x] Dutch-system pairing via `bbpPairings` v6 (FIDE Dutch), selectable alongside in-house Swiss
- [x] Floor arbiter flow: PIN/QR per-table result entry (`apps/api/src/floor/`, `TableScoringPage.tsx`)
- [x] Public live viewer for parents/spectators (`publicLive.ts`, `LivePage.tsx`) + public analytics
- [x] Yellow/red card system for illegal moves, with card-limit auto-loss (`apps/api/src/lib/gameCards.ts`)
- [x] Configurable tiebreaks: progressive, direct encounter, BH-C1, Sonneborn-Berger, wins, shared places
- [x] Digital certificates: recipient picker, per-field font size, serials, template designer
- [x] FIDE monthly rating lookup (via Lichess API, local CSV parse + bulk load)
- [x] Platform admin dashboard: cross-account usage metrics, page-view analytics (`admin.ts`, `AdminPage.tsx`)
- [x] Sentry error monitoring (free tier) — web, API, desktop
- [x] Deep-scan security & workflow fixes across Web, Desktop, Pairing Engine, API, and DB (`023_fix_style_check_and_profiles_rls.sql`)
- [x] Engineering & agent rules handbook (`docs/ENGINEERING_AND_AGENT_RULES.md`, `.cursor/rules/engineering.mdc`) + self-hosted Supabase migration guide (`deploy/SUPABASE_MIGRATION.md`)
- [x] `scripts/replay-arcc-dutch.mts` — validation tool replaying ARCC 2026 through Dutch/bbp vs. actual results
- [x] **Chess Alokas 2.0 Phase 1**: Multi-tenant B2B `organizations` & `organization_members` (`024_organizations_and_roles.sql`), Sandbox Trial quota enforcement (`1` tournament / `24` players), Platform Admin B2B approval actions (`/admin`), Global `player_profiles` & family sub-profiles (`025_player_profiles.sql`), and Web Participant Portal (`/player` + Workspace Switcher)
- [x] **Chess Alokas 2.0 Phase 2**: Tournament Discovery & Shareable Registrations (`026_tournament_discovery_and_registrations.sql`), GPS Haversine nearby search (`/discover`), 1-click family/player registration with payment receipt upload (`/register/:slug`), B2B verification gate for global publishing/paid fees, and Organizer `Registrations` approval queue in `TournamentPage.tsx`

## Auth model

- Client: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` only
- Server: `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_ANON_KEY` (JWT verify), `SENTRY_DSN` (optional)
- `tournaments.owner_id = auth.users.id`
- Local demo: `AUTH_DISABLED=1` skips JWT (not for production)

## Key paths

| Path | Role |
|------|------|
| `apps/web/src/auth/` | AuthProvider |
| `apps/web/src/pages/LoginPage.tsx` | Password / OTP / OAuth |
| `apps/web/src/pages/AccountPage.tsx` | Profile, security, identities, delete |
| `apps/web/src/pages/TableScoringPage.tsx` | Floor arbiter PIN/QR result entry |
| `apps/web/src/pages/LivePage.tsx` | Public live pairings/standings viewer |
| `apps/web/src/pages/AdminPage.tsx` | Platform admin dashboard + B2B organization approvals |
| `apps/web/src/pages/PlayerPortalPage.tsx` | Participant & Family Portal (`/player`): live matchday card, career stats, certificate vault |
| `apps/web/src/pages/DiscoverEventsPage.tsx` | Public tournament discovery (`/discover`) with Haversine GPS nearby search |
| `apps/web/src/pages/EventRegistrationPage.tsx` | Shareable tournament registration form (`/register/:slug`) with 1-click profile autofill & receipt upload |
| `apps/web/src/pages/CertificatesPage.tsx` | Certificate template designer / issue |
| `apps/api/src/auth.ts` | JWT + `/me` |
| `apps/api/src/routes/organizations.ts` | B2B organization CRUD, Sandbox Trial, and admin approvals |
| `apps/api/src/routes/playerProfiles.ts` | Global player/family profiles, past participation claim, and career dashboard |
| `apps/api/src/routes/registrations.ts` | Public event discovery, registration submission, publishing settings & organizer approval queue |
| `apps/api/src/floor/` | PIN/QR floor scoring backend |
| `apps/api/src/routes/publicLive.ts`, `publicAnalytics.ts`, `publicTables.ts` | Unauthenticated public endpoints |
| `apps/api/src/lib/gameCards.ts` | Yellow/red card + auto-loss logic |
| `apps/api/src/fide/` | FIDE rating lookup (Lichess-backed) |
| `packages/pairing-engine/src/dutch/` | Dutch pairing (bbp.ts wraps `bbpPairings` binary) |
| `packages/pairing-engine/src/standings.ts` | Tiebreak calculations |
| `deploy/DOKPLOY.md` | VPS deploy checklist |
| `deploy/SUPABASE_MIGRATION.md` | Self-hosted Supabase on Dokploy options & cutover playbook |
| `docs/ENGINEERING_AND_AGENT_RULES.md` | Mandatory engineering, security, testing, docs & commit rules |
| `docs/FEATURES_ORGANIZATIONS_AND_PLAYERS.md` | Multi-tenant B2B organizations, Sandbox Trial, and `/player` portal docs |
| `docs/FEATURES_REGISTRATION_AND_DISCOVERY.md` | Tournament discovery (GPS), `/register/:slug` 1-click autofill, and organizer approval queue docs |
| `scripts/replay-arcc-dutch.mts` | Replays a real event through Dutch/Swiss engines vs. actual results — validation tool, run with `npx tsx` |

## How to resume

1. Branch: currently `feat/auth-cloud-deploy`, up to date with origin; only uncommitted change is `.cursor/mcp.json` (added Sentry MCP entry) plus the untracked `scripts/replay-arcc-dutch.mts` + its two JSON fixtures/output
2. Local: set web `.env` anon keys; API `.env` with URL + secret + anon (+ `SENTRY_DSN` if testing error reporting)
3. Deploy: follow `deploy/DOKPLOY.md`
4. Enable Google/GitHub in Supabase dashboard before OAuth works
5. `pnpm --filter @chess-alokas/pairing-engine test` before touching pairing/standings/tiebreak logic — it's the most safety-critical package
