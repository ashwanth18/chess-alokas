# Building on the Chess Alokas design system

For anyone building Floor, Matchday, Hall, Register or the Round Desk.

**The brand is forest green and gold on every surface.** That's the founder's decision. It replaces the "Pairing Sheet" paper look. From `DESIGN_PLAN.md`, keep the workflows, layouts, keyboard, no-truncation names, honest sync, AA contrast, tap targets and lazy shells. Ignore its palette, its "hairlines not cards" and its single typeface. The mockups in `mockups/` are right about structure and wrong about colour.

See every component live at `/__ui` (`pnpm --filter @chess-alokas/web dev`, then `http://localhost:5173/__ui`). It doesn't exist in production builds.

## The look lives in one file

`apps/web/src/design/tokens.css` holds every colour, radius, shadow and font. A unit test fails on a hex or `rgb()` colour, a hard-coded shadow or a radius in `ui.css`, `shell.css` or `src/ui`. Do the same in your page's CSS.

| Token | Means |
|---|---|
| `--paper`, `--paper2`, `--paper3` | Page surface, raised, pressed. Forest green by default. The names are historical |
| `--field` | Input background |
| `--ink`, `--ink2`, `--ink3` | Text: primary, secondary, labels. Cream |
| `--heading` | Headlines. Gold |
| `--accent`, `--accent-hover`, `--on-accent` | Primary action: gold with dark green text |
| `--rule`, `--rule-strong` | Decorative line, control border (meets 3:1) |
| `--focus` | Focus ring |
| `--pen`, `--pen-wash` | Just entered, links, cursor row |
| `--flag`, `--go`, `--wait`, each with `-wash` | Needs a person, delivered, on this device |
| `--r-sm`, `--r`, `--r-lg` | Corner radii: 4, 8, 14 px (desk: 4, 4, 6) |
| `--elev-sm`, `--elev`, `--elev-lg` | Soft elevation (desk and sunlight: none) |
| `--font-head`, `--font-text`, `--font-data` | Fraunces, Source Sans 3, Archivo |
| `--s1` to `--s10`, `--t-xs` to `--t-5xl` | Space 2 to 96 px, type 12 to 64 px |
| `--row`, `--name`, `--control` | Density: table row, name size, control height |

**Fonts.** All three are self-hosted under SIL OFL, in `design/fonts/` with their licences, so type works offline and nothing goes to Google. Fraunces is for headlines and Source Sans 3 for reading. **Archivo is only for names, board numbers and tables,** because only it has the width axis that keeps a long name whole. Browsers download a font only when text uses it, so legacy pages don't pay for Archivo; `legacy.spec.ts` checks that.

**Themes.** Default is forest. `Surface theme="sun"` is the high-contrast sunlight theme for the floor (white, black, forest as the one colour); give arbiters a button for it, because there's no reliable automatic signal. `theme="tv"` is the deepest green for the hall. `theme="light"` is the original design's cream panels. The surface sets density: **`name="desk"` is the same brand as a plainer, denser work tool** with flat, tighter corners, no page gradient and 36 px rows.

**Contrast.** `design/tokens.test.ts` measures 33 foreground and background pairs in all four themes against WCAG AA (4.5:1 for text, 3:1 for control borders and focus) and fails the build's tests if a change breaks one. If you add a pair of tokens that sit together, add it there. The old palette failed in places: `--color-danger` and `--color-success` on green are under 4.5:1, so tokens use lighter values. **Translucent surfaces can't be measured this way, which is why `--paper2` and `--paper3` are solid.**

Never name a new token after a variable in `index.css` (`--radius`, `--shadow`, `--font-display`...). The tokens layer would override it on every legacy page. A test checks that too.

## Create a page

