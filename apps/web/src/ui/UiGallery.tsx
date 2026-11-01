import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AsOf,
  Button,
  Field,
  findLookalikes,
  formatDisambiguator,
  Marker,
  PairingTable,
  Piece,
  PlayerName,
  Result,
  Sheet,
  StatusLine,
  IconAlert,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconDownload,
  IconHelp,
  IconMenu,
  IconPlus,
  IconPrint,
  IconQr,
  IconSearch,
  IconSignOut,
  IconUndo,
  IconWifiOff,
  Mark,
  type PairingBoard,
  type SyncFacts,
} from '.';
import { Surface, type SurfaceTheme } from './Surface';

/** Dev-only component sheet at /__ui. Not in production builds. All names are invented. */

const LONG = [
  'PUTERI ALEKHINE DAMIA BINTI QUEEN GAMBIT',
  'PUTERI ALEKHINE DAMIA BINTI QUEEN INDIAN',
  'Kavitha Zugzwang a/p Fianchetto Rajaratnam',
  'ARJUN PIRC A/L GRUNFELD SUBRAMANIAM',
  'Muhammad Caro Kann bin Sicilian Najdorf',
  'Nur Sicilia Najdorfah binti Mohd Endgame Tablebase',
  'Tengku Gambit Iskandar bin Tengku Kingside Castle',
  'Tan Zwischen Zug',
  'Yap Pin Yi',
];

const roster = LONG.map((name, i) => ({ id: String(i), name, no: i + 1, section: i < 4 ? 'U12' : 'U18' }));
const lookalikes = findLookalikes(roster);
const dis = (i: number) => {
  const p = roster[i]!;
  return lookalikes.has(p.id) ? formatDisambiguator({ no: p.no, section: p.section }) : null;
};
const player = (i: number, points: number) => ({ name: roster[i]!.name, points, disambiguator: dis(i) });

const U12: PairingBoard[] = [
  { board: 1, white: player(0, 3), black: player(4, 3), result: '1-0', by: 'Goh' },
  { board: 2, white: player(5, 2.5), black: player(1, 2.5), result: null },
  { board: 3, white: player(2, 2), black: player(7, 2), result: '1/2-1/2', unsent: true, by: 'Desk' },
  { board: 4, white: player(3, 1.5), black: player(8, 0.5), result: '0-1F', confirmed: true, by: 'Desk' },
];
const U18: PairingBoard[] = [
  { board: 5, white: player(6, 1), black: player(8, 0), result: '0-1', flagged: true, by: 'Ng' },
  { board: 6, white: player(7, 0), black: null, result: 'bye', confirmed: true },
];

const AS_OF = '2026-07-14T06:32:00.000Z';
const STATUSES: Array<{ label: string; facts: SyncFacts }> = [
  { label: 'All delivered', facts: { device: 'laptop', connected: true, pending: 0, rejected: 0, cloudAsOf: AS_OF } },
  { label: 'Waiting', facts: { device: 'laptop', connected: true, pending: 2, rejected: 0, cloudAsOf: AS_OF, showAudience: true } },
  { label: 'Sending', facts: { device: 'laptop', connected: true, syncing: true, pending: 2, rejected: 0, cloudAsOf: AS_OF } },
  { label: 'Offline', facts: { device: 'laptop', connected: false, pending: 3, rejected: 0, cloudAsOf: AS_OF, showAudience: true } },
  { label: 'Could not reach', facts: { device: 'laptop', connected: true, failed: true, pending: 1, rejected: 0, cloudAsOf: AS_OF } },
  { label: 'Rejected', facts: { device: 'laptop', connected: true, pending: 4, rejected: 4, cloudAsOf: AS_OF, showAudience: true } },
  { label: 'Never synced', facts: { device: 'phone', connected: null, pending: 0, rejected: 0, cloudAsOf: null } },
];

