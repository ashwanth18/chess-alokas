import { useEffect, type MouseEvent } from 'react';
import { preload } from 'react-dom';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import frauncesUrl from '../design/fonts/fraunces-latin-opsz-normal.woff2?url';
import sourceSansUrl from '../design/fonts/source-sans-3-latin-wght-normal.woff2?url';
import { trackPageView } from '../lib/pageAnalytics';
import Downloads from './landing/Downloads';
import { BishopLine, KingLine, Knight, PawnLine } from './landing/pieces';
import {
  CertificateVisual,
  FloorVisual,
  Mark,
  PairingSheet,
  ParentVisual,
  RegistrationQueue,
  StandingsSheet,
  TvVisual,
} from './landing/visuals';
import './landing/landing.css';

/*
 * Accuracy is a hard rule on this page: every claim must be true of the code. Do not add
 * testimonials, customer counts, logos, prices, endorsements, WhatsApp automation or a payment
 * gateway. Sign-in is described as email only. Illustrations use invented names.
 */

const SITE = 'https://chess-manager.alokas.com/';
const TITLE = 'Chess Alokas: chess tournament software for organizers, arbiters and parents';
const DESCRIPTION =
  'Swiss and FIDE Dutch pairings, floor result entry by PIN and QR, DuitNow receipt approval, live pages for parents, venue TV and certificates. The desk keeps working when the Wi-Fi drops.';

const STRUCTURED_DATA = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Chess Alokas',
  url: SITE,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, Windows, macOS, Linux',
  description: DESCRIPTION,
});

const NAV = [
  { href: '#round', label: 'How a round runs' },
  { href: '#offline', label: 'Offline' },
  { href: '#pricing', label: 'Trial' },
  { href: '#download', label: 'Download' },
  { href: '#faq', label: 'FAQ' },
];

const ROLES = [
  {
    Icon: KingLine,
    who: 'Organizers and academies',
    body: 'Set up categories, take entries, pair rounds and finish with standings and certificates, from one desk. Your staff join your academy on their own accounts.',
    items: ['CSV and Excel import', 'Online registration', 'Roll call', 'Certificates'],
  },
  {
    Icon: BishopLine,
    who: 'Arbiters',
    body: 'Scan the sticker on the table, enter the round PIN and score from your phone. Cover one board or a whole zone, and call the chief when something needs a decision.',
    items: ['No account needed', 'One PIN per round', 'Zone view', 'Keeps results if Wi-Fi drops'],
  },
  {
    Icon: PawnLine,
    who: 'Parents and players',
    body: 'Open the link from the organizer and search for your child. Board, colour, opponent and standings are on the phone you already have.',
    items: ['No app to install', 'No account for the live page', 'Family profiles if you want them'],
  },
];

const STEPS = [
  {
    who: 'Desk',
    title: 'Build the field',
    body: 'Import a CSV or Excel file and map its columns, add players by hand, or approve online registrations. Categories filter on age, gender or rating, so players land in the right section.',
  },
  {
    who: 'Desk',
    title: 'Call the roll',
    body: 'Check players in as they arrive. One action marks everyone still unchecked as absent for round 1, so no-shows are not paired.',
  },
  {
    who: 'Desk',
    title: 'Pair the round',
    body: 'Generate the round, category by category. Boards are numbered, byes are assigned, and a new floor PIN is issued for arbiters.',
  },
  {
    who: 'Floor',
    title: 'Play and score',
    body: 'Arbiters enter results from their phones and log warnings and illegal moves. The director can enter any result at the desk too.',
  },
  {
    who: 'Hall',
    title: 'Keep everyone informed',
    body: 'Results reach the public live page and the venue TV as they sync, so people can check their board without coming to the desk.',
  },
  {
    who: 'Desk',
    title: 'Confirm and move on',
    body: 'Confirm the round to lock its results, check the standings against your tiebreak order, and pair the next one. After the last round, go to certificates.',
  },
];

const TIEBREAKS = [
  'Buchholz',
  'Buchholz Cut-1',
  'Sonneborn-Berger',
  'Progressive',
  'Direct encounter',
  'Wins',
  'Rating',
  'Seed',
];

