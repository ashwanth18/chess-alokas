# Chess Alokas: UI/UX overhaul plan

> **Direction changed 2026-11-01.** After seeing it on a real phone, the founder rejected the paper and ink look as dull. Use the old forest green and gold brand on every surface, with a plainer, denser variant for the organizer desk. This plan's layouts, workflows, name rules, sync honesty and accessibility targets still apply. Its palette, typography, "no cards" rule and the look of the mockups do not.

Status: plan and mockups only. Nothing in the repo was changed. All evidence below comes from the current working copy (branch `feat/auth-cloud-deploy`, uncommitted edits included), built locally and walked with Playwright using invented players. API in memory mode, Supabase auth mocked in the browser. Screens from that walk are in `screenshots/current/`; mockup captures are in `screenshots/`.

**Verdict.** The product logic is strong and the interface hides it. The app knows about score groups, floor PINs, offline queues and card rules, but it presents them as a dark green and gold theme over a stack of cards, tabs and paragraphs. The trouble is not only taste: names get cut to "SITI ..." on the director's desk, and two different children appear identical to a parent.

**Direction.** "Pairing Sheet": paper, ink, a blue pen and a red pencil, in one typeface whose width axis keeps long Malaysian names whole. Open `index.html` to try it.

---

## 1. Critique

### Why it feels generic

| Symptom | Evidence |
|---|---|
| The "premium dark theme" formula: saturated forest green gradient, gold serif headings (Fraunces), pill chips, translucent cards | `current/d1366-app.png`, `current/d1366-round2.png` |
| Everything is a card inside a card, all with the same weight | `current/d1366-round2.png` |
| Emoji and Unicode glyphs doing the job of icons and design: 🚨 🟡 🔴 📺 📍 🥇 ♕ ♟ across `.tsx` | medals in `current/d1366-standings.png` |
| Decoration over evidence on the landing page: floating chess pieces, checkerboard, a faux window with traffic lights, centred pills, Western sample names (and a typo, "T. Nyugen") for a Malaysian audience | `current/d1366-landing-fold.png` |
| Empty home page spends half a laptop screen on a logo hero | `current/d1366-app.png` |
| Three different visual languages: green and gold app, navy with blue tags on TV, and light-on-dark forms with broken labels | `current/d1920-tv.png`, `current/m390-register-fold.png` |

Structural debt behind this: `index.css` is 6,302 lines and grew by over 100 during this audit, with 690 top-level class selectors, 28 `!important`, and 193 inline `style={{}}` blocks in `.tsx` (64 in `LiveTvPage`). No component library, no i18n (`lang="en"` hard-coded, zero translation files). Fonts come from Google at runtime, so an offline-first app loses its typography offline.

### Journey 1: running a round, pairing to standings

Counted on the desk at 1366 with 15 boards in 2 categories, round 2 onward.

| # | Action | Note |
|---|---|---|
| 1 | Click Pairings tab | Page always opens on Players |
| 2 | Click Generate Round N | Below the fold |
| 3 | Copy PIN and send it | |
| 4 | Choose the category with boards | After generating, my walk landed on an empty category and showed "No pairings for this round" |
| 5–19 | 15 clicks on result buttons | Plus about 3 screens of scrolling; each board is ~140 px tall |
| 20 | Switch category | Boards in the other category were hidden |
| 21 | Scroll, click Confirm Round N | |
| 22 | Click Standings tab | |
| 23 | Choose the category again | |

**23 actions, 8 of them overhead, about 5 decisions.** No keyboard entry at all.

**Worst friction: the first board was 1,512 px down the page on a 1366 laptop in my run** (with the trial rejection notice showing; about 1,200 px without), under a banner, a stepper, a "Next steps" list repeating the stepper, a floor panel and a PIN panel (`current/d1366-round1-full.png`).

Also observed:
- **Names are truncated on the desk:** "SITI ...", "LEE S...", "PUTE...", "DEEP..." in `current/d1366-round2.png`. Warning, Illegal and Absent buttons for both players take the space. 203 visible controls on the page.
- **The topbar overflows at 1366:** page width 1486 px, Sign out is off-screen. At 390 the page is 619 px wide, so it scrolls sideways.
- **A red Delete button sits beside Settings during a live event.**
- **No way to print pairings or standings from this screen.** The only print text in `TournamentPage.tsx` is about stickers. Printed sheets on the wall are the fallback when everything else fails.
- **After round 1 every winner gets a gold medal emoji**, 14 medals in a column (`current/d1366-standings.png`), because of shared rank.
- **Sync contradicts itself:** with 28 players on a trial, the top bar says "Online, Synced 15:12" directly above "4 changes were not saved online" (`current/d1366-after-sync-28-players.png`). The director can still pair. The public TV then showed 10 of 14 boards, numbered 1, 2, 3, 5, 6... (`current/d1920-tv.png`). Nothing on the desk connects those two facts.

### Journey 2: entering a result on the floor

| Case | Steps today | |
|---|---|---|
| First board ever on this phone | **8** | Scan sticker, type name, type PIN, Unlock, scroll, tap result, Continue, Confirm |
| Later board, single view | 5 | Scan, scroll, tap, Continue, Confirm |
| Later board, zone grid | **3** | Scroll to it, tap, Confirm |

