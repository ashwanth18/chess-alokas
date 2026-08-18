# Agent working memory — Chess Alokas

**Read this first** when context is full or starting a new session on this repo.

Last updated: 2026-08-18 (Dutch/bbpPairings, floor arbiter scoring, public live, cards, tiebreaks, admin/Sentry — desktop v0.1.53)

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
- [ ] `scripts/replay-arcc-dutch.mts` — uncommitted validation tool replaying a real event through Dutch/bbp vs. actual results; runs clean via `npx tsx`, not yet committed

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
| `apps/web/src/pages/AdminPage.tsx` | Platform admin dashboard |
| `apps/web/src/pages/CertificatesPage.tsx` | Certificate template designer / issue |
| `apps/api/src/auth.ts` | JWT + `/me` |
| `apps/api/src/floor/` | PIN/QR floor scoring backend |
| `apps/api/src/routes/publicLive.ts`, `publicAnalytics.ts`, `publicTables.ts` | Unauthenticated public endpoints |
| `apps/api/src/lib/gameCards.ts` | Yellow/red card + auto-loss logic |
| `apps/api/src/fide/` | FIDE rating lookup (Lichess-backed) |
| `packages/pairing-engine/src/dutch/` | Dutch pairing (bbp.ts wraps `bbpPairings` binary) |
| `packages/pairing-engine/src/standings.ts` | Tiebreak calculations |
| `deploy/DOKPLOY.md` | VPS deploy checklist |
| `scripts/replay-arcc-dutch.mts` | Replays a real event through Dutch/Swiss engines vs. actual results — validation tool, run with `npx tsx` |

## How to resume

1. Branch: currently `feat/auth-cloud-deploy`, up to date with origin; only uncommitted change is `.cursor/mcp.json` (added Sentry MCP entry) plus the untracked `scripts/replay-arcc-dutch.mts` + its two JSON fixtures/output
2. Local: set web `.env` anon keys; API `.env` with URL + secret + anon (+ `SENTRY_DSN` if testing error reporting)
3. Deploy: follow `deploy/DOKPLOY.md`
4. Enable Google/GitHub in Supabase dashboard before OAuth works
5. `pnpm --filter @chess-alokas/pairing-engine test` before touching pairing/standings/tiebreak logic — it's the most safety-critical package
