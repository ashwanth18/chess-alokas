# Chess Alokas: master plan

Last updated: 2026-11-01. This covers order and gaps. Details stay in `docs/design/DESIGN_PLAN.md`, `deploy/PIPELINE.md` and `docs/AGENT_HANDOFF.md`.

**Goal:** first paying organizer, then a public launch.

**The short answer to "do we need more plans?"**

- **Work plans: yes.** Design, auth and mobile are covered. Nobody is working on the things that let us take money and survive a bad event day (section 3).
- **Pricing plans: no.** Four tiers is the right number. Two are incomplete in code, and the trial can't evaluate a real event (section 4).

**How to read this:** "Checked" means read in the code or repo today, not run. Status of running work comes from the lead's brief. Dates count from today and assume the current agent pace, so they are estimates. Sizes: XS under 1 day, S 1-3 days, M about 1 week, L 2 weeks or more.

## 1. Workstreams

| # | Workstream | Status | Depends on | Size |
|---|---|---|---|---|
| A | Auth (email only) and staff invites | Running | Custom SMTP (founder) to work for real | M |
| B | Redesign foundation, steps 0-2 | Running | None | M |
| C | Landing page | Running | Founder signs off claims and prices | S |
| D | Flutter app | Running, tested on founder's phone | Production deploy, since its routes returned 404 on production (`apps/mobile/README.md`) | Ongoing |
| E | Production deploy with `028`, `029` | Queued | **Backup first**, then A | S |
| F | Floor, then Matchday/Live, then Hall TV | Queued | B | L (2-3 weeks) |
| G | Register, Discover | Queued | F, API items in design plan section 6 | M |
| H | Round Desk, remaining desk | Queued | F, G | L (5-7 weeks) |
| I | **Launch safety:** backups, CI, uptime | **Nobody** | Founder's Supabase paid plan | S-M |
| J | **Legal and consent** | **Nobody** | Legal review (founder) | S code, plus lawyer |
| K | **Selling:** plan expiry, pass fix, invoicing | **Nobody** | Founder's prices | S-M |
| L | **Pilot and support:** real event, runbook | **Nobody** | E, F (Floor), J | M |
| M | **Play Store release** | **Nobody** | Account deletion in app, icon, signing key | M, plus 2+ weeks of testing |

## 2. Order and what ships when

| Milestone | When (estimate) | What ships | Done when |
|---|---|---|---|
| **M0 Production is real** | Week 1 | Backup, `028`/`029`, then E. SMTP live. CI and uptime alert | Sign-in, token refresh, RLS, Storage and real email all pass on real Supabase. The handoff says none of these has been tested yet |
| **M1 Pilot ready** | Weeks 2-3 | J, new Floor, restore rehearsal, runbook, rating export if the pilot is rated | A friendly organizer agrees to a date |
| **M2 First paid event** | Weeks 4-6 | Pilot run free, K, Matchday/Live, Hall TV. Second event invoiced manually | One organizer has paid for a second event |
| **M3 Public launch** | Weeks 8-12 | Register, Discover, public landing with prices, abuse basics, Android if ready | Section 5 all true |
| **M4 After launch** | Week 12 on | Round Desk, remaining desk, online checkout, Bahasa Malaysia | Ongoing |

**Change to the queue I recommend:** run I, J and K beside Floor and Live, and don't let Round Desk gate selling. The current desk works, Round Desk is the riskiest step, and the design plan already forbids shipping it near an event.

**Freeze rule:** no production deploy in the 48 hours before a customer's event. A push to the watched branch deploys production, so this needs a named owner.

## 3. Gaps, ranked by what blocks a first paying customer

### Blocks taking money