**Worst friction: result targets are 26 px tall and about 43 px wide**, in a wrapped row of six where 1-0F sits next to 1-0 at equal weight (`current/m390-floor-zone.png`). All 89 controls on the zone page measure under 44 px. The page is 3,225 px long, fixed ranges (1–15, 16–30, 31+) ignore how a hall is actually split, and pending boards aren't sorted first. In single view the result buttons are below the fold, under cards and "VS".

Credit where due: the offline queue is a real feature worth keeping. Its message needs more calm and clarity, not a new mechanism.

### Journey 3: registering a child

Counted without an account, at 390: open link, scroll to form, 12 fields, switch to the bank app and pay, 3 taps to pick the receipt, submit. **19 actions, 12 field decisions.** Only the name is really required; a parent can't tell, since only two fields say optional.

**Worst friction: form labels are close to invisible.** `#1a2e24` on the panel's `#285748` measures **1.7:1** (`current/m390-register-fold.png`). Second, the form keeps its state only in memory (no storage calls in `EventRegistrationPage.tsx`), and the receipt field sits 1,269 px down. A cheap Android reloading the tab after a trip to the banking app can lose the whole form, right at the payment step. Three columns at 390 px clip placeholders, and the file input is the browser default.

### Journey 4: "which board, what colour, who against, where do we stand?"

First time: open link, tap search, type a name, read the result, tap Details for the opponent. **4 actions, 5 if the parent stars the child** to remember them. Later rounds: **2 if starred, up to 4 if not.** I did not walk the return visit; this is from the code (`liveBookmarks.ts`) and the first-visit screens.

**Worst friction: two different children render identically.** Searching "Puteri" returned two rows both reading "PUTERI ALEKHINE DAMIA B..." (`current/m390-live-search.png`). A parent can follow the wrong child to the wrong board. Colour is a small dot, and the page leads with the full board list and a TV button, so the four questions aren't answered in one place. The `/player` portal has a good matchday card but needs an account, a profile and an organiser link, so most parents on the day won't get there.

### Hall screen and other moments

- **TV:** names render at 16.8 px on a 1920 screen. That is about 7 mm cap height on a 55-inch panel, readable from roughly 2–3 m rather than 10. About 40 percent of the screen was empty in my capture, and setup controls (clock presets, selects) are on show to the hall (`current/d1920-tv.png`).
- **Landing:** a correction to my first impression. Earlier full-page captures show large blank sections, but that is a capture artefact from scroll-reveal; scrolled normally the sections appear. The real issues are generic content and one misaligned heading in a centred block (`current/d1366-landing-fold.png`).
- **Admin:** functional, and low priority. Move approvals into the same desk shell as a simple inbox.

---

## 2. Information architecture and workflow

### Separate worlds, one brand

This takes the architecture review as input: one backend, account, origin and build, with `shells/`, `organizer/`, `participant/`, `floor/`, `shared/`.

| Surface | Routes (all stay) | Tone | Depends on |
|---|---|---|---|
| **Desk** (organizer shell) | `/app`, `/tournaments/:id`, `/certificates`, `/admin`, `/settings` | Terse, dense, keyboard, ledger: "Bd 14 1–0" | Dexie, sync |
| **Family** (participant shell) | `/`, `/discover`, `/register/:slug`, `/live/:token`, `/player` | Warm, roomy, sentences: "Damia plays White" | No Dexie, no sync |
| **Floor** | `/t/:slug` | One purpose, thumb | Arbiter session, its own queue |
| **Hall** | `/live/:token/tv` | No chrome | Read-only |

**Two tones, one brand.** Same paper, ink, type and semantic colours. Tone comes from type scale, density and voice, not a second palette.

**Where my evidence adds to the architecture review:**

1. **Floor and Hall need to be surfaces of their own**, not just folders inside two shells. They have no nav, no account, and different rules. So: two account shells plus two chrome-free surfaces.
2. **"Electron carries organizer and floor only" misses the hall screen.** The most likely setup at a venue with bad Wi-Fi is a laptop plugged into a projector by HDMI. `/live/:token/tv` depends on the cloud today, so it goes stale exactly when the venue Wi-Fi fails. I recommend Electron also opens a second window driven by local Dexie data. Without that, "keeps working offline" stops at the desk.
3. **Agree, with strong evidence:** the Dexie gate shouldn't block parents. Today `AppRoot` waits on IndexedDB before any route renders and every page is imported eagerly into a 2.38 MB main chunk, including for a parent on mobile data.
4. **Agree: parents on web first.** The mockups are mobile web. A parent arrives from a WhatsApp link or a TV QR code, so an install step is friction at the worst moment. Flutter gets the token mapping regardless, with the deeper rework depending on the founder's decision.
5. **`returnTo` must also keep the draft.** Sign-in is optional in the register mockup. When used, it returns to that event and that step with typed data intact, since the draft is on the device.
6. **Switching shells should be a full page navigation.** This is what lets one stylesheet per shell actually unload the other's CSS.

### The tournament as a timeline, not tabs

Yes. Tabs treat Players, Registrations, Pairings and Standings as equal at all times, and the current stepper and "Next steps" list are a patch for that. The new top strip is:

`Setup › Registration › Check-in › Rounds 1 2 3 [4] 5 › Finish`

