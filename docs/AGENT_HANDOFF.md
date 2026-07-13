# Agent working memory — Chess Alokas

**Read this first** when context is full or starting a new session on this repo.

Last updated: 2026-07-13 (Auth + Account/Settings + Dokploy deploy assets)

## What this product is

Offline-first chess tournament manager with **per-manager accounts**:

- **UI:** React + Dexie (`apps/web`) — browser + Electron renderer
- **API:** Fastify (`apps/api`) — JWT-gated sync, certs, tournaments
- **Auth:** Supabase Auth — email/password, OTP/magic link, Google, GitHub
- **Cloud host:** `https://chess-manager.alokas.com` (Dokploy on Hostinger VPS)
- **Desktop:** Electron; packaged builds call cloud API (no user secrets)

## Status

- [x] `owner_id` + `profiles` + RLS (`005_auth_owners.sql`)
- [x] Fastify `requireAuth` + owner-scoped sync/tournaments/certs
- [x] Login / signup / OTP / OAuth / Account / Settings UI
- [x] `deploy/` Docker + `DOKPLOY.md`
- [x] Desktop defaults to `https://chess-manager.alokas.com/api` when packaged
- [ ] You: configure DNS + Dokploy + Supabase Auth providers (see `deploy/DOKPLOY.md`)

## Auth model

- Client: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` only
- Server: `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_ANON_KEY` (JWT verify)
- `tournaments.owner_id = auth.users.id`
- Local demo: `AUTH_DISABLED=1` skips JWT (not for production)

## Key paths

| Path | Role |
|------|------|
| `apps/web/src/auth/` | AuthProvider |
| `apps/web/src/pages/LoginPage.tsx` | Password / OTP / OAuth |
| `apps/web/src/pages/AccountPage.tsx` | Profile, security, identities, delete |
| `apps/api/src/auth.ts` | JWT + `/me` |
| `deploy/DOKPLOY.md` | VPS deploy checklist |

## How to resume

1. Branch: prefer `feat/auth-cloud-deploy` then merge `main`
2. Local: set web `.env` anon keys; API `.env` with URL + secret + anon
3. Deploy: follow `deploy/DOKPLOY.md`
4. Enable Google/GitHub in Supabase dashboard before OAuth works
