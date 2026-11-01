import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PairingTable } from './PairingTable';
import { PlayerName } from './PlayerName';
import { Field, Piece, Result, StatusLine } from './primitives';

const html = renderToStaticMarkup;

describe('PlayerName', () => {
  it('splits the patronym and shows display casing', () => {
    const out = html(<PlayerName name="PUTERI DAMIA BINTI QUEEN GAMBIT" />);
    expect(out).toContain('<span class="ui-name__given">Puteri Damia</span>');
    expect(out).toContain('<span class="ui-name__rest">binti Queen Gambit</span>');
    expect(out).not.toContain('PUTERI');
  });

  it('shows the disambiguator only when given', () => {
    expect(html(<PlayerName name="Tan Zug" />)).not.toContain('ui-name__dis');
    expect(html(<PlayerName name="Tan Zug" disambiguator="#12 · U12" />)).toContain('#12 · U12');
  });
});

describe('Piece', () => {
  it('always names its colour', () => {
    expect(html(<Piece color="white" />)).toContain('aria-label="White"');
    expect(html(<Piece color="black" />)).toContain('aria-label="Black"');
  });
});

describe('Result', () => {
  it('is pen until confirmed, then ink', () => {
    expect(html(<Result result="1-0" />)).not.toContain('ui-result--confirmed');
    expect(html(<Result result="1-0" confirmed />)).toContain('ui-result--confirmed');
  });

  it('says unsent in words as well as the hollow marker', () => {
    const out = html(<Result result="1/2-1/2" unsent />);
    expect(out).toContain('ui-marker--hollow');
    expect(out).toContain('Draw, not sent yet');
  });

  it('marks a missing result for screen readers', () => {
    expect(html(<Result result={null} />)).toContain('No result yet');
    expect(html(<Result result="pending" />)).toContain('No result yet');
  });
});

describe('StatusLine', () => {
  it('uses hollow and amber offline, solid for what is on this device', () => {
    const out = html(<StatusLine device="laptop" connected={false} pending={3} rejected={0} cloudAsOf={null} />);
    expect(out).toContain('Everything saved on this laptop');
    expect(out).toContain('ui-tone-wait');
    expect(out).toContain('ui-marker--hollow');
    expect(out).not.toContain('ui-tone-flag');
  });
});

describe('Field', () => {
  it('links label, hint and error to the control', () => {
    const out = html(<Field label="School" hint="Optional for parents" error="Too long" />);
    const id = /<input[^>]*\bid="([^"]+)"/.exec(out)![1]!;
    expect(out).toContain(`for="${id}"`);
    expect(out).toContain(`aria-describedby="${id}-hint ${id}-error"`);
    expect(out).toContain('aria-invalid="true"');
  });

  it('renders a custom control through the render function', () => {
    const out = html(<Field label="Section">{(c) => <select {...c} />}</Field>);
    expect(out).toContain('<select');
    expect(out).toContain('class="ui-input"');
  });
});

describe('PairingTable', () => {
  const out = html(
    <PairingTable
      caption="Round 4 pairings"
      cursorBoard={14}
      sections={[
        {
          name: 'U12',
          boards: [
            {
              board: 14,
              white: { name: 'Tan Zwischen Zug', points: 1.5 },
              black: { name: 'Lim Gambit Ling', points: 1 },
              result: '1-0',
            },
          ],
        },
      ]}
    />,
  );

  it('is a real table with a caption and scoped headers', () => {
    expect(out).toContain('<caption');
    expect(out).toContain('Round 4 pairings');
    expect(out).toContain('scope="col"');
    expect(out).toContain('scope="row"');
    expect(out).toContain('scope="rowgroup"');
  });

  it('keeps White before the result and Black after it', () => {
    expect(out.indexOf('Tan Zwischen Zug')).toBeLessThan(out.indexOf('ui-result'));
    expect(out.indexOf('ui-result')).toBeLessThan(out.lastIndexOf('Lim Gambit Ling'));
  });

  it('reads the whole board out on the row header', () => {
    expect(out).toContain(
      'Board 14. White, Tan Zwischen Zug, 1½ points. White won. Black, Lim Gambit Ling, 1 points.',
    );
  });

  it('marks the cursor row', () => {
    expect(out).toContain('aria-current="true"');
    expect(out).toContain('is-cursor');
  });
});

describe('no truncation', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });

  it('no component or design stylesheet uses text-overflow', () => {
    const here = import.meta.dirname;
    const sources = [...files(here), ...files(join(here, '../design'))].filter(
      (f) => /\.(css|tsx?)$/.test(f) && !f.endsWith('.test.tsx'),
    );
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/text-overflow/);
    }
  });
});
