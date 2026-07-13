# Agent working memory — Chess Alokas

**Read this first** when context is full or starting a new session on this repo.

Last updated: 2026-07-13 (Electron desktop shell added — Windows installer builds)

## What this product is

Offline-first chess tournament manager:

- **UI:** React + Dexie (`apps/web`) — works in browser (PWA) and Electron renderer
- **API:** Fastify (`apps/api`) — sync, import helpers, digital certificates
- **Engine:** `@chess-alokas/pairing-engine` — FIDE Swiss client-side
- **Cloud:** Supabase Postgres (sync) + Storage bucket `certificates` (PDFs)
- **Desktop:** Electron (`apps/desktop`) — spawns local API sidecar on `127.0.0.1`

## Status (what works)

- [x] `apps/desktop` main/preload/sidecar + electron-builder (Windows Setup + Portable)
- [x] Packaged app starts Fastify from `resources/api` via `ELECTRON_RUN_AS_NODE`
- [x] Renderer uses `HashRouter` + `window.desktop.getApiBaseUrl()`
- [x] Desktop auto-sync once when sidecar healthy
- [x] Docs: root README, `apps/desktop/README.md`, this handoff file
- [x] `pnpm run build:desktop` pipeline

## Smoke note

Unpacked `Chess Alokas.exe` started sidecar, `/health` 200, sync pull ran. userData: `%APPDATA%\Chess Alokas\`.

## Monorepo map

| Path | Role |
|------|------|
| `apps/web` | Shared React UI |
| `apps/api` | Fastify API |
| `apps/desktop` | Electron main/preload/builder |
| `packages/shared` | Types + Zod |
| `packages/pairing-engine` | Swiss + simulator |
| `packages/certificates` | PDF stamp / pack / light compress |
| `supabase/migrations` | SQL schema |

## Data flow (offline / online)

1. All tournament CRUD happens in **Dexie** (`dirty: 1`).
2. **Sync** (manual on web; auto-once on desktop when API up) → `POST /sync/push` then `GET /sync/pull` (LWW by `updatedAt`).
3. Pairing/standings run **in the browser/renderer**, not on the server.
4. **Issue digital** stamps PDFs client-side, POSTs base64 to API → Storage or `CERTIFICATES_DIR`.

## Electron specifics

- Branching: **no** long-lived electron-vs-web UI forks; use feature branches then merge `main`.
- Router: `HashRouter` when `window.desktop` is present.
- API URL: `window.desktop.getApiBaseUrl()` (sidecar free port), not hard-coded 3001.
- Config: `%APPDATA%\Chess Alokas\api.env`
- Package: `pnpm run build:desktop` → `apps/desktop/release/`
- Artifacts: `Chess Alokas-Setup-0.1.0-win-x64.exe`, `Chess Alokas-Portable-0.1.0-win-x64.exe`

## Certificates notes

- Bucket `certificates`, private, **10 MB/file**, PDF only.
- Compression is light (`useObjectStreams`); large template images stay large.
- Soft size target ~900 KB (`DIGITAL_TARGET_BYTES`) — not enforced as a hard fail.
- Layout templates in Dexie are **not** synced to the server yet.

## Env (API)

See `apps/api/.env.example` and `apps/desktop/resources/api.env.example`.

Critical: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`).

## Known gaps / follow-ups

- [ ] Certificate templates not in sync push/pull
- [ ] Auto-update channel for Electron
- [ ] macOS/Linux signed builds
- [ ] Custom app icon (electron-builder currently uses default)
- [ ] PWA icons still empty in vite manifest

## How to resume work

1. `git status` / current branch (prefer short-lived `feat/*` off `main`)
2. `pnpm install && pnpm --filter @chess-alokas/api --filter @chess-alokas/web dev` for web
3. Desktop: Vite + `pnpm --filter @chess-alokas/desktop dev`
4. Prefer editing shared `apps/web` unless the change is main-process only

## Milestone push policy

Push `feat/*` to `origin` after major milestones (scaffold, sidecar, installer, docs). Do not force-push `main`.