const FLOOR_FACTS = [
  ['QR stickers', 'Download a PDF of stickers, one per table. A scan opens that board.'],
  ['One PIN per round', 'A six-digit PIN unlocks every board for that round. Changing the PIN ends older sessions.'],
  ['Single board or zone', 'Switch to the zone view to score all boards, a range such as 1 to 15, or only the pending ones.'],
  ['First result stands', 'If two arbiters score the same board, the second is refused and told so. The director can still make a correction.'],
  ['Call the chief', 'One tap sends an illegal move dispute, clock problem, missing player or a custom note to a banner on the desk.'],
  ['Wi-Fi drops', 'A result confirmed with no connection stays on the phone and sends itself when the connection returns.'],
];

const OFFLINE_ROWS = [
  {
    who: 'Director, in the browser',
    works: 'Reopening the app, editing players, built-in Swiss pairing, entering results, confirming rounds, standings.',
    waits: 'FIDE Dutch pairing, floor PINs, QR stickers and sync.',
  },
  {
    who: 'Director, desktop app',
    works: 'All of the above, plus FIDE Dutch pairing on Windows and Linux, and automatic local backups.',
    waits: 'Floor PINs, QR stickers and sync. FIDE Dutch pairing on macOS, where there is no local engine.',
  },
  {
    who: 'Floor arbiter',
    works: 'Entering results once the page is unlocked. They are kept on the phone and sent automatically later.',
    waits: 'The first PIN unlock, and delivery of results to the desk.',
  },
  {
    who: 'Parents and venue TV',
    works: 'What is already on screen stays there. The parent page says it has no internet.',
    waits: 'Anything newer. These pages read from the cloud, so they need a connection, and the desk needs to have synced.',
  },
];

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: 'What actually happens if the Wi-Fi drops mid-round?',
    a: 'The desk carries on: results, confirmations and standings are saved on the device. Floor phones hold their results and send them when they reconnect. The live page and TV stop updating until both the desk and the cloud can talk again. When two devices have changed the same record offline, the most recent change wins, except that a result locked by a floor arbiter can only be replaced by a director.',
  },
  {
    q: 'Do I need to be online at all?',
    a: 'Yes, at least once. Each device must sign in online before it can reopen offline. FIDE Dutch pairing in the browser, floor PINs, QR stickers and the public pages also need a connection.',
  },
  {
    q: 'What does it cost?',
    a: (
      <>
        The trial is free and sign-up does not ask for a card. It allows one tournament and up to 24
        players, and new tournaments can be started for 14 days. Larger events, public listing and
        paid entries need your academy to be verified by our team. See{' '}
        <a href="#pricing">trial and verification</a>.
      </>
    ),
  },
  {
    q: 'Is Chess Alokas endorsed by FIDE?',
    a: 'No. FIDE Dutch rounds use bbpPairings, a separate Dutch-system pairing program. Chess Alokas itself has no FIDE endorsement. Check your federation’s requirements before using it for a rated event, and note that it does not currently export TRF tournament reports.',
  },
  {
    q: 'Which formats are supported?',
    a: 'Swiss, using the built-in engine, and FIDE Dutch Swiss, using bbpPairings. Round robin is planned and not available yet.',
  },
  {
    q: 'Does it take payments or send WhatsApp messages?',
    a: 'No to both. There is no payment gateway: parents pay your academy directly by DuitNow or bank transfer and upload the receipt for you to approve. There is no WhatsApp automation either, but live and registration pages are ordinary links you can share anywhere.',
  },
  {
    q: 'Can I print pairings and standings?',
    a: 'Not from the app yet. QR stickers and certificates download as PDF files you can print. Pairings and standings are on screen, on the live page and on the venue TV.',
  },
  {
    q: 'Do parents or arbiters need an account?',
    a: 'Not for the live page, and not for floor scoring, which uses the sticker and round PIN. Parents can register a child without an account too. An account adds saved family profiles, a matchday card, tournament history and certificates.',
  },
  {
    q: 'How do I sign in?',
    a: 'With your email address, using a password or a code sent to your email. The website and the desktop app use the same account.',
  },
  {
    q: 'Where is my tournament data kept?',
    a: 'On your device, in the browser’s local database or the desktop app, with a copy in the Chess Alokas cloud when you sync. Public live pages show player names, so turn them on only when you are ready to share them. Desktop backups are not encrypted, so treat exported files as personal data.',
  },
  {
    q: 'Which languages does it support?',
    a: 'English only today.',
  },
];

function closeMenu(e: MouseEvent<HTMLElement>) {
  if ((e.target as HTMLElement).closest('a')) {
    e.currentTarget.closest('details')?.removeAttribute('open');
  }
}

