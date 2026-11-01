import { Bishop, Crown, Knight, Pawn } from './pieces';

/**
 * Product illustrations for the landing page, built in HTML and CSS so they stay sharp and small. Every name and event here is invented: never use sample-registrations-*.csv or
 * scripts/arcc-*.json.
 */

function Piece({ side }: { side: 'w' | 'b' }) {
  return <Pawn className="lp-pawn" side={side} />;
}

/** Given name in full weight, patronym quieter. Never truncated; long names wrap at the patronym. */
function Name({ n }: { n: string }) {
  const match = /^(.*?)\s((?:bin|binti|a\/l|a\/p)\s.*)$/i.exec(n);
  if (!match) return <span className="lp-nm">{n}</span>;
  return (
    <span className="lp-nm">
      {match[1]} <span className="lp-nm-rest">{match[2]}</span>
    </span>
  );
}

type Board = { bd: number; wp: string; w: string; res: string | null; b: string; bp: string };

const SHEET: Board[] = [
  { bd: 1, wp: '3', w: 'Tengku Gambit Iskandar bin Tengku Kingside Castle', res: '1 – 0', b: 'Yap Pin Yi', bp: '3' },
  { bd: 2, wp: '2½', w: 'Vikram Tempo a/l Zwischenzug Krishnan', res: null, b: 'Siti Bishopah Kasparina binti En Passant', bp: '2½' },
  { bd: 3, wp: '2½', w: 'Lee Skewer Xuan', res: '½ – ½', b: 'Harish Catalan a/l Tartakower', bp: '2' },
  { bd: 4, wp: '2', w: 'Dayang Nimzo Indiana binti Awang Opposite Bishops', res: null, b: 'Teoh Rook Lift', bp: '2' },
  { bd: 5, wp: '2', w: 'Ong Bishop Pair', res: '0 – 1', b: 'Mohd Scandinavian Faris bin Stalemate', bp: '2' },
  { bd: 6, wp: '1½', w: 'Sharifah Petroff Aina binti Syed Perpetual Check', res: null, b: 'Low Knight Outpost', bp: '1½' },
  { bd: 7, wp: '1½', w: 'Foo Passed Pawn', res: '1 – 0', b: 'Thivya Dragon a/p Levenfish', bp: '1' },
];