| Rank | Gap | What's there today (checked) | Smallest thing that works | Size |
|---|---|---|---|---|
| 1 | **Backups and restore** | Nothing in `deploy/` for scheduled backups. Whether production is on a paid Supabase plan isn't verified | Paid plan (7-day daily backups). Nightly `pg_dump` to storage off the VPS and outside git. Copy Storage objects too, as database backups may not include them (verify). One restore rehearsal, timed. **Do this before `028`/`029`** | S |
| 2 | **Email deliverability** | Resend documented in `deploy/DOKPLOY.md`, not confirmed live. Handoff says real email is untested | Founder sets custom SMTP. SPF, DKIM and DMARC on the sending domain. Click tracking off for auth mail. Test signup, reset and invite to Gmail and a school address. Invites depend on this | XS code |
| 3 | **Privacy notice, terms, parental consent** | None exist. `player_profiles` holds date of birth, `national_id`, school, phone. No consent is recorded at registration | Notice and terms pages. Parent consent checkbox with timestamp and notice version saved on each registration and child profile. Organizer terms stating who controls the data. Drop `national_id` from forms unless a lawyer says it's needed. Decide public school display (design plan decision 4). PDPA regulations require a parent's consent for under-18s [1]. The lawyer should also confirm breach notification and DPO duties [2] | S code, plus lawyer |
| 4 | **Selling path** | No billing code. Prices nowhere. Passes are granted by hand in `/admin`. Plans never expire (section 4) | Price list, plan expiry and pass fix, then invoice and DuitNow or bank transfer, then founder clicks the admin button. **No payment gateway yet** | S-M |
| 5 | **Pilot event** | Never run end to end on production with the new stack | One real event, free, founder on site. Floor test on a cheap phone, as the design plan requires. Keep paper pairings or Swiss-Manager as fallback | M (mostly founder) |
| 6 | **Support and onboarding** | No support channel, guide or sample event | One WhatsApp number with a stated event-day promise. One-page organizer guide. Event-day runbook covering venue Wi-Fi loss, API down, wrong result, re-pair. Sample tournament on signup. No helpdesk | S |
| 7 | **CI, then staging** | Only `desktop-release.yml`. Web and API have no CI, yet a push deploys production. Four agents share this checkout | Now: GitHub Action on push running typecheck, all tests and `migrations.test.ts`. Founder approves the workflow. Then: a separate Supabase staging project and staging deploy, so later migrations are tried there first | S, then M |
| 8 | **Uptime alerts** | Sentry is wired. No outside uptime check. `deploy/docker-compose.yml` has no healthchecks | Free outside monitor on `/api/health` and the home page, alerting the founder's phone. Add Docker healthchecks. Test the alert once | XS |
| 9 | **Rating report export** | `trf.ts` exists inside the pairing engine for bbpPairings. No TRF export in web or API | Add a TRF download, if arbiters confirm they need it for FIDE or MCF rating reports. Ask the pilot arbiter first. A rated event may be unsellable without it | S |

### Needed for public launch, not for the first customer

| Rank | Gap | What's there today (checked) | Smallest thing that works | Size |
|---|---|---|---|---|
| 10 | **Account deletion and retention** | `DELETE /me` soft-deletes tournaments with that `owner_id` and deletes the auth user. Nothing purges soft-deleted rows. Registrations, receipts and participants remain. The Flutter app has no deletion | Hard-delete job after a grace period. Retention rule, for example receipts 12 months after the event (lawyer confirms). Handle orgs whose owner leaves. In-app deletion plus a public web page, which Google requires once the app can create accounts [3]. Build it regardless, because the web page is what parents will ask for | M |
| 11 | **Play Store release** | Release build uses the debug signing config (`build.gradle.kts`). App can't create accounts. No store listing | Upload key, icon, data safety form, closed test. A new personal account needs 12 testers for 14 days; organization accounts are exempt [4]. **Android only.** Parents can use web until then, so this doesn't block sales | M |
| 12 | **Abuse** | Public routes have rate limits (in memory). Publishing and paid registration need admin verification. No signup captcha | Turnstile on signup through Supabase, a "report this event" link, and a written rule for suspending fake events (suspend exists). Fake events collecting DuitNow from parents are the real risk, and verification already covers them | S |
| 13 | **Bahasa Malaysia** | No i18n. MCF's announcements I read are in English, so organizers can start in English | Not needed for launch. **Do one cheap thing now:** new parent and floor pages put strings in the typed dictionary. Translate Register, Matchday and Floor after launch, and have a person review it | XS now, S later |

### Dropped for now

