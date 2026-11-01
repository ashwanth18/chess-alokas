# Chess Alokas Desktop (Electron)

Production Electron shell for Chess Alokas. It reuses the **same** React UI (`apps/web`). Dexie (IndexedDB) is the offline source of truth. Packaged builds talk to the cloud API at `https://chess-manager.alokas.com/api` and carry no secrets. A local API sidecar exists for development only.

## Architecture

```
┌──────────────────────────────────────────────┐
│ Electron main                                │
│  • loads web/index.html from file://         │
│  • applies CSP and limits file:// access     │
│  • runs bbpPairings for FIDE Dutch (IPC)     │
│  • stores backup snapshots, handles updates  │
└───────────────┬──────────────────────────────┘
                │ sandboxed preload: window.desktop
     ┌──────────▼──────────┐     ┌──────────────────┐
     │ React UI (apps/web) │────▶│ Dexie IndexedDB  │
     │ HashRouter          │     │ (offline truth)  │
     └──────────┬──────────┘     └──────────────────┘
                │ fetch (Sync, certificates, auth)
     ┌──────────▼──────────┐     ┌──────────────────┐
     │ Cloud API + Supabase│────▶│ Postgres+Storage │
     └─────────────────────┘     └──────────────────┘
```

### Why not a separate Electron frontend branch?

Long-lived “electron UI” vs “web UI” branches diverge. Keep **one** React app; Electron only adds a shell. Feature work lands on short-lived branches then merges to `main`.

## Dev

Prerequisites: Node 22+ (see repo `.nvmrc`), pnpm 11, from repo root.

```bash
pnpm install

# Terminal A: Vite UI (required in Electron DEV mode)
pnpm --filter @chess-alokas/web dev

# Terminal B: Electron (spawns its own API sidecar)
pnpm --filter @chess-alokas/desktop dev
```

Electron DEV loads `http://localhost:5173` and injects the sidecar `apiBaseUrl` via preload.

`CHESS_ALOKAS_API_URL`, `DESKTOP_LOCAL_API=1` and `BBP_PAIRINGS_PATH` work only in unpackaged runs. Packaged builds ignore them.

### Sidecar config (development only)

On first dev launch the app creates `%APPDATA%\Chess Alokas\api.env`, seeded from `apps/api/.env` if present, otherwise from `apps/desktop/resources/api.env.example`.

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Sync to Supabase Postgres |
| `SUPABASE_URL` + `SUPABASE_SECRET_KEY` | Certificate PDF Storage |
| `RESEND_*` | Optional certificate email |

## Production build

```bash
# From repo root: web (relative base), API bundle, then electron-builder with --publish never
pnpm run build:desktop
```

The API bundle step is only used by the Docker API image; it is not packaged into the desktop app.

Local artifacts land in `apps/desktop/release/`:

| Platform | Artifact |
|----------|----------|
| Windows | `Chess-Alokas-Setup-win-x64.exe`, `Chess-Alokas-Portable-win-x64.exe` |
| Linux | `Chess-Alokas-linux-x86_64.AppImage` |
| macOS | `Chess-Alokas-mac-x64.dmg`, `Chess-Alokas-mac-arm64.dmg` (unsigned) |

Windows is the main target. macOS builds are unsigned and have no local FIDE Dutch engine (bbpPairings has no Mac binary), so Dutch pairing there needs the cloud API.

Packaged layout under `resources/`:

- `app.asar`: main process and sandboxed preload
- `web/`: Vite build (`base: './'`)
- `bbp-pairings/`: bbpPairings v6 (not on macOS)

### App icon

No icon is configured yet, so the default Electron icon ships. The only assets in `apps/web/public` show a letter “U”, which does not fit the name. Add a 512x512 or larger `resources/icon.png` and electron-builder picks it up.

## Releases (CI)

See the full checklist in [`deploy/PIPELINE.md`](../../deploy/PIPELINE.md) §2.

Bump `apps/desktop/package.json` `version`, then push a matching tag:

```bash
git tag v0.1.56
git push origin v0.1.56
```

Workflow: `.github/workflows/desktop-release.yml`. It stops if the tag differs from the version or if tests fail, builds Windows, Linux and macOS, and only then creates a draft release, uploads everything and publishes it. Clients never see a release without its update feed.