const ICONS = {
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
  IconClose,
  IconPrint,
  IconCheck,
  IconPlus,
  IconSearch,
  IconUndo,
  IconWifiOff,
  IconMenu,
  IconDownload,
  IconQr,
  IconHelp,
  IconAlert,
  IconSignOut,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: 'var(--s6) 0', borderTop: '2px solid var(--ink)' }}>
      <h2 className="ui-label" style={{ marginBottom: 'var(--s4)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function UiGallery() {
  const [params, setParams] = useSearchParams();
  const theme = (params.get('theme') as SurfaceTheme | null) ?? undefined;
  const [sheet, setSheet] = useState<'sheet' | 'modal' | null>(null);
  return (
    <Surface name="desk" theme={theme} density={params.get('density') === 'roomy' ? 'roomy' : undefined}>
      <header className="ui-topbar">
        <span className="ui-bdno" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <Mark /> Chess Alokas
        </span>
        <span className="ui-faint" style={{ flex: 1 }}>
          Component sheet, dev only
        </span>
        {(['light', 'dark', 'sun', 'tv'] as const).map((t) => (
          <Button
            key={t}
            size="sm"
            aria-pressed={theme === t}
            variant={theme === t ? 'primary' : 'default'}
            onClick={() => setParams({ theme: t })}
          >
            {t}
          </Button>
        ))}
      </header>
      <main style={{ padding: '0 var(--s5) var(--s9)', maxWidth: 1200, margin: '0 auto' }}>
        <h1 className="ui-display" style={{ fontSize: 'var(--t-4xl)', margin: 'var(--s6) 0' }}>
          Pairing Sheet
        </h1>

        <Section title="PlayerName, narrowing then wrapping">
          <div data-testid="names" style={{ display: 'grid', gap: 'var(--s4)' }}>
            {[480, 320, 240, 160].map((width) => (
              <div key={width} data-testid={`names-${width}`} style={{ width, maxWidth: '100%', border: '1px solid var(--rule)', padding: 'var(--s2)' }}>
                <div className="ui-faint" style={{ fontSize: 'var(--t-xs)' }}>
                  {width} px
                </div>
                {LONG.map((name, i) => (
                  <PlayerName key={name} name={name} disambiguator={dis(i)} />
                ))}
              </div>
            ))}
          </div>
        </Section>

        <Section title="PairingTable">
          <PairingTable caption="Round 4 pairings" cursorBoard={2} sections={[{ name: 'U12', note: '4 boards', boards: U12 }, { name: 'U18', boards: U18 }]} />
        </Section>

        <Section title="Piece, marker and result">
          <p style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s5)', alignItems: 'center' }}>
            <span>
              <Piece color="white" /> White
            </span>
            <span>
              <Piece color="black" /> Black
            </span>
            <span className="ui-tone-go" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Marker /> Delivered
            </span>
            <span className="ui-tone-wait" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Marker hollow /> On this device
            </span>
            <Result result="1-0" />
            <Result result="1/2-1/2" unsent />
            <Result result="0-1" confirmed />
            <Result result="1-0F" confirmed />
            <Result result={null} />
          </p>
        </Section>

        <Section title="Button">
          <p style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s3)', alignItems: 'center' }}>
            <Button variant="primary">Pair round 5</Button>
            <Button>Print</Button>
            <Button variant="danger">Delete</Button>
            <Button variant="quiet">Cancel</Button>
            <Button size="sm">Small</Button>
            <Button size="lg" variant="primary">
              Large
            </Button>
            <Button disabled>Disabled</Button>
            <Button variant="primary" disabled>
              Disabled primary
            </Button>
          </p>
        </Section>

        <Section title="StatusLine">
          <div style={{ display: 'grid', gap: 'var(--s3)' }}>
            {STATUSES.map((s) => (
              <div key={s.label}>
                <div className="ui-faint" style={{ fontSize: 'var(--t-xs)' }}>
                  {s.label}
                </div>
                <StatusLine {...s.facts} />
              </div>
            ))}
            <p>
              <AsOf asOf={AS_OF} connected /> · <AsOf asOf={AS_OF} connected={false} />
            </p>
          </div>
        </Section>

        <Section title="Field">
          <div style={{ maxWidth: 420 }}>
            <Field label="Player's full name" hint="As on the IC or MyKid." placeholder="Puteri Damia binti Queen Gambit" />
            <Field label="School" optional />
            <Field label="Year of birth" error="Enter a year, such as 2014." defaultValue="20" />
            <Field label="Section">
              {(control) => (
                <select {...control}>
                  <option>U12</option>
                  <option>U18</option>
                </select>
              )}
            </Field>
          </div>
        </Section>

        <Section title="Sheet">
          <p style={{ display: 'flex', gap: 'var(--s3)' }}>
            <Button onClick={() => setSheet('sheet')}>Open sheet</Button>
            <Button onClick={() => setSheet('modal')}>Open modal</Button>
          </p>
          <Sheet open={sheet !== null} variant={sheet ?? 'sheet'} title="Board 4" onClose={() => setSheet(null)}>
            <p style={{ marginBottom: 'var(--s4)' }}>Tap who won. You get five seconds to undo.</p>
            <Button block size="lg" onClick={() => setSheet(null)}>
              Goh En Passant won
            </Button>
          </Sheet>
        </Section>

        <Section title="Icons, copied from Lucide">
          <p style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s4)' }}>
            {Object.entries(ICONS).map(([name, Icon]) => (
              <Icon key={name} title={name.replace('Icon', '')} size={20} />
            ))}
            <Mark size={20} />
          </p>
        </Section>
      </main>
    </Surface>
  );
}