Payment gateway and self-serve checkout (until about 10 paying customers). Monthly billing. Holding or taking a cut of entry fees. iOS release. Status page, helpdesk, live chat. WhatsApp API. Self-hosted Supabase. Team events and round robin stay unsold: the code has no team pairing and round robin says "coming soon", so the landing page must not claim them. This does limit the market, as MCF runs team events.

## 4. Pricing

### What the code does today (checked)

| Tier | Limits | Email per 24h | Gaps |
|---|---|---|---|
| **Trial** | 1 active tournament, 24 players, 14 days for orgs. No global publishing or entry fees | 5 test, no bulk | Accounts with no org get the same limits but **no expiry** |
| **Event Pass** | 150 players per tournament, 1 credit | 50 test, 500 bulk | See below |
| **Pro** | No limits | 50 test, 2,000 bulk | **No expiry field**, so a purchase lasts forever |
| **Enterprise** | No limits | 50 test, 5,000 bulk | Same as Pro apart from email. No admin button |

**The Event Pass isn't really one event:**

- The credit is charged only on first global publish (`routes/registrations.ts`). Private events and shareable registration links never use it.
- `maxTournamentsQuota: 3` is enforced only for trials (`db.ts`), despite what the feature doc implies.
- The tier has no end date, so one sale gives unlimited unpublished 150-player events forever.

`028` also backfills older no-org owners onto `pro`, unverified. That's unlimited players at no charge, though bulk email stays off. Count these accounts at deploy.

### Can the 24-player trial evaluate a real event? No.

- NYCC 2026 caps **each** age and gender group at 128 players [5]. Its U18 section lists 28 players, so one small section already exceeds the cap [6].
- The one event file in this repo has 33 players.
- A trial also can't set an entry fee, so the revenue path can't be tried at all.

But raising the cap for everyone gives away small club events, which are the likely paying market.

### Recommendation: keep four tiers, fix them, add a free first event

Prices are **my estimates to test with the first five organizers**, not market findings.

| Offer | Who | Limits | Price (estimate) |
|---|---|---|---|
| **Sandbox** (trial) | Anyone trying it | Keep 1 tournament, 24 players. Warn at import | Free |
| **First event free** | Newly verified organizer | One Event Pass credit. **Not a new tier**: the admin grants a pass at RM0, once per org | Free |
| **Event Pass** | Occasional organizers, schools | 1 event, 150 players, entry fees, global publishing | **RM199** per event |
| **Pro** | Academies, repeat organizers, events over 150 | Unlimited for a year | **RM1,200** per year |
| **Enterprise** | Federations, state bodies | Not on the price page. Don't build more | By quote |
| Parents and players | Everyone | No plan | Free |

**Why:**

- **Free first event** means a real evaluation, and verification gives the founder a sales conversation. It needs almost no new code.
- **RM199 is small against event income.** NYCC charges RM65 per player [5], so 150 players at that rate gross about RM9,750 and the pass is about 2%, or just over three entries. The RM65 fee is one national event, so check it against club events.
- **Pro breaks even at six events.** Monthly academies save money, and one-off organizers don't need a subscription.
- **Competitors set a low ceiling for pairing alone.** ChessManager Premium is US$97 a year, about RM400 at an assumed rate, and includes entry fee collection [7]. Swiss-Manager has been listed at €150, an old figure [8]. Pro costs more, so sell floor scoring, live parent view, certificates and DuitNow registration rather than pairing. I found no Malaysian SaaS competitor, but the search was brief.
- **No share of entry fees.** Organizers keep receiving DuitNow directly, so we hold nobody's money.
- **When checkout comes**, Billplz's free plan costs RM1.25 per FPX payment, and 1.5% for DuitNow QR [9]. Both are negligible on these prices.

**Email caps:** keep them, as abuse limits rather than selling points. Before selling Pro, check that the Resend plan covers 2,000 a day (not verified).

### Code changes this needs (workstream K)