export function PairingSheet() {
  const open = SHEET.filter((b) => !b.res).length;
  return (
    <figure className="lp-sheet">
      <div className="lp-shelf" aria-hidden="true">
        <Knight className="lp-shelf-knight" />
        <Bishop className="lp-shelf-bishop" />
      </div>
      <div className="lp-sheet-head">
        <strong>Piala Zugzwang Rapid</strong>
        <span>Round 4, Under 18</span>
        <span className="lp-sheet-left">{open} boards still playing</span>
      </div>
      <table className="lp-pt">
        <caption className="lp-vh">
          Sample pairing sheet. Each row gives the board number, then White, the result and Black,
          with each player&apos;s points before the round.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="lp-pt-bd">
              Bd
            </th>
            <th scope="col" className="lp-pt-pts lp-hide-s">
              Pts
            </th>
            <th scope="col">White</th>
            <th scope="col" className="lp-pt-res">
              Result
            </th>
            <th scope="col">Black</th>
            <th scope="col" className="lp-pt-pts lp-hide-s">
              Pts
            </th>
          </tr>
        </thead>
        <tbody>
          {SHEET.map((b) => (
            <tr key={b.bd}>
              <th scope="row" className="lp-pt-bd">
                {b.bd}
              </th>
              <td className="lp-pt-pts lp-hide-s">{b.wp}</td>
              <td>
                <span className="lp-pl">
                  <Piece side="w" />
                  <Name n={b.w} />
                </span>
              </td>
              <td className={`lp-pt-res${b.res ? ' is-in' : ''}`}>
                {b.res ?? <span aria-label="Still playing">&ndash;</span>}
              </td>
              <td>
                <span className="lp-pl">
                  <Piece side="b" />
                  <Name n={b.b} />
                </span>
              </td>
              <td className="lp-pt-pts lp-hide-s">{b.bp}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="lp-sheet-foot">
        <span className="lp-status lp-status-go">
          <i className="lp-dot" aria-hidden="true" />
          Saved on this laptop
        </span>
        <span className="lp-status lp-status-wait">
          <i className="lp-dot lp-dot-hollow" aria-hidden="true" />
          No Wi-Fi: 2 results waiting to sync
        </span>
      </div>
      <figcaption className="lp-cap">Illustration with invented names and event.</figcaption>
    </figure>
  );
}

const STANDINGS = [
  ['1', 'Tengku Gambit Iskandar bin Tengku Kingside Castle', '4', '10½', '8', '9½'],
  ['2', 'Yap Pin Yi', '3', '12', '9', '7¼'],
  ['3', 'Mohd Scandinavian Faris bin Stalemate', '3', '10½', '8', '6¾'],
  ['4', 'Lee Skewer Xuan', '3', '10', '7½', '6½'],
  ['5', 'Vikram Tempo a/l Zwischenzug Krishnan', '2½', '11', '8½', '5¾'],
  ['6', 'Siti Bishopah Kasparina binti En Passant', '2½', '10½', '8', '5¼'],
];

export function StandingsSheet() {
  return (
    <figure className="lp-stand">
      <table className="lp-st">
        <caption className="lp-vh">
          Sample standings with score, Buchholz, Buchholz Cut-1 and Sonneborn-Berger.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="lp-st-n">
              #
            </th>
            <th scope="col">Player</th>
            <th scope="col" className="lp-st-n">
              Pts
            </th>
            <th scope="col" className="lp-st-n">
              <abbr title="Buchholz">BH</abbr>
            </th>
            <th scope="col" className="lp-st-n">
              <abbr title="Buchholz Cut-1">C1</abbr>
            </th>
            <th scope="col" className="lp-st-n">
              <abbr title="Sonneborn-Berger">SB</abbr>
            </th>
          </tr>
        </thead>
        <tbody>
          {STANDINGS.map(([rank, name, pts, bh, c1, sb]) => (
            <tr key={rank}>
              <th scope="row" className="lp-st-n">
                {rank}
              </th>
              <td>
                <Name n={name!} />
              </td>
              <td className="lp-st-n lp-st-pts">{pts}</td>
              <td className="lp-st-n">{bh}</td>
              <td className="lp-st-n">{c1}</td>
              <td className="lp-st-n">{sb}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <figcaption className="lp-cap">Illustration with invented names and scores.</figcaption>
    </figure>
  );
}

/* Decorative QR-style pattern for the sticker illustration. It does not encode anything. */
const QR_SIZE = 21;
function qrPath(): string {
  const finder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= QR_SIZE - 7 && y < 7) || (x < 7 && y >= QR_SIZE - 7);
  const finderOn = (x: number, y: number) => {
    const fx = x >= QR_SIZE - 7 ? x - (QR_SIZE - 7) : x;
    const fy = y >= QR_SIZE - 7 ? y - (QR_SIZE - 7) : y;
    const edge = fx === 0 || fx === 6 || fy === 0 || fy === 6;
    const core = fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4;
    return edge || core;
  };
  let d = '';
  for (let y = 0; y < QR_SIZE; y++) {
    for (let x = 0; x < QR_SIZE; x++) {
      const quiet = (x === 7 && (y < 8 || y >= QR_SIZE - 8)) || (y === 7 && (x < 8 || x >= QR_SIZE - 8));
      const on = finder(x, y) ? finderOn(x, y) : !quiet && (x * 7 + y * 13 + x * y * 3) % 5 < 2;
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return d;
}

export function FloorVisual() {
  return (
    <figure className="lp-floor">
      <div className="lp-floor-row">
        <div className="lp-sticker">
          <span className="lp-sticker-t">Table</span>
          <span className="lp-sticker-n">14</span>
          <svg viewBox={`0 0 ${QR_SIZE} ${QR_SIZE}`} aria-hidden="true" shapeRendering="crispEdges">
            <path d={qrPath()} fill="currentColor" />
          </svg>
          <span className="lp-sticker-f">Scan to enter the result</span>
        </div>
        <div className="lp-phone">
          <div className="lp-phone-head">
            <strong>Board 14</strong>
            <span>Round 4</span>
          </div>
          <div className="lp-phone-pl">
            <Piece side="w" />
            <Name n="Goh En Passant" />
          </div>
          <div className="lp-phone-pl">
            <Piece side="b" />
            <Name n="Priya Benoni a/p Philidor" />
          </div>
          <div className="lp-phone-res" aria-hidden="true">
            <span className="is-on">1–0</span>
            <span>½–½</span>
            <span>0–1</span>
            <span>1–0F</span>
            <span>0–1F</span>
            <span>0–0</span>
          </div>
          <div className="lp-phone-go" aria-hidden="true">
            Confirm 1–0
          </div>
          <div className="lp-phone-chief" aria-hidden="true">
            Call chief arbiter
          </div>
        </div>
      </div>
      <figcaption className="lp-cap">
        Illustration with invented names. The six result options are the real ones; the screen
        layout may differ.
      </figcaption>
    </figure>
  );
}

const QUEUE = [
  ['Nur Sicilia Najdorfah binti Mohd Endgame Tablebase', 'Under 12', 'Receipt', 'Pending'],
  ['Chong Rook Hao', 'Under 12', 'Receipt', 'Pending'],
  ['Arjun Pirc a/l Grunfeld Subramaniam', 'Under 12', 'Receipt', 'Approved'],
  ['Kok Castling Long', 'Under 18', 'Not yet', 'Waitlisted'],
];

export function RegistrationQueue() {
  return (
    <figure className="lp-queue">
      <div className="lp-sheet-head">
        <strong>Registrations</strong>
        <span>Entry fee RM 50, paid by DuitNow</span>
      </div>
      <table className="lp-q">
        <caption className="lp-vh">Sample registration queue awaiting organizer review.</caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col" className="lp-hide-s">
              Category
            </th>
            <th scope="col">Payment</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {QUEUE.map(([name, cat, pay, status]) => (
            <tr key={name}>
              <td>
                <Name n={name!} />
              </td>
              <td className="lp-hide-s">{cat}</td>
              <td className={pay === 'Receipt' ? 'lp-q-link' : 'lp-q-none'}>{pay}</td>
              <td>
                <span className={`lp-chip lp-chip-${status!.toLowerCase()}`}>{status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <figcaption className="lp-cap">Illustration with invented names and fee.</figcaption>
    </figure>
  );
}

const TV_BOARDS: [number, string, string, string][] = [
  [1, 'Tengku Gambit Iskandar', '1 – 0', 'Yap Pin Yi'],
  [2, 'Vikram Tempo', '', 'Siti Bishopah Kasparina'],
  [3, 'Lee Skewer Xuan', '½ – ½', 'Harish Catalan'],
  [4, 'Dayang Nimzo Indiana', '', 'Teoh Rook Lift'],
  [5, 'Ong Bishop Pair', '0 – 1', 'Mohd Scandinavian Faris'],
  [6, 'Sharifah Petroff Aina', '', 'Low Knight Outpost'],
  [7, 'Foo Passed Pawn', '1 – 0', 'Thivya Dragon'],
  [8, 'Aiman Ponziani', '', 'Kok Castling Long'],
  [9, 'Rani Trompowsky', '½ – ½', 'Seah Isolated Queen Pawn'],
  [10, 'Hafiz Vienna', '1 – 0', 'Cheah Hanging Pawns'],
  [11, 'Tan Zwischen Zug', '', 'Lim Gambit Ling'],
  [12, 'Chong Rook Hao', '0 – 1', 'Ng Pawn Mei'],
];

export function TvVisual() {
  const done = TV_BOARDS.filter((b) => b[2]).length;
  return (
    <figure className="lp-tvfig">
      <div className="lp-tv" role="img" aria-label="Venue TV screen showing twelve boards of round 4, with a countdown clock.">
        <div className="lp-tv-top">
          <span className="lp-tv-title">Piala Zugzwang Rapid</span>
          <span className="lp-tv-round">
            Round 4, {done}/{TV_BOARDS.length} boards finished
          </span>
          <span className="lp-tv-clock">18:42</span>
        </div>
        <ol className="lp-tv-grid">
          {TV_BOARDS.map(([bd, w, r, b]) => (
            <li key={bd} className="lp-tv-row">
              <span className="lp-tv-bd">{bd}</span>
              <span className="lp-tv-w">{w}</span>
              <span className="lp-tv-r">{r || '–'}</span>
              <span className="lp-tv-b">{b}</span>
            </li>
          ))}
        </ol>
      </div>
      <figcaption className="lp-cap">Illustration of TV mode with invented names, shortened here.</figcaption>
    </figure>
  );
}

export function ParentVisual() {
  return (
    <figure className="lp-parent">
      <div className="lp-parent-search" aria-hidden="true">
        puteri
      </div>
      <div className="lp-parent-card">
        <span className="lp-parent-l">Board</span>
        <span className="lp-parent-bd">14</span>
        <span className="lp-parent-c">
          <Piece side="w" /> Plays White
        </span>
        <span className="lp-parent-nm">
          <Name n="Puteri Alekhine Damia binti Queen Gambit" />
        </span>
        <span className="lp-parent-v">Against</span>
        <span className="lp-parent-nm">
          <Name n="Kavitha Zugzwang a/p Fianchetto Rajaratnam" />
        </span>
      </div>
      <figcaption className="lp-cap">Illustration with invented names.</figcaption>
    </figure>
  );
}

export function CertificateVisual() {
  return (
    <figure className="lp-certfig">
      <div className="lp-cert" role="img" aria-label="Sample certificate for an invented player, second place, Under 12.">
        <span className="lp-cert-k">Certificate of achievement</span>
        <span className="lp-cert-n">Wan Rookiah Fianchetta binti Wan Back Rank</span>
        <span className="lp-cert-p">2nd place, Under 12</span>
        <span className="lp-cert-e">Piala Zugzwang Rapid</span>
        <span className="lp-cert-s">No. PZR-00042</span>
      </div>
      <figcaption className="lp-cap">
        Illustration. Your own PDF template sets the real design.
      </figcaption>
    </figure>
  );
}

export function Mark() {
  return <Crown className="lp-mark-sq" />;
}
