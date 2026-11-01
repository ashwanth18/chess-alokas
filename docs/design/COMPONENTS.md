# Building on the Pairing Sheet system

For anyone building Floor, Matchday, Hall, Register or the Round Desk. Read `DESIGN_PLAN.md` sections 2 and 3 for the why, and open the page in `mockups/` you are building. This file is the how.

See every component live at `/__ui` (`pnpm --filter @chess-alokas/web dev`, then `http://localhost:5173/__ui`). It doesn't exist in production builds.

## Create a page

1. Pick the surface. It decides what your page may import.

   | Surface | Routes | Parent route element | May use |
   |---|---|---|---|
   | Desk | `/app`, `/tournaments/*`, `/certificates`, `/simulator`, `/account`, `/settings`, `/team`, `/backups`, `/admin` | `OrganizerShell` | Dexie, sync, `useDeskSync()` |
   | Family | `/`, `/login`, `/signup`, `/auth/*`, `/discover`, `/register/:slug`, `/live/:token`, `/live/:token/p/:id`, `/player`, `/invite/:token` | `ParticipantShell` | The API client. **No Dexie, no sync** |
   | Floor | `/t/:slug` | `FloorSurface` | The API client, its own localStorage queue. **No Dexie** |
   | Hall | `/live/:token/tv` | `HallSurface` | Read-only API. **No Dexie** |

   Routes live in `apps/web/src/main.tsx`. URLs never change: `/t/` is printed on stickers and `/live/` and `/register/` are shared in WhatsApp. Keep every new page `lazy()`.

   `e2e/shells.spec.ts` fails if a family, floor or hall route downloads Dexie, pdf or xlsx. `src/auth`, `src/ui`, `src/api` and `src/shells/deskSync.ts` must never import `src/db` or `src/sync` as values, because every route loads them. A heavy library in your page goes behind a dynamic `import()`.

2. Wrap the page in `Surface`. Without it the legacy dark green body shows through.

   ```tsx
   import { Surface } from '../ui/Surface';
   import { Button, PlayerName } from '../ui';

   export default function FloorPage() {
     return (
       <Surface name="floor">
         {/* your page */}
       </Surface>
     );
   }
   ```

   `name` is `desk`, `family`, `floor` or `hall`. It sets `html[data-surface]`, repaints the body and sets density: `floor` and `family` get 44 px controls and 48 px rows. `theme` is optional and forces `light`, `dark`, `sun` or `tv`; left out, the page follows the system. `density="roomy"` gives the desk its touch-laptop rows. All of it is undone on unmount, so a legacy page you navigate to looks as it always did.

   Inside `Surface`, tokens and the system font just work. The body background, heading font and link colour from `index.css` are already undone.

3. Style your page with a CSS file in `@layer shell`, using tokens only:

   ```css
   @layer shell {
     .floor-board { border-bottom: 1px solid var(--rule); padding: var(--s3) var(--s4); }
   }
   ```

   Rules for that file:
   - **Everything goes in a layer.** Unlayered CSS beats every layer, including the components.
   - **Don't `@import` `tokens.css` or `fonts.css`.** `design/app.css` already loads them everywhere, and a second copy ships them twice. The landing page's `landing.css` and team's `team.css` were written before this; `landing.css` is fixed, and `team.css` still has the imports.
   - **Never use a legacy class** (`.btn`, `.input`, `.auth-form`...) on a new element, and never add to `index.css`. Pick a prefix per page.
   - **No `!important`.** `index.css` still has five, on `.btn-danger`, `.auth-footer-secondary`, `.admin-subhead` and `.qr-scanner-view video`. They only touch those legacy classes, but `!important` in a low layer beats everything above it, so never reuse those classes.
   - A page using `Surface` in a dark OS gets dark tokens. A page that uses tokens *without* `Surface` must be added to the `color-scheme` rule at the top of `design/ui.css`, or its native controls stay light.

   Tokens: colours in `design/tokens.css` (`--paper`, `--ink`, `--rule`, `--pen`, `--flag`, `--go`, `--wait`, each with a `-wash`). In `design/ui.css`: space `--s1` to `--s10` (2 to 96 px), type `--t-xs` to `--t-5xl` (12 to 64 px), `--r` (3 px), `--dur` (120 ms), `--control`, `--row`, `--name`.

   The rule in one line: **ink is fact, blue pen is what someone just entered, red pencil is what needs you, and everything else stays out of the way.** Hairlines rather than cards, no shadows outside dialogs, no gradients, no emoji, no Unicode chess glyphs.

