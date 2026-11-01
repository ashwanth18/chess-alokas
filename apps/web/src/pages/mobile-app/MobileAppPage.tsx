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
  StandingPhone,
} from './PhoneScreens';
import './mobile-app.css';

/*
 * Advert for the family app. Accuracy is a hard rule: claim only what apps/mobile/lib really does.
 * The app is in no store yet: no store badges or download links until it is. iOS has never been built
 * or tested, so don't promise it. No users, ratings, testimonials or prices. Sign-in is email only.
 */

const SITE = 'https://chess-manager.alokas.com/mobile-app';
const TITLE = 'Chess Alokas family app: your child’s board, colour and opponent';
const DESCRIPTION =
  'A chess tournament app for parents and players. Find events, register your children, attach the payment receipt, and follow every round. Coming soon to Android.';

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

const MATCH_FACTS = [
  ['Which board', 'The number, in big type at the top of the card.'],
  ['What colour', 'The card is white if they play White, black if they play Black.'],
  ['Who against', 'The name and section of the player opposite, and their rating if listed.'],
  ['How they’re doing', 'Score, earlier rounds and, where shared, their rank.'],
];

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
                <span>Which board?</span> <span className="is-gold">What colour?</span> <span>Who against?</span>
              </h1>
              <p className="ma-sub">
                The Chess Alokas family app answers it on your phone, round after round.
              </p>
              <div className="ma-cta">
                <Today />
              </div>
              <p className="ma-note">The app isn&apos;t in any store yet. Until it is, the website has you covered.</p>
            </div>
            <figure className="ma-hero-fig">
              <div className="ma-hero-phones">
                <div className="ma-back">
                  <DiscoverPhone />
                </div>
                <div className="ma-front">
                  <MatchdayPhone />
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

        <section className="ma-four" aria-labelledby="ma-h-four">
          <div className="ma-wrap">
            <h2 id="ma-h-four">Matchday, in one glance.</h2>
            <dl>
              {MATCH_FACTS.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <Story id="ma-find" title="Find a tournament near you." phone={<DiscoverPhone />}>
          <p>Search by name, city or venue. See events by distance from your city, or from your phone if you allow it.</p>
          <ul>
            <li>Narrow to 10, 25 or 50 km</li>
            <li>Filter by section</li>
            <li>See the date, time control and entry fee</li>
          </ul>
        </Story>

        <Story id="ma-register" flip title="Register in a few taps." phone={<RegisterPhone />}>
          <p>Save your family once. Then choose who&apos;s playing, more than one child at a time if you like.</p>
          <ul>
            <li>The section is suggested from age, for you to check</li>
            <li>Leave halfway and your draft waits on the phone</li>
          </ul>
        </Story>

        <Story id="ma-receipt" title="Paid? Attach the receipt." phone={<AccountPhone />}>
          <p>See the organizer&apos;s payment details and QR, pay them directly, then add your receipt to the entry. A photo or PDF both work.</p>
          <ul>
            <li>Follow each entry, from pending to approved</li>
            <li>Your money goes to the organizer, not through the app</li>
          </ul>
        </Story>

        <Story id="ma-stand" flip title="See how they're doing." phone={<StandingPhone />}>
          <p>Points, earlier rounds and who they played. If the organizer turns on the live page, you also get rank, all pairings and full standings.</p>
        </Story>

        <Story id="ma-career" title="Every result. Every certificate." phone={<CareerPhone />}>
          <p>Wins, draws, losses and tournament history for each player, and their certificates in one place, ready to save as a PDF.</p>
        </Story>

        <Story id="ma-signal" flip title="Weak signal in the hall? Still there." phone={<OfflinePhone />}>
          <p>The app keeps the last information it loaded, and tells you exactly how old it is. When the signal returns, tap Retry or pull to refresh.</p>
          <p className="ma-fine">It can only show what it has already loaded once, and new pairings wait for a connection.</p>
        </Story>

        <section className="ma-family" aria-labelledby="ma-h-family">
          <div className="ma-wrap ma-family-in">
            <div>
              <h2 id="ma-h-family">Made for families with more than one player.</h2>
              <p>One account for all your children, and for you if you play too. Switch between them at the top of the screen.</p>
            </div>
            <figure className="ma-family-fig">
            <div className="ma-family-cards" aria-hidden="true">
              <div className="is-on">
                <Pawn side="w" />
                <span>
                  <b>Puteri Alekhine Damia</b> binti Hafiz Gambit
                  <small>Board 14, plays White</small>
                </span>
              </div>
              <div>
                <Pawn side="b" />
                <span>
                  <b>Muhammad Caro Kann</b> bin Hafiz Gambit
                  <small>Board 22, plays Black</small>
                </span>
              </div>
            </div>
            <figcaption>Illustration with invented names.</figcaption>
            </figure>
          </div>
        </section>

        <section className="ma-diff" aria-labelledby="ma-h-diff">
          <div className="ma-wrap">
            <h2 id="ma-h-diff">Two sides of the same tournament.</h2>
            <div className="ma-diff-grid">
              <article className="is-family">
                <h3>Family app</h3>
                <p className="ma-diff-who">For parents and players. Android, coming soon.</p>
                <ul>
                  <li>Find and register for events</li>
                  <li>Follow your own players each round</li>
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
              Browsing needs no account. To register or follow a player in the app, sign in with your
              email. Matchday follows players entered from a saved profile, once the organizer approves
              the entry.
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
