# Agent working memory — Chess Alokas

**Read this first** when context is full or starting a new session on this repo.

Last updated: 2026-11-01 (email-only sign-in and staff invites added; migrations `028`, `029`, `030` written, NOT applied to production)

## What this product is

Offline-first chess tournament manager with **per-manager accounts**:

- **UI:** React + Dexie (`apps/web`) — browser + Electron renderer
- **API:** Fastify (`apps/api`) — JWT-gated sync, certs, tournaments, floor scoring, public live/analytics
- **Pairing:** in-house Swiss engine, plus a Dutch-system engine wrapping FIDE-approved `bbpPairings` v6 (`packages/pairing-engine/src/dutch/`)
- **Auth:** Supabase Auth — email only: password, and OTP/magic link. No Google or GitHub, by founder decision
- **Cloud host:** `https://chess-manager.alokas.com` (Dokploy on Hostinger VPS)
- **Desktop:** Electron (see `apps/desktop/package.json` for the version); packaged builds call cloud API (no user secrets); auto-updates in-app; Sentry error monitoring wired for web/API/desktop

## Status

- [x] `owner_id` + `profiles` + RLS (`005_auth_owners.sql`)
- [x] Fastify `requireAuth` + owner-scoped sync/tournaments/certs
- [x] Login / signup / OTP / Account / Settings UI
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
- [x] **Chess Alokas 2.0 Phase 3**: Floor Arbiter Zone Grid (`GET /public/tables/:slug/zone`), Call Chief Arbiter alerts (`027_floor_alerts_and_checkin.sql`, `POST /public/tables/:slug/call-chief`, `/tournaments/:id/floor/alerts`), Offline Floor Result Queue (`alokas-floor-offline-queue`), Morning Roll Call check-in on `Players` tab, and Live Venue TV / Projector Mode (`/live/:token/tv`, `LiveTvPage.tsx`)
- [x] **Chess Alokas 2.0 Phase 4**: Flutter Participant & Family Mobile App (`apps/mobile`) with 4 tabs (`Discover`, `Matchday`, `Career & Certs`, `Family & Auth`), Haversine GPS nearby events, 1-Tap family registration with auto-category matching, Morning Check-In QR Pass modal, Next Match board card, Rating Progression chart, and Digital Certificate Vault (`apps/mobile/README.md`)

- [x] **Audit hardening (2026-11-01)**: client writes locked to the API (`028`), trial limits for accounts with no org, org membership checks on create/sync, confirmed-email plus name claiming, private receipt storage, sync rejections reported to clients, server-side sync cursor (`029`), real offline PWA (`apps/web/src/sw.ts`), desktop sandbox/fuses/backups (Electron 45), honest Flutter app with no seed data. `apps/api/src/storeContract.test.ts` runs rules against MemoryStore and real PostgresStore on PGlite; `migrations.test.ts` applies the whole migration chain

- [x] **Team (`030`)**: invites, members, roles, last-owner protection, `/team`, `/invite/:token`. Rules and the role table are in `docs/FEATURES_ORGANIZATIONS_AND_PLAYERS.md` section 4b

## Not done / known gaps

- **`sample-registrations-*.csv` and `scripts/arcc-*.json` are in a PUBLIC repo** and may hold real minors' data. Founder must confirm; see the founder's decision before pushing anything
- Do not push until that's resolved: `deploy/SUPABASE_MIGRATION.md` also names VPS details
- Team invites have run only against MemoryStore, PGlite and a local browser with auth disabled. Web create-tournament has no organization picker for someone in two organizations
- Production runs the August build. Deploy order: apply `028`, `029`, `030` first (after a backup); count null-owner tournaments; confirm `SUPABASE_URL` and key are set or the API refuses to start; check `certificates` bucket is private; set `TRUST_PROXY_HOPS` if the proxy chain isn't Traefik + nginx
- Never tested against real Supabase: sign-in, token refresh, RLS under PostgREST, Storage, real email. Custom SMTP is required before launch, and Confirm email must stay on because invites trust it (`deploy/DOKPLOY.md` section 4)
- No billing code; Windows installer unsigned; no icon; no privacy policy, terms or parental consent
- Design overhaul is planned, not started: `docs/design/DESIGN_PLAN.md`, mockups in `docs/design/mockups/`
- Flutter: `apps/mobile/README.md` lists what's real. Pairing `--dart-define`s: API_BASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY

## Auth model

- Client: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` only
- Server: `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_ANON_KEY` (JWT verify), `SENTRY_DSN` (optional)
- `tournaments.owner_id = auth.users.id`
- Local demo: `AUTH_DISABLED=1` skips JWT (not for production)

## Key paths

| Path | Role |
|------|------|
| `apps/web/src/auth/` | AuthProvider |
| `apps/web/src/pages/LoginPage.tsx` | Password / OTP |
| `apps/web/src/pages/team/` | `/team` (members, invites, arbiter floor panel) and public `/invite/:token` |
| `apps/web/src/auth/returnTo.ts` | Safe return path through sign-in, sign-up and email confirmation |
| `apps/web/src/pages/AccountPage.tsx` | Profile, security, identities, delete |
| `apps/web/src/pages/TableScoringPage.tsx` | Floor arbiter PIN/QR result entry, Zone Grid view, Call Chief Arbiter & offline queue |
| `apps/web/src/pages/LivePage.tsx` | Public live pairings/standings viewer |
| `apps/web/src/pages/LiveTvPage.tsx` | 1080p/4K Venue TV & Projector display (`/live/:token/tv`) with countdown clock & auto-paging |
| `apps/web/src/pages/AdminPage.tsx` | Platform admin dashboard + B2B organization approvals |
| `apps/web/src/pages/PlayerPortalPage.tsx` | Participant & Family Portal (`/player`): live matchday card, career stats, certificate vault |
| `apps/web/src/pages/DiscoverEventsPage.tsx` | Public tournament discovery (`/discover`) with Haversine GPS nearby search |
| `apps/web/src/pages/EventRegistrationPage.tsx` | Shareable tournament registration form (`/register/:slug`) with 1-click profile autofill & receipt upload |
| `apps/web/src/pages/CertificatesPage.tsx` | Certificate template designer / issue |
| `apps/api/src/auth.ts` | JWT + `/me` |
| `apps/api/src/routes/organizations.ts` | B2B organization CRUD, Sandbox Trial, and admin approvals |
| `apps/api/src/routes/team.ts` | Members, roles and invites |
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
| `docs/FEATURES_ARBITER_AND_VENUE_TV.md` | Floor Arbiter Zone Grid, Chief Arbiter alerts, Offline queue, Roll Call check-in & Venue TV mode docs |
| `apps/mobile/` | Flutter Participant & Family Mobile App (`lib/main.dart`, `lib/screens/*`, `lib/services/alokas_api.dart`, `test/widget_test.dart`, `README.md`) |
| `scripts/replay-arcc-dutch.mts` | Replays a real event through Dutch/Swiss engines vs. actual results — validation tool, run with `npx tsx` |

## How to resume

1. Branch: `feat/auth-cloud-deploy`, ahead of origin by unpushed local commits; `.cursor/mcp.json` has a local uncommitted Sentry entry. Check `git status` rather than trusting this line
2. Local: set web `.env` anon keys; API `.env` with URL + secret + anon (+ `SENTRY_DSN` if testing error reporting)
3. Deploy: follow `deploy/DOKPLOY.md`
4. Set up custom SMTP in Supabase before real users sign up: `deploy/DOKPLOY.md` section 4
5. `pnpm --filter @chess-alokas/pairing-engine test` before touching pairing/standings/tiebreak logic — it's the most safety-critical package