Every phase stays clickable, because real events aren't linear: late entries and corrections happen mid-round. Only the emphasis follows the timeline. Inside each round is a fixed loop:

`Pair → Publish → Play → Confirm → Standings`

**Publish is the one new concept.** Today a generated round reaches the public pages at the next sync, with no separate check. A director should be able to check it first, and then floor, hall and parents all change together.

### The director's "right now" screen

`round.html`. Three things, always in the same place:

1. **One sentence and one action**, top: "Round 4: 7 boards still playing." The main button is always the next step, and Enter presses it.
2. **The pairing table** fills the screen. No panels above it.
3. **"Needs you" rail**: chief calls and disagreements between desk and floor. If it's empty it says "Nothing right now". Then PIN and hall screen, which are reference, not tasks. A disagreement blocks Confirm; a chief call doesn't.

Rare and dangerous actions leave this screen. Delete moves to Setup.

### Keyboard first at the desk

Implemented in the mockup and run end to end with Playwright.

| Key | Action |
|---|---|
| `1` `0` `=` (or `5`) | Result for the current board, then jump to the next empty one |
| `↑` `↓` | Move |
| `/`, then `14 1`, Enter | Slip entry. Slips arrive out of order, so this is the realistic path. Live echo names the player before saving and warns if replacing a result |
| `F` | Forfeit options |
| `U`, `Backspace` | Undo, clear |
| `Enter`, `P`, `S` | Main action, pair, swap standings |
| `?` | Key list |

### Thumb first on the floor

`floor.html`. Boards pending first, big numbers. Tap a board and a sheet rises with three large buttons in thumb reach: white block with the White player's name, draw, black block with the Black player's name. The name is on the button, so the arbiter confirms by reading who won rather than recalling 1–0 versus 0–1.

Saving is one tap followed by **5 seconds of Undo** with a plain echo ("Board 4: Goh En Passant (White) won"). Forfeits sit one level down and need an explicit confirm. A saved result can't be changed from the phone; the sheet routes that to the desk, matching the existing `409` lock. "My boards" is set by the arbiter. "Go to board" is a number pad. Sunlight mode is one button.

### Offline and sync: honest and calm

The current model is one word, "Online", plus a "Synced" time, which contradicted the rejection notice in my run. The replacement is a status line that states separate facts:

- **Where is my work?** "Everything saved on this laptop". True offline too, and always first.
- **Who else has it?** "Cloud has everything, as of 14:32" or "No connection. 3 results will go to the cloud when it returns."
- **Who is affected?** "Floor phones keep their own results until then. The parents' page stays at 14:02." Today nobody tells a director this, and it's the question they need answered.

Rules:
- Never use "Online" alone. Never show "Synced" while anything was rejected.
- No red for offline. Offline is a normal condition, shown in amber with a hollow marker. Red is only for what needs a person.
- Marker language everywhere: solid square means delivered, hollow square means on this device.
- Results use the pen colour until the round is confirmed, then turn to ink, like a paper sheet.
- Rejections become tasks in "Needs you", tied to their cause.
- Parent and hall pages always show their "as of" time and never blank out.

### Step counts: before and after

An action is a click, tap, field or scroll needed to reach the target. Targets for the round and floor were executed in the mockups.

| Journey | Today | Target | Decisions | Worst friction removed |
|---|---|---|---|---|
| Round, pair to standings, 15 boards | **23** | **18** | 5 → 2 | Round is the page; no category switching |
| Same, excluding the 15 results | **8** | **3** (`P`, `Enter`, `Enter`) | | |
| Floor, first board on a new phone | **8** | **4** (scan, name, PIN, result) | | PIN submits itself; sticker opens that board |
| Floor, returning phone, new round | 7 | **3** | | |
| Floor, each later board | **3–5** | **2** | | Pending-first list, big targets |
| Register a child, no account | **19** (12 fields) | **13** (4 fields) | 12 → 4 | Sections are suggested; draft survives the bank app |
| Register, child saved on phone | about 10 | **9** | | |
| Find board, first time | **4–5** | **3** | | Whole names, opponent on the first screen |
| Find board, every later round | **2–4** | **1** | | Opening the link is the answer |

Registration is the smallest win in pure count, because paying and attaching a receipt can't be shortened without a payment gateway. Its real gain is confidence: four fields rather than twelve, nothing lost, and always a clear next thing to do.

The "3" in the desk target assumes the PIN is read aloud from the rail. Arbiters still re-enter a new PIN each round unless sessions carry across rounds, which is a security decision for the founder (section 6).

---

## 3. Visual direction

### Primary: Pairing Sheet

A chess tournament already has a visual language: the sheet taped to the wall, ruled lines, tabular numbers, a blue ballpoint, a chief arbiter's red pencil. Black and white are the game's data, so here they are data, not style.

**The idea in one rule: ink is fact, blue pen is what someone just entered, red pencil is what needs you, and everything else stays out of the way.**

Signature moves:
- **Hairlines and heavy rules instead of cards.** 3 px radius at most, no shadows outside modals, no gradients, no blur, left-aligned.
- **The parent's hero is literally the colour they play.** If your child is White the block is white with black text. If Black, solid black. Readable from across a corridor, and impossible to get backwards.
- **Square piece markers, never circles or colour alone.** White: `#FFF` with an ink edge. Black: `#000` with an ink edge. They stay physically correct in dark mode.
- **Expanded heavy Archivo for numbers and headings** gives a tournament-poster voice with one font file.
- **Board number leads everywhere**, large, with tabular numerals.