1. Pick the surface. It decides what your page may import.

   | Surface | Routes | Parent route element | May use |
   |---|---|---|---|
   | Desk | `/app`, `/tournaments/*`, `/certificates`, `/simulator`, `/account`, `/settings`, `/team`, `/backups`, `/admin` | `OrganizerShell` | Dexie, sync, `useDeskSync()` |
   | Family | `/`, `/login`, `/signup`, `/auth/*`, `/discover`, `/register/:slug`, `/live/:token`, `/live/:token/p/:id`, `/player`, `/invite/:token`, `/privacy`, `/terms` | `ParticipantShell` | The API client. **No Dexie, no sync** |
   | Floor | `/t/:slug` | `FloorSurface` | The API client, its own localStorage queue. **No Dexie** |
   | Hall | `/live/:token/tv` | `HallSurface` | Read-only API. **No Dexie** |

   Routes live in `apps/web/src/main.tsx`. URLs never change: `/t/` is printed on stickers and `/live/` and `/register/` are shared in WhatsApp. Keep every new page `lazy()`.

   `e2e/shells.spec.ts` fails if a family, floor or hall route downloads Dexie, pdf or xlsx. `src/auth`, `src/ui`, `src/api` and `src/shells/deskSync.ts` must never import `src/db` or `src/sync` as values, because every route loads them. A heavy library in your page goes behind a dynamic `import()`.

2. Wrap the page in `Surface`.

   ```tsx
   import { Surface } from '../ui/Surface';
   import { Button, PlayerName } from '../ui';

   export default function FloorPage() {
     return <Surface name="floor">{/* your page */}</Surface>;
   }
   ```

   `name` is `desk`, `family`, `floor` or `hall`. It sets `html[data-surface]`, paints the theme behind the page and sets density: `family` and `floor` get 44 px controls and 48 px rows. `theme` is optional. `density="roomy"` gives the desk its touch-laptop rows. All of it is undone on unmount, so a legacy page you navigate to looks as it always did. Inside `Surface`, the heading font and colour, link colour and body type are set for you.

3. Style your page with a CSS file in `@layer shell`, using tokens only:

   ```css
   @layer shell {
     .floor-board { background: var(--paper2); border-radius: var(--r); padding: var(--s3) var(--s4); }
   }
   ```

   Rules for that file:
   - **Everything goes in a layer.** Unlayered CSS beats every layer, including the components.
   - **Don't `@import` `tokens.css` or `fonts.css`.** `design/app.css` already loads them everywhere, and a second copy ships them twice. `pages/team/team.css` and the landing page's `brandFonts.css` predate this and still do.
   - **Never use a legacy class** (`.btn`, `.input`, `.auth-form`...) on a new element, and never add to `index.css`. Pick a prefix per page.
   - **No `!important`.** `index.css` still has four, on `.btn-danger:hover`, `.auth-footer-secondary`, `.admin-subhead` and `.qr-scanner-view video`. They only touch those legacy classes, but `!important` in a low layer beats everything above it, so never reuse those classes.
   - A page that uses tokens *without* `Surface` must be added to the `color-scheme` rule at the top of `design/ui.css`, or its native controls stay light.

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

`<Piece color="white" />` is a square, physically white or black in every theme, and stays a square on green. Always put it next to a word or in a fixed column. `<Marker />` is solid for delivered, `<Marker hollow />` for only on this device. Use these two everywhere status appears; don't invent another signal.

### Result

`<Result result={game.result} confirmed={round <= confirmedRounds} unsent={game.dirty === 1} />` takes the stored code (`1-0`, `0-1`, `1/2-1/2`, `1-0F`, `0-1F`, `0-0`, `bye`, `pending`). `--pen` until confirmed, `--ink` after, hollow marker while unsent, and full words for screen readers. `resultText`, `resultSpoken` and `formatPoints` (`1.5` becomes `1½`) are exported for your own markup.

### Button

`<Button variant="primary" size="lg" block>`. Variants are `default`, `primary` (gold), `danger`, `quiet`; sizes `sm` (32 px), `md` (`--control`: 36 on the desk, 44 elsewhere), `lg` (52). For a router link: `<Link className={buttonClass({ variant: 'primary' })} to="...">`. One primary per view.