## Components

Import from `src/ui`.

### PlayerName: the only way to show a name

```tsx
<PlayerName name={player.name} disambiguator={lookalikes.has(player.id) ? formatDisambiguator({ no: player.seed, section }) : null} />
```

- Pass the name **as stored**. It shows Title Case with `bin`, `binti`, `a/l`, `a/p` lowered, keeps mixed-case input as typed, and splits at the patronym: given name weight 600, the rest 400 and quieter.
- It fits by narrowing the width axis from 100% to 62%, then breaks at the patronym. It never changes the font size and never truncates. There is no truncation option, and a unit test fails on `text-overflow` in `src/ui` or `src/design`.
- **Give it a definite width:** a `table-layout: fixed` cell, a grid track or a block in a sized parent. In a shrink-to-fit parent there's nothing to fit against, so it stays at 100%. `fit={false}` turns measuring off for a hero line with room to spare.
- **Certificates and exports use the stored value**, never `displayName()`. `nameParts(raw).original` is there if you've only got the parts.
- Lookalikes: call `findLookalikes(allPlayers)` once per list and keep the `Set`. On public pages the disambiguator is `#no · section`, **never the school**. That's the founder's decision on children's data.

"Bin" is also a Chinese given name, so `TAN BIN HAO` stays `Tan Bin Hao` through a small surname heuristic in `names.ts`. It's a guess by design, and being wrong costs one letter's case and a line break.

### Piece and Marker

`<Piece color="white" />` is a square, physically white or black in every theme. Always put it next to a word or in a fixed column. `<Marker />` is solid for delivered, `<Marker hollow />` for only on this device. Use these two everywhere status appears; don't invent another signal.

### Result

`<Result result={game.result} confirmed={round <= confirmedRounds} unsent={game.dirty === 1} />` takes the stored code (`1-0`, `0-1`, `1/2-1/2`, `1-0F`, `0-1F`, `0-0`, `bye`, `pending`). Pen colour until confirmed, ink after, hollow marker while unsent, and full words for screen readers. `resultText`, `resultSpoken` and `formatPoints` (`1.5` becomes `1½`) are exported for your own markup.

### Button

`<Button variant="primary" size="lg" block>`. Variants are `default`, `primary`, `danger`, `quiet`; sizes `sm` (32 px), `md` (`--control`: 36, or 44 on touch surfaces and under 960 px), `lg` (52). For a router link: `<Link className={buttonClass({ variant: 'primary' })} to="...">`. One primary per view.

### StatusLine and AsOf

```tsx
const desk = useDeskSync(); // from src/shells/deskSync. Null outside the desk.
<StatusLine
  device="laptop"
  connected={desk.online}
  syncing={desk.syncing}
  failed={desk.failed}
  pending={desk.pendingCount ?? 0}
  rejected={desk.rejections.length}
  cloudAsOf={desk.lastSync}
  showAudience
/>
```

It says the three things in order: everything is saved here, who else has it, who is affected. Never write your own "Online" or "Synced". The rules are pinned in `sync.test.ts`: no such words in any state, offline is amber with a hollow marker and never red, and a rejection overrides any good news. A caveat for the Round Desk: `lastSync` is the time of the last sync that *returned*, which can include rejections. Treat `rejected > 0` as outranking it, as `describeSync` does. Turn rejections into tasks in the "Needs you" rail too.

`<AsOf asOf={iso} connected={bool} />` is for parent and hall pages, which always show how old their list is and never blank out. Feed it the time of your last good fetch. The floor has its own queue and should use the marker language with its own words, not `StatusLine`.

### PairingTable

```tsx
<PairingTable
  caption="Round 4 pairings"
  cursorBoard={cursor}
  sections={[{ name: 'U12', note: '7 boards', boards }]}
  renderResult={(b) => <ResultButtons board={b} />}   // optional, desk entry
  onBoardClick={(b) => open(b)}                        // optional
  showBy={false}                                       // optional, parents don't need it
/>
```

