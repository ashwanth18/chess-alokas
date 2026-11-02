/**
 * Phone frames with the Chess Alokas app's screens, rebuilt in HTML and CSS from the app's current look
 * (apps/mobile/lib/screens and theme/alokas_tokens.dart). Names and events are invented.
 *
 * REPLACE LATER: when the Android build is final, swap each <Phone> body for a real screenshot taken
 * with invented data. One per exported screen below. Keep the captions.
 */
import type { ReactNode } from 'react';
import { Crown } from '../landing/pieces';

type Tab = 'Discover' | 'Matchday' | 'Career' | 'Account';

const PLAYER = ['Harish Catalan', 'a/l Tartakower'];
const CHILD_A = ['Puteri Alekhine Damia', 'binti Hafiz Gambit'];
const CHILD_B = ['Muhammad Caro Kann', 'bin Hafiz Gambit'];
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
        <b>{PLAYER[0]}</b>
        <br />
        {PLAYER[1]}
      </p>
      <p className="ps-dim">#12 · Under 18</p>
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
      <p className="ps-dim">#19 · Under 18</p>
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
      <PlayerPicker n={PLAYER} sub="Born 2009 · Primary · Self" />
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

export function DiscoverPhone() {
  return (
    <Phone tab="Discover" label="Discover screen: tournaments sorted by distance from you, with search, Near me and section filters.">
      <div className="ps-pad-top" />
      <div className="ps-near">
        <div className="ps-field">
          <small>Near me</small>
          <b>Near you · Kuala Lumpur</b>
        </div>
        <i className="ps-gps">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.700" strokeLinecap="round">
            <circle cx="12" cy="12" r="6" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </i>
      </div>
      <div className="ps-field ps-search">Tournament, city or venue</div>
      <div className="ps-chips">
        <span className="is-on">List</span>
        <span>Map</span>
        <span>All sections</span>
        <span>U12</span>
      </div>
      <div className="ps-h">Tournaments (6)</div>
      <p className="ps-dim ps-indent">Nearest first</p>
      <div className="ps-card">
        <span className="ps-dist">1.9 km away</span>
        <p className="ps-ev">{EVENT}</p>
        <p className="ps-org">Akademi Catur Fianchetto</p>
        <p className="ps-dim">Dewan Fianchetto, Kuala Lumpur</p>
        <p className="ps-meta">14 Dec 2026 · 15+5 · 64 places · Entry RM 50</p>
        <p className="ps-dim">Under 12 · Under 18 · Open</p>
        <div className="ps-btn">View &amp; Register</div>
      </div>
      <div className="ps-card">
        <span className="ps-dist">8.4 km away</span>
        <p className="ps-ev">Kejohanan Rook Lift Junior</p>
      </div>
    </Phone>
  );
}

export function RegisterPhone() {
  return (
    <Phone column label="Register, step 1 of 4, who is playing: a player chosen from saved profiles, with a section suggested from age.">
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
        <Name n={PLAYER} />
        <small>Born 2009 · Primary · Self</small>
      </div>
      <div className="ps-field ps-section">
        <small>Section (suggested from age; please check)</small>
        <b>Under 18</b>
      </div>
      <div className="ps-person">
        <Name n={['Lim Gambit Ling', '']} />
        <small>Born 2012 · Child</small>
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
    <Phone tab="Account" label="Account screen: registrations, one pending organizer review with receipt submitted, others approved, and saved players.">
      <AppBar />
      <div className="ps-h">Registrations</div>
      <div className="ps-regs">
        <div>
          <b>{EVENT}</b>
          <Name n={PLAYER} />
          <small>Pending organizer review · Receipt submitted, awaiting verification</small>
        </div>
        <div>
          <b>Kejohanan Rook Lift Junior</b>
          <Name n={PLAYER} />
          <small>Approved</small>
        </div>
      </div>
      <div className="ps-h">Players (2)</div>
      <div className="ps-regs">
        <div>
          <Name n={PLAYER} />
          <small>Primary · Self</small>
        </div>
        <div>
          <Name n={['Lim Gambit Ling', '']} />
          <small>Child</small>
        </div>
      </div>
    </Phone>
  );
}

export function CareerPhone() {
  return (
    <Phone tab="Career" label="Career screen: win, draw and loss totals, past tournaments, a certificate with a Download PDF button, and tournament history.">
      <AppBar />
      <PlayerPicker n={PLAYER} sub="Born 2009 · Primary · Self" />
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
        <div className="ps-h ps-h-in">Tournaments</div>
        <p className="ps-ev ps-ev-s">Kejohanan Rook Lift Junior</p>
        <p className="ps-dim">9 Aug 2026 · 4.0 / 6 · W3 D2 L1</p>
        <p className="ps-ev ps-ev-s">Piala Zugzwang Rapid</p>
        <p className="ps-dim">21 Jun 2026 · 3.5 / 7 · W3 D1 L3</p>
      </div>
      <div className="ps-card">
        <div className="ps-row">
          <div className="ps-h ps-h-in">Certificates</div>
          <span className="ps-dim">2 issued</span>
        </div>
        <p className="ps-ev ps-ev-s">Kejohanan Rook Lift Junior</p>
        <p className="ps-dim">Winner, rank 3 · 9 Aug 2026 · KRL-00031</p>
        <div className="ps-btn ps-btn-fit">Download PDF</div>
      </div>
    </Phone>
  );
}