1. Charge the credit when a tournament first passes 24 players, opens registration, or publishes, whichever comes first.
2. End a pass 30 days after the event's last round. The org returns to Sandbox limits with data kept and readable.
3. Add `plan_ends_at` for Pro. **Never cut off a tournament in progress.**
4. Give no-org accounts the same expiry as trial orgs, or require an org for organizers.
5. Add a "First event free" admin action and a record of who granted what, when and against which invoice.
6. Show remaining credits and the plan end date on the organizer's account page.

## 5. Exit criteria for public launch

- [ ] A real paid event has run on production, with no data loss and every result correct against arbiter records
- [ ] Sign-in, invites, RLS, Storage and email pass on real Supabase
- [ ] Restore rehearsed from backup, with the time recorded; backups running and off the VPS
- [ ] Privacy notice, terms and parental consent live, and reviewed by a lawyer
- [ ] Account deletion works, including purge, and the retention rule is published
- [ ] Prices public; plan expiry and the pass fix live; first invoice issued
- [ ] CI required before deploy; freeze rule followed
- [ ] Uptime alert tested on the founder's phone
- [ ] Support number, organizer guide and event-day runbook live
- [ ] New Floor, Matchday/Live, Hall TV and Register shipped. Round Desk **not** required
- [ ] Every landing page claim true and signed off by the founder
- [ ] Windows installer signed, or the landing page explains the warning

Android in the Play Store is wanted but isn't a gate, because parents can use web.

## 6. Founder checklist

**This week (blocks M0):**

- [ ] Supabase paid plan: Pro is US$25 a month with 7-day backups [10]. Then confirm the backup exists
- [ ] Custom SMTP: Resend account, verified domain, keys entered in Supabase by you
- [ ] Approve adding a CI workflow

**Next two weeks (blocks M1, M2):**

- [ ] Legal review: notice, terms, parental consent, retention, `national_id`, DPO and breach duties
- [ ] Find a pilot organizer and date, using the MCF calendar
- [ ] Answer: does the pilot arbiter need TRF for rating reports?
- [ ] Set prices. Decide what entity invoices (SSM, bank account), and ask an accountant about tax and e-invoicing
- [ ] Choose a support WhatsApp number and event-day hours
- [ ] Answer design plan decisions: 2 (floor saving), 4 (children's data), 6 (name display), 7 (publish step), 8 (landing copy)

**Before M3:**

- [ ] App icon, for desktop and Flutter
- [ ] Windows signing certificate. Get quotes; I expect a few hundred US dollars a year (estimate)
- [ ] Play Store account, US$25 one-time per a secondary source [4]. Choose organization (needs a registered entity, no tester rule) or personal (recruit 12 testers). Keep the upload key out of the repo

## Sources

Fees and legal points come from these pages on 2026-11-01. Legal items are secondary sources for the lawyer to confirm, not legal advice.

1. [Linklaters, Data Protected: Malaysia](https://www.linklaters.com/en/insights/data-protected/data-protected---malaysia), under-18 consent. I did not check whether the 2024 amendments changed this.
2. [Baker McKenzie on the 2024 PDPA amendment](https://insightplus.bakermckenzie.com/bm/data-technology/malaysia-personal-data-protection-amendment-act-2024-to-come-into-force); [Sidley summary](https://datamatters.sidley.com/2024/08/07/important-changes-to-malaysias-data-protection-laws/)
3. [Google Play, account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
4. [Google Play, testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB); [dev.to on the 12-tester rule and fee](https://dev.to/theionproject/the-12-tester-rule-that-quietly-adds-two-weeks-to-your-first-google-play-launch-4bp3)
5. [MCF NYCC 2026 prospectus](https://malaysiachess.org/wp-content/uploads/2026/01/UTP-MCF-NYCC2026-Prospectus-1.pdf)
6. [Chess-Results, NYCC 2026 U18](https://s3.chess-results.com/tnr1346597.aspx)
7. [ChessManager pricing](https://www.chessmanager.com/en-ca/pricing), from a search result. The page refused a direct fetch.
8. [Swiss-Manager help document](https://www.scribd.com/document/434968904/swissmanagerhelp-eng-pdf), likely out of date
9. [Billplz pricing](https://main.billplz.com/pricing)
10. [Supabase pricing](https://supabase.com/pricing)