### Alternative: Departure Board

Black first, signal yellow, railway-condensed type. Excellent on a TV and memorable on a landing page. Not recommended, because it fights print, is poor on a cheap phone in sunlight, and makes a parent's phone feel like an airport. Its best idea, a page you read from a distance, is already in the Hall screen.

### Type

| | |
|---|---|
| Family | **Archivo** variable (wght 100–900, wdth 62–125), SIL OFL. One family only |
| Size | Latin 90,104 bytes woff2; Latin Ext 86,240 bytes loaded only when needed through `unicode-range` |
| Verified in a browser | `tnum` gives all digits equal width (56.8 at 100 px). A 40-character name measures 1,863 at 100% width, 1,475 at 75%, 1,275 at 62%: **up to 32% narrower without cutting a letter**. `½` is present |
| Offline, PWA | Vendor in `apps/web/src/assets/fonts`, hashed by Vite. `vite.config.ts` already precaches `woff2` |
| Electron | Relative URL works with `base: './'` and `file://`. `policy.ts` already allows `font-src 'self' file:`. Remove the Google Fonts link and CSP entries afterwards |
| Chinese, Tamil | System fonts (Microsoft YaHei, Noto Sans CJK, PingFang; Nirmala UI, Noto Sans Tamil, Tamil MN). No bundle cost. Rendered correctly in `matchday-390-lang-zh.png` and `-ta.png` on Windows; **not yet checked on a cheap Android** |
| Flutter | Bundle the variable TTF as an asset, with `fontVariations` and `FontFeature.tabularFigures()`. File size not measured yet |

Scale: 12, 13, 14, 16, 18, 20, 24, 32, 44, 64. The floor is 12 px at the desk and 16 px for body text on phones.

### Names: the rule

**Nothing ever truncates a name.** Lint for `text-overflow` in name components. A single `<PlayerName>` handles it:

1. Split at the patronym marker (`bin`, `binti`, `a/l`, `a/p`). The given name is weight 600, the rest weight 400 and one step quieter, so the eye finds the child first and the full legal name is still there.
2. Fit first by narrowing along the width axis (100 → 62%), then wrap at the patronym. Never shrink below the size floor.
3. When two players share a long prefix, always show a disambiguator: `#12 · U12 · school`.
4. Display in Title Case with `bin/binti/a/l/a/p` lowered, keep mixed-case input as typed, keep the original as stored for certificates. Capitals alone cost about 20% more width and read slower. Needs founder and parent review: some families may care about exact form.

The mockups use invented pun names with the same structure as real ones, including two children differing only at the end ("binti Queen Gambit" and "binti Queen Indian").

### Pairing table and standings

Canonical form: `Bd | Pts | White | Result | Black | Pts | By`. White always left, Black always right, result dead centre. It's the form every arbiter already knows.

- Tabular numerals throughout, with `½` and centred `1 – 0`.
- Desk rows 36 px, Roomy 48 px.
- Section headings inside one table, All by default. Boards can no longer hide behind a category tab.
- Result colour: `pen` until confirmed, `ink` after. Hollow marker while unsent.
- Standings are real crosstables: `+7■ =9□ −11■` per round. Shared ranks read `13=`. **No medal emoji.** A heavy rule marks the prize line.
- Print stylesheet included; the current app can't print pairings. Sample at `screenshots/round-print.pdf`.

### Colour tokens

Source: `tools/tokens.mjs`, generating `assets/tokens.css` and `alokas_tokens.dart`.

| Token | Light | Dark | Sunlight | TV | Means |
|---|---|---|---|---|---|
| `paper` | `#F7F5EF` | `#141412` | `#FFFFFF` | `#0A0A09` | Page |
| `paper2` | `#EEEBE2` | `#1F1E1B` | `#F2F2F2` | `#191917` | Raised |
| `paper3` | `#E2DED2` | `#2B2A26` | `#E0E0E0` | `#262522` | Pressed |
| `ink` | `#161513` | `#EFEBE1` | `#000000` | `#FFFFFF` | Data, primary action |
| `ink2` | `#47443E` | `#C0BBAF` | `#1C1C1C` | `#DDD9CF` | Secondary |
| `ink3` | `#68645C` | `#9B978C` | `#333333` | `#B5B1A6` | Labels |
| `rule` | `#D3CEC1` | `#393731` | `#6E6E6E` | `#3F3D37` | Hairline (decorative) |
| `ruleStrong` | `#827D72` | `#7F7B71` | `#000000` | `#8E8A80` | Control border |
| `pen` / wash | `#1746B8` / `#E2E8F7` | `#94B6FF` / `#1B2946` | `#002FA8` / `#DCE5FF` | `#A9C6FF` / `#1B2946` | Just entered, links, focus |
| `flag` / wash | `#B3261E` / `#FAE5E1` | `#FF9583` / `#3B1A15` | `#9E0B0B` / `#FFE1DC` | `#FF9F8F` / `#3B1A15` | Needs a person |
| `go` / wash | `#17653A` / `#DEEFE3` | `#70D096` / `#14301F` | `#0A4A26` / `#D6F0DF` | `#84E3A9` / `#14301F` | Delivered, complete |
| `wait` / wash | `#7D5200` / `#F8EBCB` | `#EABB50` / `#32260B` | `#5C3C00` / `#FFEDB8` | `#F1C75F` / `#32260B` | On this device, waiting |

