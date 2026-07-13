# Chess Alokas Desktop (Electron)

Production Electron shell for Chess Alokas. Reuses the **same** React UI (`apps/web`) and Fastify API (`apps/api`) as the browser app. Dexie remains the offline source of truth; the desktop main process starts a **local API sidecar** so Sync and digital certificates work without a separate terminal.

## Architecture

```
┌─────────────────────────────────────────────┐
│ Electron main                               │
│  • starts Fastify on 127.0.0.1:<free-port> │
│  • loads renderer (Vite / web dist)         │
│  • preload exposes window.desktop           │
└───────────────┬─────────────────────────────┘
                │
     ┌──────────▼──────────┐     ┌──────────────────┐
     │ React UI (apps/web) │────▶│ Dexie IndexedDB  │
     │ HashRouter in desktop│     │ (offline truth)  │
     └──────────┬──────────┘     └──────────────────┘
                │ fetch
     ┌──────────▼──────────┐     ┌──────────────────┐
     │ Fastify sidecar     │────▶│ Supabase         │
     │ (apps/api)          │     │ Postgres+Storage │
     └─────────────────────┘     └──────────────────┘
```

### Why not a separate Electron frontend branch?

Long-lived “electron UI” vs “web UI” branches diverge. Keep **one** React app; Electron only adds a shell + sidecar. Feature work lands on short-lived branches (e.g. `feat/electron-desktop`) then merges to `main`.

## Dev

Prerequisites: Node 20+, pnpm, from repo root.

```bash
pnpm install

# Terminal A — Vite UI (required in Electron DEV mode)
pnpm --filter @chess-alokas/web dev

# Terminal B — Electron (spawns its own API sidecar)
pnpm --filter @chess-alokas/desktop dev
```

Electron DEV loads `http://localhost:5173` and injects the sidecar `apiBaseUrl` via preload.

### API config (userData)

On first launch the app creates:

`%APPDATA%\Chess Alokas\api.env` (Windows)

In development this is seeded from `apps/api/.env` if present, otherwise from `apps/desktop/resources/api.env.example`.

Edit that file for:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Sync to Supabase Postgres |
| `SUPABASE_URL` + `SUPABASE_SECRET_KEY` | Certificate PDF Storage |
| `RESEND_*` | Optional certificate email |

Certificates without Supabase keys go to `%APPDATA%\Chess Alokas\certificates\`.

## Production build (Windows)

```bash
# From repo root — builds web (relative base), API esbuild bundle, then electron-builder
pnpm run build:desktop
```

Artifacts: `apps/desktop/release/` (NSIS installer + portable).

Packaged layout under `resources/`:

- `web/` — Vite build (`base: './'`)
- `api/` — single-file Fastify bundle
- `api.env.example` — first-run template

## Security

- `contextIsolation: true`, `nodeIntegration: false`
- Sidecar binds `127.0.0.1` only
- Secret keys stay in the API process / `api.env`, never in the renderer

## Scripts

| Script | Where | Action |
|--------|-------|--------|
| `pnpm --filter @chess-alokas/desktop dev` | desktop | Compile main + launch Electron |
| `pnpm --filter @chess-alokas/desktop dist` | desktop | electron-builder (expects web+api bundles) |
| `pnpm --filter @chess-alokas/api build:desktop` | api | esbuild bundle → `apps/api/desktop-bundle` |
| `pnpm run build:desktop` | root | Full Windows package pipeline |

## Related docs

- Root [README.md](../../README.md) — monorepo overview
- [docs/AGENT_HANDOFF.md](../../docs/AGENT_HANDOFF.md) — agent working memory / resume here
