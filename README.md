# Chess Alokas

Cloud-capable chess tournament pairing system with offline-first React PWA, Fastify API, and a FIDE Swiss pairing engine.

## Features

- **Configurable categories** — Under 12, Under 18, Female/Male, or any custom filter on age/gender/rating
- **FIDE Swiss pairing** — score groups, rematch avoidance, color balance, byes
- **Tournament styles** — Swiss implemented; Round Robin selectable as “coming soon”
- **CSV / Excel import** — map columns, auto-assign categories
- **Offline-first PWA** — Dexie (IndexedDB) local store; **Sync online** push/pull (last-write-wins)
- **Simulator** — generate players, auto-play rounds, visualize boards/standings/diagnostics

## Monorepo

| Path | Package | Role |
|------|---------|------|
| `apps/api` | `@chess-alokas/api` | Fastify API, import, pairing, sync |
| `apps/web` | `@chess-alokas/web` | React PWA UI |
| `packages/pairing-engine` | `@chess-alokas/pairing-engine` | Swiss engine + simulator |
| `packages/shared` | `@chess-alokas/shared` | Types, Zod schemas, category filters |
| `supabase/migrations` | — | Postgres schema |

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) 9+
- Optional: [Supabase](https://supabase.com) project for cloud Postgres

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
2. Run `supabase/migrations/001_initial.sql` in the SQL editor
3. Set `DATABASE_URL` in `apps/api/.env` to your Postgres connection string

### Web

```bash
# apps/web/.env
VITE_API_URL=http://localhost:3001
```

## Develop

```bash
# both API (3001) and web (5173)
pnpm dev

# or separately
pnpm --filter @chess-alokas/api dev
pnpm --filter @chess-alokas/web dev
```

## Test

```bash
pnpm --filter @chess-alokas/pairing-engine test
```

## API overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health + store mode |
| GET/POST | `/tournaments` | List / create |
| GET/PATCH/DELETE | `/tournaments/:id` | Detail / update / soft-delete |
| POST | `/tournaments/:id/categories` | Add category |
| POST | `/tournaments/:id/import` | Multipart CSV/XLSX import |
| POST | `/tournaments/:id/rounds/:n/pair` | Generate pairings |
| PATCH | `/games/:id/result` | Set result |
| GET | `/tournaments/:id/standings` | Standings |
| GET/POST | `/sync` | Pull / push LWW sync |

## Typical flow

1. Open the web app → **New Tournament** → add Under 12 / Under 18 categories
2. Import a CSV with `name` and `age` columns
3. Generate round pairings per category, enter results, view standings
4. Click **Sync online** when connected to push/pull cloud state
5. Use **Simulator** to stress-test Swiss logic without a real event

## License

Private — Chess Alokas