### Spacing, density, shape

- **Space:** 2, 4, 8, 12, 16, 24, 32, 48, 64, 96.
- **Density:** Desk (36 px rows, 14 px names, 32–36 px mouse controls), Roomy (48 px, 16 px, for a touch laptop), Floor and Family (44 px minimum, 52 px inputs, 60–84 px primary), Hall (a unit scale from viewport, see below).
- **Shape:** 3 px radius, 1 px hairlines, 2 px structural rules, 1.5 px control borders.

### Iconography

Mostly words. Icons are a small inline SVG set for things that need no translation: squares (pieces, status), chevron, close, print. Copy about 15 glyphs from Lucide (ISC) into `shared/ui/icons` rather than adding a dependency. No emoji, no Unicode chess glyphs (they change with the font, and ♕ was the logo). The mark is a split square.

### Motion

Almost none. 120 ms for hover and sheet. Undo uses a draining 5 s bar. TV page changes are a hard cut with a progress hairline, since sliding text can't be read from a distance. No scroll-reveal anywhere. `prefers-reduced-motion` drops all of it, and the mockup screenshots run in that mode.

### Empty, loading, error

| State | Rule | Example |
|---|---|---|
| Empty | Say what's true and the next step, in text. No art | "All your boards are in. The desk confirms the round." |
| Loading | Show cached data immediately with its time. Skeletons only if nothing is cached. No spinners over content | |
| Error | What happened, what's safe, what to do | "No connection. Your receipt is safe on this phone and will send automatically. You can close this page." |
| Wrong PIN | Specific | "That PIN is not for round 4. Ask the desk for the new one." |

### Hall screen

`tv.html`. A viewport unit (`--u`, 19.2 px at 1080p, 38.4 at 4K) scales the entire stage, checked at 1366, 1920 and 3840.

**The maths for 10 m.** Names are 75 px at 1080p. Measured cap height at that size: 52 px. Dimensions on common screens, which I computed but did not test in a real hall:

| Panel | px pitch | Cap height | Legibility distance at 1:300 |
|---|---|---|---|
| 43 inch | 0.50 mm | 26 mm | 7.7 m |
| 55 inch | 0.63 mm | 33 mm | **9.9 m** |
| 65 inch | 0.75 mm | 39 mm | 11.7 m |

So the "10 m" claim holds from about 55 inches up. On smaller screens or a shorter room, Size switches to 8 rows.