## Updates

The app checks GitHub Releases on startup and from Settings, but it downloads and installs only when someone clicks:

- **Windows installer and Linux AppImage**: Download, then Restart & update, through `electron-updater`. Nothing installs on quit.
- **Portable, macOS, or if the update feed fails**: the Download button opens the release page in the browser. The app never runs an installer it fetched itself.
- **While a tournament is in progress**: both steps first warn and default to “Not now”.

Downgrades are refused. A new version cannot be rolled back, so publish a higher version to fix a bad release.

## Local backups

Tournament data lives in `%APPDATA%\Chess Alokas\Partitions\chess-alokas\IndexedDB`.

- **Automatic**: a JSON snapshot of the whole local database each time a round changes, in `%APPDATA%\Chess Alokas\backups`. The newest 20 are kept.
- **Manual**: the **Backups** link on the tournament list saves a snapshot, exports to a chosen file, and restores from a snapshot or a file. Restoring saves a copy of the current data first.
- **If the database cannot open**: the recovery screen offers the same restore. It deletes the broken store and rebuilds it from the backup.

Backups contain player names and contact details, are not encrypted, and rely on the Windows user folder permissions. Treat an exported file as personal data. After a restore, Sync may bring back newer changes from the cloud.

## Sign-in

Sign-in is by email only: password, or the emailed 6-digit code. Password reset opens in the browser, because a link in an email can't hand the session back to the app.

If the saved token has expired and the auth server cannot be reached, the app stays signed in for local work with no token, so cloud calls are refused until a refresh succeeds. Only a rejection from the auth server, or signing out, ends the session.

## Security

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- CSP on every page response; inline code is allowed by hash only
- Only the exact `index.html` is navigable, and `file://` requests outside `resources/web` return 404
- Every IPC call checks that the sender is the app's top-level page; arguments are validated in `src/policy.ts`
- Fuses: RunAsNode, `NODE_OPTIONS` and inspect arguments off; asar integrity and only-load-from-asar on
- Error reports (renderer and main) carry an opaque user id only, with paths, emails, tokens and public-link secrets scrubbed. Native crash dumps are not collected because they contain process memory.
- **Not code signed yet.** See below.

## Code signing

Windows installers are unsigned today. SmartScreen warns on first install, and updates are checked by SHA-512 from the same GitHub release, not by publisher. Anyone who can write to that release can ship code to every organizer. Fixing that needs a certificate, which is a purchase.

When one exists:

1. Buy an OV or EV code signing certificate, or set up Azure Trusted Signing.
2. Add repo secrets `CSC_LINK` (base64 certificate) and `CSC_KEY_PASSWORD`. For EV or Azure, follow the electron-builder guide for that signer instead.
3. In `electron-builder.yml`, delete `signExecutable: false` and add `signtoolOptions.publisherName`, using the exact certificate subject CN. electron-updater then refuses updates not signed by that publisher.
4. In `.github/workflows/desktop-release.yml`, remove the two `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` lines and pass `CSC_LINK` and `CSC_KEY_PASSWORD` to the Windows build step.
5. In `package.json`, remove `CSC_IDENTITY_AUTO_DISCOVERY=false` from the `dist` script.
6. Release one signed version. Unsigned installs update to it normally, because they have no publisher to check against. Signed installs then accept only signed updates.

## Scripts

| Script | Where | Action |
|--------|-------|--------|
| `pnpm --filter @chess-alokas/desktop dev` | desktop | Compile main + launch Electron |
| `pnpm --filter @chess-alokas/desktop test` | desktop | Policy unit tests |
| `pnpm --filter @chess-alokas/desktop dist` | desktop | electron-builder, `--publish never` (expects the web bundle) |
| `pnpm --filter @chess-alokas/api build:desktop` | api | esbuild bundle → `apps/api/desktop-bundle` (Docker API image) |
| `pnpm run build:desktop` | root | Full package pipeline for the current OS |

## Related docs

- Root [README.md](../../README.md): monorepo overview
- [docs/AGENT_HANDOFF.md](../../docs/AGENT_HANDOFF.md): agent working memory / resume here