### Card

`<div className="ui-card">`: rounded and softly raised on forest, flat and tight on the desk, all through tokens. Cards are back in the brand, but don't nest them; use the pairing table rather than a card per board.

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

It says the three things in order: everything is saved here, who else has it, who is affected. Never write your own "Online" or "Synced". The rules are pinned in `sync.test.ts`: no such words in any state, offline is amber with a hollow marker and never red, and a rejection overrides any good news. Two caveats for the Round Desk. `lastSync` is the time of the last sync that *returned*, which can include rejections, so treat `rejected > 0` as outranking it, as `describeSync` does. And `pendingCount` isn't covered by any automated test yet. Turn rejections into tasks in the "Needs you" rail too. The legacy top bar still says "Online" until the desk is rebuilt, though it no longer says "Synced" beside a rejection.

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

### AccountMenu

`<AccountMenu place="public" />` from `src/components/AccountMenu` is the one way to show a signed-in person where they can go. `place` is `player`, `organizer` or `public`, and `workspaceLinks` in `src/auth/workspace.ts` decides the links, including the switch for someone with both sides. The top bar passes `collapses`, because its phone menu carries the same items through `AccountMenuItems`. A public page with its own top bar uses it instead of buttons to `/player` or `/app`. See "Who opens where" in `docs/FEATURES_ORGANIZATIONS_AND_PLAYERS.md`.

### Icons

`IconChevronRight`, `IconClose`, `IconPrint`, `IconCheck`, `IconPlus`, `IconSearch`, `IconUndo`, `IconWifiOff`, `IconMenu`, `IconDownload`, `IconQr`, `IconHelp`, `IconAlert`, `IconSignOut` and others in `src/ui/icons.tsx`, copied from Lucide 0.460 (ISC). Decorative unless you pass `title`. Need another? Copy its paths in; don't add the package. `<Mark />` is the split-square brand mark, which replaces the Unicode queen. No emoji and no Unicode chess glyphs in new work.

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
| `pnpm test` | Unit tests (names, sync, results, components, token contrast) |

Everything is against a production build, with mocked API and Supabase in the browser (`e2e/fixtures/mockApi.ts`), so nothing real is ever contacted. Time is frozen at 14:32 in Kuala Lumpur, motion is off, and any request outside the app is blocked and recorded. Fixtures in `e2e/fixtures/data.ts` are invented pun names. **Never use `sample-registrations-*.csv` or `scripts/arcc-*.json`.**

Baselines in `e2e/__screenshots__/` are viewport-height screenshots with zero pixel tolerance. **They are rendered on Windows,** so they only match on a Windows machine with the same fonts; regenerate in one Linux container before wiring them into CI. No CI workflow exists yet.

When you replace a page:

1. Add your route to `e2e/visual.spec.ts`, `audit.spec.ts` and, for non-desk surfaces, `shells.spec.ts`.
2. Update that route's baselines and **look at the images.** Only your route should change. If another route moved, your CSS leaked.
3. Compare with your mockup's structure at the same width.

**Parity mode** proves a CSS change altered nothing but what you meant. `E2E_PARITY=1` forces one font and writes full-page shots to `e2e/.parity` (not committed):

```
E2E_PARITY=1 pnpm exec playwright test --project=w1366 --update-snapshots   # on the old code
# change the CSS
E2E_PARITY=1 pnpm exec playwright test --project=w1366                      # on the new code
```

`playwright.shots.config.ts` runs the navigation checks on their own port and retakes the pictures in `docs/design/screenshots/navigation/`, so it doesn't compete with a full run for port 4179.

A floor rebuild's own checks: a screenshot at 360 and 390, no control under 44 px, no sideways scroll, and the existing `floorZone` tests including `409` staying green.