- **Screens rotate:** Pairings (6 rows, about 12 s), Find your name A–Z with board and colour (for a child who doesn't know their board, with a QR for phones; readable nearer 6 m), and Standings by section.
- **Patronym on its own line** at 46 px, narrowing as needed.
- **Dark for TVs, light for projectors.** In a lit hall, a projector's "black" is just the lit wall, so black text on white holds up better. One key (`L`).
- **Controls hidden** until the mouse moves. The audience never sees setup buttons.
- **Offline:** stays up, with the footer saying "No connection. Showing the list as of 14:02."

---

## 4. Accessibility and access

### Contrast (WCAG 2.2 AA, computed by `tools/tokens.mjs`)

All 19 pairs pass in all 4 themes. For comparison, the current registration labels measure 1.7:1.

| Foreground on background | Use | Need | Light | Dark | Sun | TV |
|---|---|---|---|---|---|---|
| `ink` / `paper` | Primary text | 4.5 | 16.74 | 15.49 | 21.00 | 19.81 |
| `ink` / `paper2` | On raised | 4.5 | 15.31 | 14.00 | 18.76 | 17.61 |
| `ink` / `paper3` | On pressed | 4.5 | 13.57 | 12.07 | 15.91 | 15.33 |
| `ink2` / `paper` | Secondary | 4.5 | 8.90 | 9.63 | 17.04 | 14.05 |
| `ink2` / `paper2` | Secondary raised | 4.5 | 8.14 | 8.71 | 15.22 | 12.49 |
| `ink3` / `paper` | Labels | 4.5 | 5.40 | 6.32 | 12.63 | 9.25 |
| `ink3` / `paper2` | Labels raised | 4.5 | 4.94 | 5.71 | 11.29 | 8.22 |
| `onInk` / `ink` | Primary button | 4.5 | 16.74 | 15.49 | 21.00 | 19.81 |
| `pen` / `paper` | Results, links | 4.5 | 7.40 | 9.13 | 10.65 | 11.51 |
| `pen` / `paper2` | Results raised | 4.5 | 6.76 | 8.25 | 9.51 | 10.24 |
| `pen` / `penWash` | Selected row | 4.5 | 6.57 | 7.16 | 8.47 | 8.41 |
| `flag` / `paper` | Alert | 4.5 | 6.00 | 8.68 | 8.38 | 10.00 |
| `flag` / `flagWash` | Alert on wash | 4.5 | 5.40 | 7.35 | 6.80 | 7.89 |
| `go` / `paper` | Delivered | 4.5 | 6.51 | 9.79 | 10.39 | 12.77 |
| `go` / `goWash` | On wash | 4.5 | 5.94 | 7.57 | 8.61 | 9.20 |
| `wait` / `paper` | Waiting | 4.5 | 6.26 | 10.30 | 9.99 | 12.33 |
| `wait` / `waitWash` | On wash | 4.5 | 5.76 | 8.27 | 8.59 | 9.22 |
| `ruleStrong` / `paper` | Control borders (1.4.11) | 3 | 3.76 | 4.37 | 21.00 | 5.75 |
| `pen` / `paper` | Focus ring | 3 | 7.40 | 9.13 | 10.65 | 11.51 |

`rule` is decorative and intentionally low contrast. Nothing relies on it alone. Disabled controls are exempt from contrast but stay legible in the design. Piece squares carry a 1.5 px `ink` edge (15.5:1 or better) and always sit beside a word or fixed column.

### Focus and keyboard

2 px `pen` outline with offset, `:focus-visible` only, never removed. Table cursor uses both a wash and a 3 px left bar. Sticky bars must not hide focus (2.4.11): rows use `scroll-into-view` with `scroll-padding`. `<dialog>` for modals, so focus trapping comes free.

### Target sizes

| Surface | Minimum | Checked |
|---|---|---|
| Floor, Family | 44 px, primary 56–84 px | `tools/snap.mjs` audit: **no controls under 44 px** on phone screens at 390 and 360 (demo strip excluded). Today: 89 of 89 on the zone page |
| Desk | 24 px is the AA minimum (2.5.8); mockup uses 28–36 px for mouse | Same audit lists them. Below 960 px wide the desk switches to 44 px |
| Hall operator panel | 40 px, mouse only | |

### Reduced motion, colour, zoom

`prefers-reduced-motion` removes movement; the undo bar still shows through its countdown. Colour is never the only signal: results are text, status has words and solid or hollow shape, flagged rows have a chip and a bar. Text can double without losing content since rows grow instead of clipping. Check at 200% before each release.

### Screen reader semantics for pairing tables

Real `<table>`, `<caption>` explaining the layout, `<th scope="col">`, and `<th scope="row">` for the board number. Inside the mockup a row reads: "Board 14. White points 1½. White, Tan Zwischen Zug. White won. Black, Lim Gambit Ling. Black points 1." The cursor row has `aria-current`. Result saved and floor arrivals go through a polite live region; chief calls and disagreements use `role="alert"`. Standings cells carry hidden text such as "won against number 7 as Black". Floor rows are buttons with a full sentence label.

**Not tested with an actual screen reader.** NVDA and TalkBack passes are part of the plan.

### Sunlight, cheap Android, slow networks

- **Sunlight theme:** pure white and black (21:1), solid `rule`, heavier weights, one button. No auto-switching, since there's no reliable signal for it.
- **No effects:** no blur, gradients, shadows or animation loops, which also removes the current app's heaviest paint work.
- **Slow networks:** registration draft saved at each field, receipt shrunk on the device to about 200 KB, and retried in the background. Matchday cached with an "as of" time.

Not yet tested on a physical cheap Android outdoors. The `audit-mobile` and `emulator` folders exist, and an Android device (`R5CW2242D5J`) is noted in the handoff doc.

### Performance budget

Today (measured, uncompressed): main chunk 2,379,522 B, second chunk 455,620 B, `xlsx` 429,534 B, `pdf.worker` 1,375,838 B, CSS 113,099 B. Everything is eagerly imported by `main.tsx`, and a parent pays for the PDF designer.

| Route | JS (gzip) | CSS (gzip) | Font | Target |
|---|---|---|---|---|
| Floor `/t/:slug` | 60 KB | 8 KB | 90 KB | Usable < 2 s on Slow 4G, mid-low Android |
| Matchday, Register | 120 KB | 12 KB | 90 KB | Usable < 3 s on Slow 4G. Works from cache after first load |
| Landing | 40 KB | 12 KB | 90 KB | LCP < 2 s |
| Desk | No hard cap | 30 KB | 90 KB | Lazy-load `xlsx`, `pdf-lib`, `pdfjs`, certificates |

Enforce in CI with a small size check, plus Lighthouse at throttled settings on key routes.

### Language readiness

Today: no i18n, `lang="en"` hard-coded.

- **Bahasa Malaysia:** my test strings run about 20–40% longer. Register and matchday switch language live in the mockup (`register-390-1-who-bm.png`). Buttons stay full-width, `seg` buttons hold "Perempuan", nothing clips (checked by the overflow audit).
- **Chinese and Tamil:** matchday shows the four-question screen in both. Rules: `lang` attribute updated, uppercase labels and letter-spacing dropped under `:lang(zh, ta)`, line-height 1.5+ for Tamil. Avoid sentence assembly: colour in Tamil reads "Damia: வெள்ளை" to dodge grammar.
- **Colour words matter:** piece square plus word, and "P/H" rather than "W/B" initials if letters are ever used.
- **Mechanism:** a small typed dictionary per shell, participant only at first. No library until plurals force one. Result notation stays universal.

**All translations in the mockups are mine and for layout testing only.** They need review by native speakers before any release, Tamil especially.

---

## 5. Mockups

Open `index.html`. Self-contained, no network (the screenshot harness blocks and logs external requests: none). Light, dark, sunlight on every page; TV has its own dark and projector themes.

| File | Target | Run in Playwright at | What to try |
|---|---|---|---|
| `round.html` | Laptop | 1366, 1920, 390 | Keys, slip entry, Pull the Wi-Fi, settle a disagreement, full loop into round 5, print |
| `floor.html` | Phone | 390, 360 | PIN keypad, sheet, undo, forfeit confirm, chief, Go to board, sunlight, offline |
| `register.html` | Phone | 390, 1366 | Four steps with DuitNow and receipt, Bahasa Melayu |
| `matchday.html` | Phone | 390, 1366 | Search "puteri", states, four languages |
| `tv.html` | TV | 1366, 1920, 3840 | Arrows, `L`, mouse for controls |
| `landing.html` | All | 390, 1366, 1920 | Enter results in the hero, pull the Wi-Fi |

Reminder that the pairing logic in mocks is a toy that only exists to make screens move, and no mock talks to an API.

---

## 6. Implementation plan

### Principles

- **Replace `index.css` gradually, never in one change.** It's live, it's growing, and other agents are editing it.
- **Every step ships independently** and leaves production working.
- **Don't start during other agents' edits to the same files, or in the days before an event.**
- **URLs never change.** `/t/` is printed on stickers, `/live/` and `/register/` are shared in WhatsApp.

### Tooling, checked against what exists

No Tailwind, CSS-in-JS or component library exists. React 19, Vite 6, Vitest and plain CSS do.

| Choice | Why |
|---|---|
| **Plain CSS with custom properties and `@layer`** | Tokens already work this way; maps 1:1 to the mockups; no build dependency; a utility framework would add a second system on top of 6,300 lines during migration |
| **CSS Modules only for components with lots of states** (optional) | Already supported by Vite with no dependency |
| **Own small component set**, using native `<dialog>`, `<table>`, `<details>` | Tables and names are the product. A generic kit gives the look we're trying to leave and little else |
| **Inline SVG icons copied from Lucide** | About 15 glyphs, no runtime dependency |
| **`@playwright/test`** for visual regression | Not in `apps/web` yet; already proven by this audit's harness |
| **`axe-core`** in Playwright | Automated contrast and semantics checks |
| Typed dictionary for i18n | Under 1 KB. Add a library only when plurals demand it |

### Cascade plan for `index.css`

```css
@layer legacy, tokens, ui, shell;
@import "./index.css" layer(legacy);   /* wrap, no edits */
```

Anything in `tokens`, `ui` or `shell` beats legacy without specificity fights. Caveat: within layers, `!important` inverts, so the 28 legacy `!important` rules would beat new normal rules. Audit those 28 first. Once a shell has no legacy pages, it stops importing `index.css` entirely. That's how the file eventually dies: page by page, deleted when the last class is unused, with a coverage report to confirm.

### Safe for Electron: rules for every step

`apps/web` is also the desktop renderer, so:

- Keep the `HashRouter` and `base: './'` behaviour. All asset URLs relative.
- **Don't change the Dexie database name or schema, or the app origin.** `main.ts` keeps `file://` on purpose so existing IndexedDB and localStorage stay readable.
- Keep the `html.is-desktop` drag regions and reserve room for `titleBarOverlay` window controls in the new top bar. The new top bar must carry `-webkit-app-region` correctly on interactive items.
- Check `window.print()` and `<dialog>` in the packaged app.
- Desktop rollback means a new release through auto-update, so **a "Classic desk" flag ships for one release** alongside the new desk.
- Smoke test `pnpm run build:desktop` on Windows with an existing database before each organizer change.

### Sequence

Sizes are for one experienced engineer and are rough.

| # | Work | Size | Why now | Verify |
|---|---|---|---|---|
| 0 | **Baseline.** `@playwright/test`, fake-data fixtures, frozen clock, current screenshots at 360, 390, 1366, 1920. Critical bugs fixable today: registration label contrast (a one-line token fix), topbar overflow | 2–3 days | Everything depends on a safety net | Baseline stored; two runs identical |
| 1 | **Tokens and fonts.** Vendor Archivo, add `tokens.css`, `ui.css`, wrap legacy in a layer. Components: `PlayerName`, `Piece`, `Result`, `Button`, `StatusLine`, `PairingTable`. Storybook not needed: one `/__ui` dev route | 1 week | Everything reuses these | No change on existing pages except font; diffs reviewed by eye. Desktop smoke |
| 2 | **Shell split and code-splitting.** `shells/`, lazy routes, move Dexie gate into `OrganizerShell`, `returnTo` | 3–5 days | Biggest performance win, lets later steps be isolated. Coordinate with the architecture work | Parent route loads no Dexie, `pdf`, `xlsx` (network assertion). Existing users still see their data |
| 3 | **Floor `/t/:slug`.** Behind `?ui=2`, then on by default | 1 week | Smallest page, isolated, high value, mistakes are costly, no Electron risk. First proof of the system | Field test: one arbiter, real hall, cheap phone in daylight. Existing `floorZone` tests stay green, including 409 |
| 4 | **Matchday and Live**, `/live/:token`, then `/live/:token/p/:id` | 1 week | Every parent, every round. Fixes the wrong-child risk | Reduced search cases with similar names. TalkBack pass |
| 5 | **Hall screen** `/live/:token/tv` | 3–4 days | Quick and visible | Stand 10 m from a real 55-inch TV |
| 6 | **Register, Discover** | 1 week | Revenue path, depends on some API (below) | Kill the tab mid-flow on real Android; draft must survive |
| 7 | **Landing** | 3–4 days | Doesn't depend on anything; **can move earlier** if a trial push is coming | Lighthouse. Founder reviews every claim |
| 8 | **Round Desk.** Break up `TournamentPage.tsx` (3,619 lines) into phase components without changing data flow, then build the new layout beside the old with a flag | 3–4 weeks | Highest value, highest risk. Saved for last so the design system is proven. Never ship in the week before an event | Full-tournament run on a copy with both UIs; Playwright keyboard-only round; pairing engine tests; Electron smoke with an existing database; run a real small event |
| 9 | **Remaining desk.** Setup, Import, Check-in, Registrations queue, Certificates, Settings, Account, Admin | 2–3 weeks | Clean-up. Certificates designer can keep a neutral restyle | Delete `index.css` when coverage reaches zero |
| 10 | **Flutter tokens** | 2–3 days, if kept | Depends on the founder's web-first decision | Widget test, one device |

**Total: about 3–4 months for one engineer.** Steps 0–5 deliver most of what a parent and arbiter feel, in about 4–5 weeks.

### Flutter mapping

`alokas_tokens.dart` is a generated preview. Replace the `AlokasColors` forest and gold values in `lib/theme/alokas_theme.dart` with token names, and map:

| Flutter | Token |
|---|---|
| `scaffoldBackgroundColor`, `colorScheme.surface` | `paper` |
| `colorScheme.primary` / `onPrimary` | `ink` / `onInk` |
| `colorScheme.onSurface` | `ink` |
| `colorScheme.error` | `flag` |
| `dividerColor` | `rule` |
| `CardThemeData` | No fill, `rule` border, radius 3, or remove cards |
| `AlokasBadge` | Square chip, wash background |
| New `ThemeExtension` | `pen`, `go`, `wait`, `sun` theme |

Warning: screens hard-code a lot. I counted 241 references to `AlokasColors` and 202 raw `Color(...)` or `Colors.` uses across `lib/screens`, so a token swap alone leaves gaps. The theme currently has dark only. If parents launch on web first, do the swap and stop there.

### Visual regression at each step

1. `toHaveScreenshot` on fixed fake fixtures with frozen time and reduced motion, in Linux containers so rendering matches, at 360, 390, 1366 and 1920 for each theme.
2. Reuse the audits in `tools/snap.mjs`: no horizontal scroll, no name with `text-overflow: ellipsis` or past the viewport, phone targets ≥ 44 px, no external requests, no console errors.
3. `axe-core` on each route.
4. Bundle size check against the budget.
5. Human review of intentional diffs in the PR.

Fixtures must use invented names. **Do not use `sample-registrations-*.csv` or `scripts/arcc-*.json`.** Adding a CI workflow to the repo should be confirmed first.

### Design decisions that need product or API changes

| Design element | Need | Effort |
|---|---|---|
| **Publish step** | A per-round `published_at`, respected by floor, public live and TV. Today a generated round goes public at the next sync | Medium, migration |
| **Trial quota at import** | Warn at import, not after a sync, and connect it to what's public. Possibly raise the cap | Small, plus founder decision |
| **Honest sync state** | Sync returns per-record outcomes (exists as rejections); status never says "Synced" with any outstanding | Small, web |
| **Two results disagree** | Today the second submission gets `409` and is dropped. To show the conflict the API must keep the rejected attempt | Medium |
| **Who entered it, arbiter progress** | `arbiterName` exists on results; expose to desk | Small |
| **Connected floor phones** | Heartbeat or last-seen per arbiter session. Drop it if not worth it | Small |
| **Arbiter session across rounds** | Removes the per-round re-entry but weakens round rotation. Security decision | Small code |
| **Payment reference code** | Short per-registration code at creation, to match bank transfers | Small |
| **Registration status without an account** | Tokenised status link; upload receipt later (`pending_receipt` already exists) | Medium |
| **WhatsApp** | Mock says "we message you". Automatic WhatsApp is a paid API. Start with a `wa.me` link and organiser action, and soften the copy | Founder decision |
| **Shared round clock** | Today the clock lives inside each TV. Move to tournament state, set from the desk | Medium |
| **Local hall screen in Electron** | Second window from local data | Medium |
| **Public search shows school** | Disambiguation needs a second fact. Possibly use `#no · section` only | Privacy decision below |
| **Display-name casing** | Client-only function; certificates keep the original | Small |

### Decisions for the founder

1. **Direction:** Pairing Sheet, or the alternative?
2. **Floor saving:** one tap with 5-second undo (recommended, field test first), or tap and Confirm as today?
3. **Trial limit:** 24 players can't evaluate an event with 100+ players. Raise it, or offer one full event?
4. **Children's data:** showing a minor's name with school on a public search, and the current public roster with school. PDPA view needed; I'd default to `#no · section`.
5. **Parents:** web first, or Flutter? I agree with the architecture review: web first.
6. **Name display:** Title Case by default, or as entered?
7. **Publish step:** adds one action per round and a schema change. I recommend it.
8. **Landing copy:** every claim needs your sign-off, including "No card", and the trial wording. No prices or testimonials are included because none were provided.
