import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { trackPageView } from '../../lib/pageAnalytics';
import { Bishop, Crown, Knight, Pawn } from '../landing/pieces';
import {
  AccountPhone,
  CareerPhone,
  DiscoverPhone,
  MatchdayPhone,
  OfflinePhone,
  RegisterPhone,
} from './PhoneScreens';
import './mobile-app.css';

/*
 * Advert for the Chess Alokas app, for players of any age and for parents. Accuracy is a hard rule:
 * claim only what apps/mobile/lib really does. No following, feeds or public profiles, and never call
 * the product social (see docs/PLAN.md). No Alokas rating figure: it is 1000 for everyone today.
 * The app is in no store yet: no store badges or download links until it is. iOS has never been built
 * or tested, so don't promise it. No users, ratings, testimonials or prices. Sign-in is email only.
 */

const SITE = 'https://chess-manager.alokas.com/mobile-app';
const TITLE = 'Chess Alokas app: your chess life, in one app';
const DESCRIPTION =
  'Find your next tournament, register in a few taps, follow every round, and keep your results and certificates in one place. Coming soon to Android.';

function Soon({ className = '' }: { className?: string }) {
  return (
    <span className={`ma-soon ${className}`}>
      <Pawn side="w" className="ma-soon-pawn" />
      Coming soon to Android
    </span>
  );
}

function Today() {
  return (
    <Link className="ma-btn ma-btn-primary" to="/discover">
      Find a tournament on the web
    </Link>
  );
}

function Story({
  id,
  flip,
  title,
  phone,
  caption = 'Illustration with invented names.',
  children,
}: {
  id: string;
  flip?: boolean;
  title: string;
  phone: ReactNode;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section className={`ma-story${flip ? ' is-flip' : ''}`} aria-labelledby={`${id}-h`}>
      <div className="ma-wrap ma-story-in">
        <div className="ma-story-copy">
          <h2 id={`${id}-h`}>{title}</h2>
          {children}
        </div>
        <figure className="ma-fig">
          {phone}
          <figcaption>{caption}</figcaption>
        </figure>
      </div>
    </section>
  );
}