A real `<table>` with a caption, scoped headers and a full spoken row, so don't rebuild it from divs. Each board is `{ board, white, black, result, confirmed?, unsent?, by?, flagged? }`; `white` and `black` are `{ name, points?, disambiguator? }` or `null` for a bye. Sections stay in one table: no boards behind a tab. It stacks below 640 px of **its own** width by container query, so it works beside a rail. Print rules are included. Keyboard handling is yours: the Round Desk owns the cursor and keys, and passes `cursorBoard` down.

### Field

`<Field label="School" optional hint="..." error={err} value={v} onChange={...} />` renders a 52 px input with label, hint and error wired up. For anything else, take the render function: `<Field label="Section">{(c) => <select {...c}>...</select>}</Field>`. Mark what's optional: parents can't otherwise tell.

### Sheet

`<Sheet open={open} onClose={close} title="Board 4">...</Sheet>` is a native `<dialog>`, so focus trapping and Esc come free. `variant="sheet"` (default) rises from the bottom for the phone; `variant="modal"` centres for the desk. The parent owns `open`.

### Icons

`IconChevronRight`, `IconClose`, `IconPrint`, `IconCheck`, `IconPlus`, `IconSearch`, `IconUndo`, `IconWifiOff`, `IconMenu`, `IconDownload`, `IconQr`, `IconHelp`, `IconAlert`, `IconSignOut` and others in `src/ui/icons.tsx`, copied from Lucide 0.460 (ISC). Decorative unless you pass `title`. Need another? Copy its paths in; don't add the package. `<Mark />` is the split-square brand mark. Prefer words to icons.

## Electron

`apps/web` is also the desktop renderer. A new top bar uses `className="ui-topbar"`, which becomes the window's drag region, opts its controls out and leaves room for the window controls on each platform. Keep asset URLs relative (import them; never `/assets/...`). Don't change the Dexie database name (`chess-alokas`) or its schema without a real migration: `shells.spec.ts` checks the version. Links go through the router, because desktop uses `HashRouter`. `window.print()` and `<dialog>` are **not yet checked in the packaged app**; check them when you first rely on them.

## Visual checks

From `apps/web`:

| Command | What it does |
|---|---|
| `pnpm exec playwright test` | Everything. Builds with `--mode e2e`, serves it, runs all projects |
| `pnpm exec playwright test --project=w390` | Screenshots at one width. Projects: `w360`, `w390`, `w1366`, `w1920` |
| `pnpm exec playwright test --project=checks` | Network assertion, overflow audit, legacy checks, component sheet, axe |
| `pnpm exec playwright test --project=desktop` | `--mode desktop` build over `file://` |
| `pnpm exec playwright test --project=w390 -g "live" --update-snapshots` | Accept a change for one route, after you've looked at it |
| `pnpm test` | Unit tests (names, sync, results, components) |

Everything is against a production build, with mocked API and Supabase in the browser (`e2e/fixtures/mockApi.ts`), so nothing real is ever contacted. Time is frozen at 14:32 in Kuala Lumpur, motion is off, and any request outside the app is blocked and recorded. Fixtures in `e2e/fixtures/data.ts` are invented pun names. **Never use `sample-registrations-*.csv` or `scripts/arcc-*.json`.**

Baselines in `e2e/__screenshots__/` are viewport-height screenshots with zero pixel tolerance. **They are rendered on Windows,** so they only match on a Windows machine with the same fonts; regenerate in one Linux container before wiring them into CI. No CI workflow exists yet.

When you replace a page:

1. Add your route to `e2e/visual.spec.ts`, `audit.spec.ts` and, for non-desk surfaces, `shells.spec.ts`.
2. Update that route's baselines and **look at the images.** Only your route should change. If another route moved, your CSS leaked.
3. Compare with your mockup at the same width.

**Parity mode** proves a CSS change altered nothing but what you meant. `E2E_PARITY=1` forces one font and writes full-page shots to `e2e/.parity` (not committed):

```
E2E_PARITY=1 pnpm exec playwright test --project=w1366 --update-snapshots   # on the old code
# change the CSS
E2E_PARITY=1 pnpm exec playwright test --project=w1366                      # on the new code
```

A floor rebuild's own checks: a screenshot at 360 and 390, no control under 44 px, no sideways scroll, and the existing `floorZone` tests including `409` staying green.