export default function LandingPage() {
  const auth = useAuth();
  preload(frauncesUrl, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  preload(sourceSansUrl, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });

  useEffect(() => {
    trackPageView({ routeKey: 'landing', path: '/' });
    document.title = TITLE;
  }, []);

  const signedIn = Boolean(auth.user);
  const primaryTo = signedIn ? '/app' : '/signup';
  const trialTo = signedIn ? '/app' : '/signup?role=organizer';
  const primaryLabel = signedIn ? 'Open the app' : 'Start a trial tournament';

  return (
    <div className="lp">
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Chess Alokas" />
      <meta property="og:title" content={TITLE} />
      <meta property="og:description" content={DESCRIPTION} />
      <meta property="og:url" content={SITE} />
      <meta name="twitter:card" content="summary" />
      <link rel="canonical" href={SITE} />
      <script type="application/ld+json">{STRUCTURED_DATA}</script>

      <a className="lp-skip" href="#lp-main">
        Skip to content
      </a>

      <header className="lp-top">
        <div className="lp-wrap lp-top-in">
          <a className="lp-mark" href="#lp-main" aria-label="Chess Alokas, top of page">
            <Mark />
            Chess Alokas
          </a>
          <nav className="lp-nav" aria-label="Page sections">
            {NAV.map((n) => (
              <a key={n.href} href={n.href}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="lp-top-act">
            <Link className="lp-toplink lp-hide-xs" to="/discover">
              Find a tournament
            </Link>
            {signedIn ? null : (
              <Link className="lp-toplink" to="/login">
                Sign in
              </Link>
            )}
            <Link className="lp-btn lp-btn-sm lp-btn-primary lp-hide-xs" to={primaryTo}>
              {signedIn ? 'Open the app' : 'Create account'}
            </Link>
            <details className="lp-menu">
              <summary>Menu</summary>
              <nav aria-label="Page sections, menu" onClick={closeMenu}>
                {NAV.map((n) => (
                  <a key={n.href} href={n.href}>
                    {n.label}
                  </a>
                ))}
                <Link to="/discover">Find a tournament</Link>
                <Link to={primaryTo}>{signedIn ? 'Open the app' : 'Create account'}</Link>
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main id="lp-main">
        <section className="lp-hero" aria-labelledby="lp-h1">
          <div className="lp-wrap">
            <div className="lp-hero-grid">
              <div className="lp-hero-copy">
                <h1 id="lp-h1">
                  Run the whole hall <span className="lp-gold">from a folding table.</span>
                </h1>
                <p className="lp-hero-sub">
                  Chess Alokas is tournament software for organizers, arbiters and parents. Pair
                  rounds, take results from the floor on phones, put the sheet on the venue TV, and
                  keep working at the desk when the Wi-Fi gives up.
                </p>
                <div className="lp-cta">
                  <Link className="lp-btn lp-btn-primary" to={trialTo}>
                    {primaryLabel}
                  </Link>
                  <a className="lp-btn" href="#round">
                    See how a round runs
                  </a>
                </div>
                <p className="lp-small">
                  Free trial: one tournament, up to 24 players. Sign-up asks for no card.
                </p>
                <p className="lp-small lp-hero-parent">
                  Here for your child&apos;s tournament?{' '}
                  <Link to="/discover">Find the event</Link>, or open the link your organizer sent.
                </p>
              </div>
              <PairingSheet />
            </div>
          </div>
        </section>

        <section className="lp-band" id="who" aria-labelledby="lp-h-who">
          <div className="lp-wrap">
            <h2 id="lp-h-who">Three jobs on tournament day. One system.</h2>
            <div className="lp-roles">
              {ROLES.map((r) => (
                <article key={r.who} className="lp-role">
                  <h3>
                    <r.Icon className="lp-role-icon" />
                    {r.who}
                  </h3>
                  <p>{r.body}</p>
                  <ul>
                    {r.items.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-band" id="round" aria-labelledby="lp-h-round">
          <div className="lp-wrap lp-split lp-split-5-7">
            <div className="lp-stick">
              <h2 id="lp-h-round">One round, start to finish.</h2>
              <p className="lp-lede">
                The same steps carry the whole event. Late entries and corrections fit in between, and
                every phase stays within reach.
              </p>
            </div>
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="lp-step-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                  <span className="lp-step-who">{s.who}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-band lp-invert" id="pairing" aria-labelledby="lp-h-pairing">
          <div className="lp-wrap lp-split lp-split-6-6">
            <div>
              <h2 id="lp-h-pairing">Pairings you can defend.</h2>
              <p className="lp-lede">
                Choose the system when you create the tournament. FIDE Dutch Swiss rounds come from
                bbpPairings v6, the Dutch-system pairing program, written to the 2025 Dutch rules in
                the FIDE handbook that took effect in 2026.
              </p>
              <dl className="lp-facts">
                <div>
                  <dt>FIDE Dutch Swiss</dt>
                  <dd>
                    bbpPairings. In the browser it runs on our server, so it needs a connection. The
                    Windows and Linux desktop apps carry it locally.
                  </dd>
                </div>
                <div>
                  <dt>Swiss</dt>
                  <dd>
                    Our built-in engine with score groups, rematch avoidance, colour balance and
                    byes. It runs on your device, online or off.
                  </dd>
                </div>
                <div>
                  <dt>Absences</dt>
                  <dd>Mark a player absent for a round, or withdrawn from a round onward, and pairing leaves them out.</dd>
                </div>
                <div>
                  <dt>Round robin</dt>
                  <dd>Planned, not available yet.</dd>
                </div>
              </dl>
            </div>
            <div>
              <StandingsSheet />
              <h3 className="lp-tb-h">Tiebreaks, in the order you set</h3>
              <p className="lp-tb-p">
                Score always comes first. After that, reorder these for each tournament:
              </p>
              <ol className="lp-tb">
                {TIEBREAKS.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="lp-band" id="floor" aria-labelledby="lp-h-floor">
          <div className="lp-wrap">
            <h2 id="lp-h-floor">A sticker on every table. A PIN for every round.</h2>
            <div className="lp-split lp-split-6-6 lp-split-gap">
              <FloorVisual />
              <dl className="lp-facts">
                {FLOOR_FACTS.map(([t, d]) => (
                  <div key={t}>
                    <dt>{t}</dt>
                    <dd>{d}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section className="lp-band" id="offline" aria-labelledby="lp-h-offline">
          <div className="lp-wrap">
            <h2 id="lp-h-offline">When the Wi-Fi drops, the desk keeps going.</h2>
            <p className="lp-lede">
              Offline-first means the tournament lives on your device and the cloud holds a copy.
              Sign in online once on each device, then the app reopens without internet. Here is
              exactly what works and what waits.
            </p>
            <table className="lp-off">
              <caption className="lp-vh">What keeps working without a connection, by role.</caption>
              <thead>
                <tr>
                  <th scope="col">If you are</th>
                  <th scope="col">
                    <i className="lp-dot lp-dot-go" aria-hidden="true" />
                    Still works
                  </th>
                  <th scope="col">
                    <i className="lp-dot lp-dot-hollow lp-dot-wait" aria-hidden="true" />
                    Waits for a connection
                  </th>
                </tr>
              </thead>
              <tbody>
                {OFFLINE_ROWS.map((r) => (
                  <tr key={r.who}>
                    <th scope="row">{r.who}</th>
                    <td data-label="Still works">{r.works}</td>
                    <td data-label="Waits for a connection">{r.waits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="lp-note">
              <strong>Worth knowing:</strong> floor phones, the desk and the public pages reach each
              other through the cloud. With no internet at the venue, each keeps its own work and
              they catch up when the connection returns. Have one person ready to enter results at
              the desk.
            </p>
          </div>
        </section>

        <section className="lp-band" id="registration" aria-labelledby="lp-h-reg">
          <div className="lp-wrap">
            <h2 id="lp-h-reg">Entries by link. Payment by DuitNow receipt.</h2>
            <div className="lp-split lp-split-7-5 lp-split-gap">
              <div>
                <RegistrationQueue />
              </div>
              <div>
                <p className="lp-lede lp-lede-top">
                  Share your registration link. Parents fill in the form, pay your academy using your
                  DuitNow QR or bank details, and attach the receipt. You check it and approve, and
                  the player joins the roster in the right category.
                </p>
                <ul className="lp-list">
                  <li>Money goes straight to you. Chess Alokas has no payment gateway and holds no funds.</li>
                  <li>Approve, waitlist or reject, one at a time, or approve all pending.</li>
                  <li>Likely duplicate entries are flagged for you to check.</li>
                  <li>Parents with an account fill the form from a saved profile and can register siblings quickly.</li>
                  <li>Paid entries and listing on Find a tournament need a verified academy.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-band" id="live" aria-labelledby="lp-h-live">
          <div className="lp-wrap">
            <h2 id="lp-h-live">The sheet, on every phone and on the wall.</h2>
            <div className="lp-live">
              <div className="lp-live-tv">
                <TvVisual />
                <h3>Venue TV and projector</h3>
                <p>
                  Open TV mode on any screen with a browser. It shows 12 boards a page and rotates
                  pairings and category standings every 10 seconds, or holds on either one. A round
                  clock runs from 15, 25, 30 or 60 minute presets.
                </p>
              </div>
              <div className="lp-live-ph">
                <ParentVisual />
                <h3>Live page for parents</h3>
                <p>
                  One link, no app and no account. Search a name, star your child to keep them handy,
                  and see the board, colour, opponent and standings. If the connection drops, the
                  page says so.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-band" id="certificates" aria-labelledby="lp-h-cert">
          <div className="lp-wrap lp-split lp-split-6-6">
            <CertificateVisual />
            <div>
              <h2 id="lp-h-cert">Certificates, straight from the standings.</h2>
              <p className="lp-lede">
                Upload your own PDF template, place the fields once and save the layout. Names and
                ranks come from the tournament, so nobody retypes them.
              </p>
              <ul className="lp-list">
                <li>Download a print pack for the people you select.</li>
                <li>Issue digital copies with serial numbers.</li>
                <li>Email them to players. Bulk email needs a verified academy.</li>
                <li>Players with an account find theirs in the portal when their confirmed email matches.</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="lp-band" id="team" aria-labelledby="lp-h-team">
          <div className="lp-wrap lp-split lp-split-5-7">
            <div>
              <h2 id="lp-h-team">Bring your team.</h2>
              <p className="lp-lede">
                Owners and admins invite staff by email and give each person a role. Invitations
                expire and can be revoked, and nobody can hand out a role above their own.
              </p>
            </div>
            <dl className="lp-roles-t">
              <div>
                <dt>Owner</dt>
                <dd>Holds the academy and manages the team.</dd>
              </div>
              <div>
                <dt>Admin</dt>
                <dd>Manages the team and academy details.</dd>
              </div>
              <div>
                <dt>Director</dt>
                <dd>Runs the academy&apos;s tournaments.</dd>
              </div>
              <div>
                <dt>Arbiter</dt>
                <dd>Works the floor as part of your staff.</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="lp-band" id="pricing" aria-labelledby="lp-h-pricing">
          <div className="lp-wrap lp-split lp-split-5-7">
            <div>
              <h2 id="lp-h-pricing">Start on a trial.</h2>
              <p className="lp-lede">
                Every new academy starts on a trial while our team reviews it. Verification unlocks
                the rest.
              </p>
            </div>
            <table className="lp-plan">
              <caption className="lp-vh">What the trial and a verified academy allow.</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="lp-vh">Feature</span>
                  </th>
                  <th scope="col">Trial</th>
                  <th scope="col">Verified academy</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Players per tournament</th>
                  <td>Up to 24</td>
                  <td>More, by plan</td>
                </tr>
                <tr>
                  <th scope="row">Tournaments</th>
                  <td>1 active, started within 14 days</td>
                  <td>More, by plan</td>
                </tr>
                <tr>
                  <th scope="row">Listing on Find a tournament</th>
                  <td>No</td>
                  <td>Yes, by plan</td>
                </tr>
                <tr>
                  <th scope="row">Paid entries</th>
                  <td>No</td>
                  <td>Yes</td>
                </tr>
                <tr>
                  <th scope="row">Bulk certificate email</th>
                  <td>No</td>
                  <td>Yes</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <Downloads />

        <section className="lp-band" id="faq" aria-labelledby="lp-h-faq">
          <div className="lp-wrap lp-split lp-split-5-7">
            <h2 id="lp-h-faq">Straight answers.</h2>
            <div className="lp-faq">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <div className="lp-faq-a">{f.a}</div>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-band lp-invert lp-final" aria-labelledby="lp-h-final">
          <Knight className="lp-final-knight" />
          <div className="lp-wrap">
            <h2 id="lp-h-final">Run your next event from the sheet, not a spreadsheet.</h2>
            <div className="lp-cta">
              <Link className="lp-btn lp-btn-primary" to={trialTo}>
                {primaryLabel}
              </Link>
              <Link className="lp-btn" to="/discover">
                Find a tournament
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <span className="lp-mark">
            <Mark />
            Chess Alokas
          </span>
          <span>Built in Malaysia.</span>
          <nav aria-label="Footer">
            <Link to="/discover">Find a tournament</Link>
            <a href="#download">Downloads</a>
            <Link to="/login">Sign in</Link>
            <Link to="/signup">Create account</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
