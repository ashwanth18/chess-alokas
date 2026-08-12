# Deployment pipeline

How Chess Alokas ships to **production web**, **cloud API**, and **desktop installers**. Use this as the operational checklist; Dokploy one-time setup lives in [`DOKPLOY.md`](./DOKPLOY.md).

## Overview

| Surface | Trigger | What runs | Result |
|---------|---------|-----------|--------|
| Web + API | Push to the branch Dokploy watches | Docker Compose rebuild (`deploy/docker-compose.yml`) | `https://chess-manager.alokas.com` |
| Desktop | Git tag `v*` (e.g. `v0.1.9`) | `.github/workflows/desktop-release.yml` | [GitHub Release](https://github.com/ashwanth18/chess-alokas/releases) installers + `latest*.yml` |
| Supabase schema | Manual | Apply SQL in `supabase/migrations/` | Postgres / RLS / Storage |

**Agent shortcut:** typing **`@deploy`** in Cursor runs this full ship flow (see `.cursor/rules/deploy.mdc`).

There is **no** GitHub Action for web/API. Desktop is the only automated CI release path.

```
feat/* ──push──▶ Dokploy branch (often feat/auth-cloud-deploy until merged)
                    │
                    ▼
              Docker Compose
           ┌────────┴────────┐
           │ web (nginx:80)  │◀── Traefik / HTTPS
           │ api (:3001)     │◀── /api/ via nginx
           └────────┬────────┘
                    │
                    ▼
              Supabase (Postgres + Auth + Storage)

Desktop: bump apps/desktop/package.json → tag vX.Y.Z → Actions matrix
         → GitHub Release → electron-updater / landing downloads
```

---

## 1. Web + API (Dokploy)

### When it deploys

Dokploy rebuilds when you **push** to the Git branch configured in the Dokploy app settings.

- Production URL: `https://chess-manager.alokas.com`
- Compose file: `deploy/docker-compose.yml`
- Services: `web` (Vite SPA + nginx) and `api` (esbuild Fastify bundle)

Confirm the watched branch in the Dokploy UI (historically `feat/auth-cloud-deploy`; prefer `main` once features are merged).

### Ship a web change

1. Land the change on the Dokploy-watched branch (commit + push).
2. Wait for Dokploy build/deploy to finish.
3. Verify:

```bash
curl https://chess-manager.alokas.com/api/health
# expect: ok, postgres mode, auth enabled
```

4. Smoke-test in the browser: sign-in, open a tournament, Sync.

### Env vars (Dokploy UI — never commit)

See [`DOKPLOY.md`](./DOKPLOY.md) §3. Required:

| Variable | Used by |
|----------|---------|
| `DATABASE_URL` | api |
| `SUPABASE_URL` | api + web **build args** |
| `SUPABASE_SECRET_KEY` | api |
| `SUPABASE_ANON_KEY` | api + web **build args** |
| `RESEND_API_KEY` / `RESEND_FROM` | api (optional email) |
| `VITE_SENTRY_DSN` | web **build args** (client errors; free Developer plan) |
| `SENTRY_DSN` | api (server 500s) |
| `VITE_SENTRY_ORG_URL` | web build (Admin → Issues link) |
| `VITE_APP_VERSION` | web build (optional release tag) |
| `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` | web build only (optional source maps) |

**Sentry free-tier policy:** errors + light tracing (`tracesSampleRate` 0.1 in prod). Do **not** enable Session Replay, profiling, or Seer. SDK no-ops when DSN is unset.

If Admin shows **Client SDK: not configured**, set `VITE_SENTRY_DSN` (+ optional `VITE_SENTRY_ORG_URL`) and **rebuild the web image**. Also set `SENTRY_DSN` on the API service for server 500s.

Web Vite env is baked at **image build** time (`VITE_*` from compose). Changing Supabase anon URL/key or Sentry DSN requires a **rebuild**, not only a container restart.

**FIDE list:** after deploy, open Admin → **Refresh FIDE list** once (monthly XML import). Lookup on the Players tab needs a non-empty `fide_players` table.

### Local parity

```bash
pnpm --filter @chess-alokas/web run build
pnpm --filter @chess-alokas/api run build:desktop
```

Docker images use the same scripts (`deploy/Dockerfile.web`, `deploy/Dockerfile.api`).

---

## 2. Desktop (GitHub Actions + Releases)

### Version source of truth

Only **`apps/desktop/package.json` → `version`** matters for installers and auto-update. Web/API package versions stay independent.

Tag must match: version `0.1.8` → tag `v0.1.8`.

### Ship a desktop release

```bash
# 1. Ensure release commits are on the branch you want tagged (usually main or current deploy branch)
# 2. Bump version in apps/desktop/package.json (e.g. 0.1.7 → 0.1.8)

git add apps/desktop/package.json
git commit -m "Bump desktop to 0.1.8."
git push origin HEAD

# 3. Tag and push the tag (this starts CI)
git tag v0.1.8
git push origin v0.1.8
```

### What CI does

Workflow: [`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml)

| Step | Detail |
|------|--------|
| Trigger | `push` tags matching `v*`, or manual `workflow_dispatch` |
| Matrix | Windows, Linux, macOS |
| Build | `pnpm run build:desktop` (web `--mode desktop` + API bundle + electron-builder) |
| Auth env | Baked from committed `apps/web/.env.desktop` — **do not** set empty `VITE_SUPABASE_*` secrets in the workflow |
| On tag | Uploads installers + `latest*.yml` + `*.blockmap` to a GitHub Release |
| Manual run | Uploads Actions artifacts only (no Release) |

### Artifacts

| Platform | Files |
|----------|--------|
| Windows | `Chess-Alokas-Setup-win-x64.exe`, `Chess-Alokas-Portable-win-x64.exe` |
| Linux | `Chess-Alokas-linux-x64.AppImage` |
| macOS | `Chess-Alokas-mac-x64.dmg`, `Chess-Alokas-mac-arm64.dmg` (unsigned) |

Also published: `latest.yml` / `latest-*.yml` and blockmaps for `electron-updater`.

### How users get updates

| Build | Update path |
|-------|-------------|
| Windows **NSIS installer** | In-app check → download → silent install/restart (`electron-updater`) |
| Windows portable / unsigned macOS | Opens [releases/latest](https://github.com/ashwanth18/chess-alokas/releases/latest) |
| Landing page `/` | Fetches GitHub `releases/latest` for download links |

Packaged desktop talks to **cloud** API (`https://chess-manager.alokas.com/api`) by default. Local API sidecar is for `pnpm --filter @chess-alokas/desktop dev` (or `DESKTOP_LOCAL_API=1`).

### Local desktop build (optional)

```bash
pnpm run build:desktop
# artifacts → apps/desktop/release/
```

More detail: [`apps/desktop/README.md`](../apps/desktop/README.md).

---

## 3. Supabase migrations

Migrations are **not** applied by Dokploy or GitHub Actions. Apply them manually before or with the deploy that depends on them.

1. Open files in order under `supabase/migrations/` (e.g. `006_…`, `007_…`).
2. Run via Supabase SQL editor, CLI, or MCP against the **production** project.
3. Never skip numbers; treat already-applied files as done (do not re-run destructive edits).

Auth / SMTP / redirect URL checklist: [`DOKPLOY.md`](./DOKPLOY.md) §4.

---

## 4. Typical “full ship” checklist

Use when a feature needs web **and** desktop:

1. **Schema** — apply any new `supabase/migrations/*.sql` on production.
2. **Web/API** — push to Dokploy branch → wait for deploy → `curl …/api/health`.
3. **Desktop** — bump `apps/desktop/package.json` → commit → `git tag vX.Y.Z` → `git push origin vX.Y.Z`.
4. **Watch** GitHub Actions until all three OS jobs succeed and the Release has assets.
5. **Smoke** — web in browser; installed Windows app update (or fresh installer from the Release).

---

## 5. Related docs

| Doc | Purpose |
|-----|---------|
| [`DOKPLOY.md`](./DOKPLOY.md) | One-time VPS / DNS / env / Auth setup |
| [`apps/desktop/README.md`](../apps/desktop/README.md) | Electron architecture & local builds |
| [`docs/AGENT_HANDOFF.md`](../docs/AGENT_HANDOFF.md) | Agent working memory |
| Root [`README.md`](../README.md) | Product overview & local setup |
