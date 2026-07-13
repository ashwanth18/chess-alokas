# Chess Alokas

Cloud-capable chess tournament pairing system with offline-first React UI (PWA + **Electron desktop**), Fastify API, FIDE Swiss pairing engine, and digital certificates.

> **Agents / future you:** start at [`docs/AGENT_HANDOFF.md`](docs/AGENT_HANDOFF.md) for working memory (architecture, gaps, how to resume).

## Features

- **Configurable categories** — Under 12, Under 18, Female/Male, or any custom filter on age/gender/rating
- **FIDE Swiss pairing** — score groups, rematch avoidance, color balance, byes
- **Tournament styles** — Swiss implemented; Round Robin selectable as “coming soon”
- **CSV / Excel import** — map columns, auto-assign categories
- **Offline-first** — Dexie (IndexedDB) local store; **Sync online** push/pull (last-write-wins)
- **Certificates** — PDF designer, print pack, Issue digital → Supabase Storage (or local disk)
- **Desktop app** — Electron shell with local Fastify sidecar (same UI + API as web)
- **Simulator** — generate players, auto-play rounds, visualize boards/standings/diagnostics

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

- Node.js 20+
- [pnpm](https://pnpm.io) 9+
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
| GET | `/certificates/:issueId/download` | Download issued PDF |

## Typical flow

1. Open web or desktop → **New Tournament** → add categories
2. Import CSV or register players
3. Generate round pairings, enter results, view standings
4. **Sync** when connected to push/pull cloud state
5. **Certificates** → template → Issue digital (optional email)
6. Use **Simulator** to stress-test Swiss logic

## License

Private — Chess Alokas
