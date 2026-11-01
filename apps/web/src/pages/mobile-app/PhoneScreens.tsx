/**
 * Phone frames with the family app's screens, rebuilt in HTML and CSS from the app's current look
 * (apps/mobile/lib/screens and theme/alokas_tokens.dart). Names and events are invented.
 *
 * REPLACE LATER: when the Android build is final, swap each <Phone> body for a real screenshot taken
 * with invented data. One per exported screen below. Keep the captions.
 */
import type { ReactNode } from 'react';
import { Crown, Pawn } from '../landing/pieces';

type Tab = 'Discover' | 'Matchday' | 'Career' | 'Account';

const CHILD_A = ['Puteri Alekhine Damia', 'binti Hafiz Gambit'];
const CHILD_B = ['Muhammad Caro Kann', 'bin Hafiz Gambit'];
const PARENT = ['Hafiz Gambit', 'bin Pawn Storm'];
const OPPONENT = ['Kavitha Zugzwang', 'a/p Fianchetto Rajaratnam'];
const EVENT = 'Piala Zugzwang Rapid';

function Name({ n }: { n: string[] }) {
  return (
    <span className="ps-nm">
      <b>{n[0]}</b> <span>{n[1]}</span>
    </span>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  const paths: Record<Tab, ReactNode> = {
    Discover: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m15.5 8.500-2 5-5 2 2-5z" />
      </>
    ),
    Matchday: (
      <>
        <rect x="3" y="7" width="18" height="11" rx="4" />
        <path d="M8 11v3M6.500 12.500h3M15 11.500h.01M17 13.500h.01" />
      </>
    ),
    Career: (
      <>
        <circle cx="12" cy="9" r="5.500" />
        <path d="m8.500 13.500-1 7.500 4.500-2.500 4.500 2.500-1-7.500" />
      </>
    ),
    Account: (
      <>
        <circle cx="9" cy="8" r="3.500" />
        <path d="M3 20c0-3.500 2.500-6 6-6s6 2.500 6 6M15.500 5a3.500 3.500 0 0 1 0 6.500M17.500 14.500c2.200.8 3.500 2.800 3.500 5.500" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.700" strokeLinecap="round" strokeLinejoin="round">
      {paths[tab]}
    </svg>
  );
}

function Phone({ label, tab, column, children }: { label: string; tab?: Tab; column?: boolean; children: ReactNode }) {
  return (
    <div className="ps-phone" role="img" aria-label={label}>
      <div className="ps-screen">
        <div className={`ps-scroll${column ? ' ps-column' : ''}`}>{children}</div>
        {tab ? (
          <div className="ps-tabs">
            {(['Discover', 'Matchday', 'Career', 'Account'] as Tab[]).map((t) => (
              <span key={t} className={t === tab ? 'is-on' : undefined}>
                <i>
                  <TabIcon tab={t} />
                </i>
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AppBar() {
  return (
    <div className="ps-bar">
      <i className="ps-logo">
        <Crown />
      </i>
      <span>
        <b>Chess Alokas</b>
        Signed in
      </span>
    </div>
  );
}

function PlayerPicker({ n, sub }: { n: string[]; sub: string }) {
  return (
    <div className="ps-picker">
      <span>
        <Name n={n} />
        <small>{sub}</small>
      </span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

function MatchCard({ side, board }: { side: 'w' | 'b'; board: number }) {
  return (
    <div className="ps-card ps-card-strong">
      <div className="ps-row">
        <span className="ps-pill">Round 4 of 7</span>
        <span className="ps-score">
          Score <b>2½</b>
        </span>
      </div>
      <p className="ps-big-name">
        <b>{CHILD_A[0]}</b>
        <br />
        {CHILD_A[1]}
      </p>
      <p className="ps-dim">#12 · Under 12</p>
      <div className={`ps-block ps-block-${side}`}>
        <div className="ps-row">
          <b>Board</b>
          <span>Playing now</span>
        </div>
        <div className="ps-board">{board}</div>
        <div className="ps-plays">Plays {side === 'w' ? 'White' : 'Black'}</div>
      </div>
      <p className="ps-against">Against</p>
      <p className="ps-big-name ps-opp">
        <b>{OPPONENT[0]}</b>
        <br />
        {OPPONENT[1]}
      </p>
      <p className="ps-dim">#19 · Under 12</p>
    </div>
  );
}

export function MatchdayPhone() {
  return (
    <Phone
      tab="Matchday"
      label="Matchday screen: updated 2:32 PM. Board 14, plays White, round 4 of 7, score two and a half, with the opponent's name."
    >
      <AppBar />
      <PlayerPicker n={CHILD_A} sub="Born 2015 · Child" />
      <p className="ps-fresh">
        <i />
        Updated 2:32 PM
      </p>
      <div className="ps-h">{EVENT}</div>
      <MatchCard side="w" board={14} />
    </Phone>
  );
}

export function OfflinePhone() {
  return (
    <Phone
      tab="Matchday"
      label="Matchday screen with no connection: a notice says it is showing what was saved as of 2:32 PM. Board 9, plays Black."
    >
      <AppBar />
      <div className="ps-stale">
        <i />
        <span>
          Showing what was saved as of 2:32 PM. Could not reach the server. Check your connection and
          try again.
        </span>
        <b>Retry</b>
      </div>
      <div className="ps-h">{EVENT}</div>
      <MatchCard side="b" board={9} />
    </Phone>
  );
}

export function StandingPhone() {
  const rows = [
    ['3=', 'Lim Gambit Ling', '3'],
    ['5', 'Puteri Alekhine Damia', '2½'],
    ['6', 'Arjun Pirc', '2½'],
    ['7', 'Tan Zwischen Zug', '2'],
  ];
  return (
    <Phone tab="Matchday" label="Where we stand: two and a half points, rank 5 of 28 in Under 12, with nearby players and earlier rounds.">
      <AppBar />
      <div className="ps-card">
        <div className="ps-h ps-h-in">Where we stand</div>
        <p className="ps-points">
          <b>2½</b> points
        </p>
        <p className="ps-rank">Rank 5 of 28 in Under 12</p>
        <div className="ps-lines">
          {rows.map(([r, n, p]) => (
            <div key={n} className={n!.startsWith('Puteri') ? 'is-me' : undefined}>
              <span>{r}</span>
              <span>{n}</span>
              <span>{p}</span>
            </div>
          ))}
        </div>
        <p className="ps-dim">By points. Tied players share a rank; the arbiter applies tie-breaks. As of 2:32 PM.</p>
      </div>
      <div className="ps-card">
        <div className="ps-h ps-h-in">Earlier rounds</div>
        <div className="ps-early">
          <span>Round 3</span>
          <span className="ps-sidepawn"><Pawn side="b" />Tan Zwischen Zug</span>
          <b>½</b>
        </div>
        <div className="ps-early">
          <span>Round 2</span>
          <span className="ps-sidepawn"><Pawn side="w" />Wong Fork Jia</span>
          <b>1</b>
        </div>
        <div className="ps-early">
          <span>Round 1</span>
          <span className="ps-sidepawn"><Pawn side="b" />Ng Pawn Mei</span>
          <b>1</b>
        </div>
      </div>
    </Phone>
  );
}

export function DiscoverPhone() {
  return (
    <Phone tab="Discover" label="Discover screen: tournaments sorted by distance from Kuala Lumpur, with search, distance and section filters.">
      <div className="ps-pad-top" />
      <div className="ps-near">
        <div className="ps-field">
          <small>Search near</small>
          <b>Near: Kuala Lumpur</b>
        </div>
        <i className="ps-gps">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.700" strokeLinecap="round">
            <circle cx="12" cy="12" r="6" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </i>
      </div>
      <div className="ps-field ps-search">Search tournament, city, venue</div>
      <div className="ps-chips">
        <span>10 km</span>
        <span>25 km</span>
        <span>50 km</span>
        <span className="is-on">Any distance</span>
      </div>
      <div className="ps-h">Tournaments (6)</div>
      <p className="ps-dim ps-indent">By distance from Kuala Lumpur</p>
      <div className="ps-card">
        <span className="ps-dist">1.9 km from Kuala Lumpur</span>
        <p className="ps-ev">{EVENT}</p>
        <p className="ps-org">Akademi Catur Fianchetto</p>
        <p className="ps-dim">Dewan Fianchetto, Kuala Lumpur</p>
        <p className="ps-meta">14 Dec 2026 · 15+5 · 64 players · RM 50</p>
        <p className="ps-dim">Under 12 · Under 18 · Open</p>
        <div className="ps-btn">View &amp; Register</div>
      </div>
      <div className="ps-card">
        <span className="ps-dist">8.4 km from Kuala Lumpur</span>
        <p className="ps-ev">Kejohanan Rook Lift Junior</p>
      </div>
    </Phone>
  );
}

export function RegisterPhone() {
  return (
    <Phone column label="Register, step 1 of 4, who is playing: two children chosen from saved family profiles, with a section suggested from age.">
      <div className="ps-reg-top">
        <span className="ps-back" aria-hidden="true">←</span> Register
      </div>
      <p className="ps-dim ps-indent">{EVENT}</p>
      <div className="ps-row ps-step">
        <b>Who is playing?</b>
        <span>Step 1 of 4</span>
      </div>
      <p className="ps-fresh">
        <i />
        Saved on this phone, so you can leave and come back.
      </p>
      <div className="ps-person is-on">
        <Name n={CHILD_A} />
        <small>Born 2015 · Child</small>
      </div>
      <div className="ps-field ps-section">
        <small>Section (suggested from age; please check)</small>
        <b>Under 12</b>
      </div>
      <div className="ps-person is-on">
        <Name n={CHILD_B} />
        <small>Born 2017 · Child</small>
      </div>
      <div className="ps-field ps-section">
        <small>Section (suggested from age; please check)</small>
        <b>Under 12</b>
      </div>
      <div className="ps-person">
        <Name n={PARENT} />
        <small>Born 1985 · Primary · Self</small>
      </div>
      <div className="ps-foot-act">
        <div className="ps-btn ps-btn-wide">Continue</div>
        <p className="ps-discard">Discard</p>
      </div>
    </Phone>
  );
}

export function AccountPhone() {
  return (
    <Phone tab="Account" label="Account screen: registrations for two children, one pending organizer review with receipt submitted, one approved.">
      <AppBar />
      <div className="ps-h">Registrations</div>
      <div className="ps-regs">
        <div>
          <b>{EVENT}</b>
          <Name n={CHILD_B} />
          <small>Pending organizer review · Receipt submitted, awaiting verification</small>
        </div>
        <div>
          <b>{EVENT}</b>
          <Name n={CHILD_A} />
          <small>Approved</small>
        </div>
        <div>
          <b>Kejohanan Rook Lift Junior</b>
          <Name n={CHILD_A} />
          <small>Approved</small>
        </div>
      </div>
      <div className="ps-h">Players (3)</div>
      <div className="ps-regs">
        <div>
          <Name n={CHILD_A} />
          <small>Born 2015 · Child</small>
        </div>
        <div>
          <Name n={CHILD_B} />
          <small>Born 2017 · Child</small>
        </div>
        <div>
          <Name n={PARENT} />
          <small>Born 1985 · Primary · Self</small>
        </div>
      </div>
    </Phone>
  );
}

export function CareerPhone() {
  return (
    <Phone tab="Career" label="Career screen: win, draw and loss totals, and a certificate with a Download PDF button.">
      <AppBar />
      <PlayerPicker n={CHILD_A} sub="Born 2015 · Child" />
      <div className="ps-card">
        <div className="ps-h ps-h-in">Ratings</div>
        <div className="ps-rate">
          <span>
            Alokas
            <small>On this profile</small>
          </span>
          <b>1180</b>
        </div>
      </div>
      <div className="ps-card">
        <div className="ps-h ps-h-in">Career</div>
        <div className="ps-stats">
          {[
            ['Events', '5'],
            ['Wins', '14'],
            ['Draws', '6'],
            ['Losses', '9'],
            ['Points', '17.0'],
          ].map(([k, v]) => (
            <span key={k}>
              <b>{v}</b>
              {k}
            </span>
          ))}
        </div>
      </div>
      <div className="ps-card">
        <div className="ps-row">
          <div className="ps-h ps-h-in">Certificates</div>
          <span className="ps-dim">2 issued</span>
        </div>
        <p className="ps-ev ps-ev-s">Kejohanan Rook Lift Junior</p>
        <p className="ps-nm-line">
          <Name n={CHILD_A} />
        </p>
        <p className="ps-dim">Winner, rank 3 · 9 Aug 2026 · KRL-00031</p>
        <div className="ps-btn ps-btn-fit">Download PDF</div>
      </div>
    </Phone>
  );
}