export default function MobileAppPage() {
  useEffect(() => {
    trackPageView({ routeKey: 'landing', path: '/mobile-app' });
    document.title = TITLE;
    // index.html holds the one description tag, so swap its text here and put it back on leaving.
    const tag = document.querySelector('meta[name="description"]');
    const before = tag?.getAttribute('content') ?? null;
    tag?.setAttribute('content', DESCRIPTION);
    return () => {
      if (before !== null) tag?.setAttribute('content', before);
    };
  }, []);

  return (
    <div className="ma">
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Chess Alokas" />
      <meta property="og:title" content={TITLE} />
      <meta property="og:description" content={DESCRIPTION} />
      <meta property="og:url" content={SITE} />
      <meta name="twitter:card" content="summary" />
      <link rel="canonical" href={SITE} />

      <Link className="ma-skip" to={{ hash: 'ma-main' }}>
        Skip to content
      </Link>

      <header className="ma-top">
        <div className="ma-wrap ma-top-in">
          <Link className="ma-mark" to="/">
            <Crown />
            Chess Alokas
          </Link>
          <nav aria-label="Main">
            <Link to="/discover">Find a tournament</Link>
            <Link to="/">For organizers</Link>
          </nav>
        </div>
      </header>

      <main id="ma-main">
        <section className="ma-hero" aria-labelledby="ma-h1">
          <div className="ma-wrap ma-hero-in">
            <div className="ma-hero-copy">
              <Soon />
              <h1 id="ma-h1">
                <span>Your chess life,</span> <span className="is-gold">in one app.</span>
              </h1>
              <p className="ma-sub">
                Find your next tournament, register in a few taps, follow every round, and keep your
                results and certificates in one place.
              </p>
              <div className="ma-cta">
                <Today />
              </div>
              <p className="ma-note">The app isn&apos;t in any store yet. Until it is, the website has you covered.</p>
            </div>
            <figure className="ma-hero-fig">
              <div className="ma-hero-phones">
                <div className="ma-back">
                  <MatchdayPhone />
                </div>
                <div className="ma-front">
                  <DiscoverPhone />
                </div>
                <div className="ma-hero-pieces" aria-hidden="true">
                  <Knight />
                  <Bishop />
                </div>
              </div>
              <figcaption>Illustrations with invented names.</figcaption>
            </figure>
          </div>
        </section>

        <Story id="ma-find" flip title="Find your next tournament." phone={<DiscoverPhone />}>
          <p>Search by name, city or venue. Turn on Near me to see events by distance from your phone.</p>
          <ul>
            <li>See events on a map</li>
            <li>Filter by section</li>
            <li>See the date, time control and entry fee</li>
          </ul>
        </Story>

        <Story id="ma-register" title="Register in a few taps." phone={<RegisterPhone />}>
          <p>Save your player profile once, and add your children if you have them. Then choose who&apos;s playing and send your entry.</p>
          <ul>
            <li>Register more than one player at a time</li>
            <li>The section is suggested from age, for you to check</li>
            <li>Leave halfway and your draft waits on the phone</li>
          </ul>
        </Story>

        <Story id="ma-receipt" flip title="Paid? Attach the receipt." phone={<AccountPhone />}>
          <p>See the organizer&apos;s payment details and QR, pay them directly, then add your receipt to the entry. A photo or PDF both work.</p>
          <ul>
            <li>Follow each entry, from pending to approved</li>
            <li>Your money goes to the organizer, not through the app</li>
          </ul>
        </Story>

        <Story id="ma-match" title="Follow every round." phone={<MatchdayPhone />}>
          <p>Your board, your colour and your opponent, on one card. The board panel is white if you play White, black if you play Black.</p>
          <ul>
            <li>See your score</li>
            <li>Switch players at the top of Matchday and Career</li>
            <li>An open Matchday updates by itself when new pairings are posted</li>
            <li>A high-contrast Sunlight display for bright venues</li>
            <li>If the organizer turns on the live page, also rank, earlier rounds, all pairings and full standings</li>
          </ul>
        </Story>

        <Story id="ma-career" flip title="Every tournament you've played." phone={<CareerPhone />}>
          <p>See your past tournaments with the date, your score, and your wins, draws and losses. Your certificates sit alongside them, ready to save as a PDF.</p>
          <ul>
            <li>Career totals across your events</li>
            <li>Played before you signed up? Claim your past entries when your confirmed email and name match</li>
          </ul>
        </Story>

        <Story id="ma-signal" title="Weak signal in the hall? Still there." phone={<OfflinePhone />}>
          <p>The app keeps events, players and rounds as last loaded, and tells you exactly how old they are. When the signal returns, tap Retry or pull to refresh.</p>
          <p className="ma-fine">It can only show what it has already loaded once, and new pairings wait for a connection.</p>
        </Story>

        <section className="ma-diff" aria-labelledby="ma-h-diff">
          <div className="ma-wrap">
            <h2 id="ma-h-diff">Two sides of the same tournament.</h2>
            <div className="ma-diff-grid">
              <article className="is-app">
                <h3>Chess Alokas app</h3>
                <p className="ma-diff-who">For players and parents. Android, coming soon.</p>
                <ul>
                  <li>Find and register for events</li>
                  <li>Follow every round</li>
                  <li>Keep results and certificates</li>
                </ul>
              </article>
              <article>
                <h3>Organizer tools</h3>
                <p className="ma-diff-who">For academies and arbiters. Web and desktop.</p>
                <ul>
                  <li>Take entries and approve receipts</li>
                  <li>Pair rounds and enter results</li>
                  <li>Run the venue TV and issue certificates</li>
                </ul>
                <p className="ma-diff-link">
                  <Link to="/">For organizers: see the tools</Link>
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="ma-final" aria-labelledby="ma-h-final">
          <Knight className="ma-final-knight" />
          <div className="ma-wrap">
            <Soon />
            <h2 id="ma-h-final">Don&apos;t wait for the app to find your next tournament.</h2>
            <div className="ma-cta">
              <Today />
            </div>
            <p className="ma-fine">
              Browsing needs no account. To register or see your rounds in the app, sign in with your
              email. Matchday works for players entered from a saved profile, once the organizer
              approves the entry.
            </p>
          </div>
        </section>
      </main>

      <footer className="ma-foot">
        <div className="ma-wrap ma-foot-in">
          <span className="ma-mark">
            <Crown />
            Chess Alokas
          </span>
          <nav aria-label="Footer">
            <Link to="/discover">Find a tournament</Link>
            <Link to="/">For organizers</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
