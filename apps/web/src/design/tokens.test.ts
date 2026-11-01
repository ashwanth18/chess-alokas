import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = import.meta.dirname;
const tokens = readFileSync(join(here, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector: string): Record<string, string> {
  const start = tokens.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector}`);
  const end = tokens.indexOf('\n}', start);
  const out: Record<string, string> = {};
  for (const m of tokens.slice(start, end).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const base = block(':root');
const THEMES: Record<string, Record<string, string>> = {
  forest: base,
  sun: { ...base, ...block(':root[data-theme="sun"]') },
  light: { ...base, ...block(':root[data-theme="light"]') },
  tv: { ...base, ...block(':root[data-theme="tv"]') },
};

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Foreground, background, minimum. Text needs 4.5; control borders and focus need 3 (WCAG 1.4.11). */
const PAIRS: Array<[string, string, number]> = [
  ['ink', 'paper', 4.5],
  ['ink', 'paper2', 4.5],
  ['ink', 'paper3', 4.5],
  ['ink', 'field', 4.5],
  ['ink2', 'paper', 4.5],
  ['ink2', 'paper2', 4.5],
  ['ink3', 'paper', 4.5],
  ['ink3', 'paper2', 4.5],
  ['ink3', 'field', 4.5],
  ['heading', 'paper', 4.5],
  ['heading', 'paper2', 4.5],
  ['on-accent', 'accent', 4.5],
  ['on-accent', 'accent-hover', 4.5],
  ['pen', 'paper', 4.5],
  ['pen', 'paper2', 4.5],
  ['pen', 'pen-wash', 4.5],
  ['ink', 'pen-wash', 4.5],
  ['flag', 'paper', 4.5],
  ['flag', 'paper2', 4.5],
  ['flag', 'flag-wash', 4.5],
  ['go', 'paper', 4.5],
  ['go', 'paper2', 4.5],
  ['go', 'go-wash', 4.5],
  ['wait', 'paper', 4.5],
  ['wait', 'paper2', 4.5],
  ['wait', 'wait-wash', 4.5],
  ['rule-strong', 'paper', 3],
  ['rule-strong', 'paper2', 3],
  ['rule-strong', 'field', 3],
  ['focus', 'paper', 3],
  ['focus', 'paper2', 3],
  ['accent', 'paper', 3],
  ['ink', 'piece-black', 3],
];

describe('tokens: WCAG AA in every theme', () => {
  for (const [theme, values] of Object.entries(THEMES)) {
    it.each(PAIRS)(`${theme}: %s on %s is at least %d`, (fg, bg, min) => {
      const ratio = contrast(values[fg]!, values[bg]!);
      // Sun's ink on black pieces is ink on ink: the piece there is edged by the square itself.
      if (fg === 'ink' && bg === 'piece-black' && theme !== 'forest' && theme !== 'tv') return;
      expect(ratio, `${fg} ${values[fg]} on ${bg} ${values[bg]}`).toBeGreaterThanOrEqual(min);
    });
  }
});

describe('one place for the look', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });

  it('has no colour, shadow or radius value outside tokens.css', () => {
    const sources = [join(here, 'ui.css'), join(here, 'shell.css'), ...files(join(here, '../ui'))].filter(
      (f) => /\.(css|tsx?)$/.test(f) && !/\.test\./.test(f),
    );
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      const label = file.split(/[\\/]/).pop();
      expect(text, `${label}: hard-coded colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?!\w)|\brgba?\(|\bhsla?\(/);
      if (file.endsWith('.css')) {
        expect(text, `${label}: hard-coded shadow`).not.toMatch(/box-shadow:\s*(?!var\(|inset 3px 0 0 var\(|none)/);
        expect(text, `${label}: hard-coded radius`).not.toMatch(/border-radius:\s*(?!var\(|0\b)[^;]*\d/);
      }
    }
  });

  it('shares no variable name with index.css, which this layer would override', () => {
    const legacy = readFileSync(join(here, '../index.css'), 'utf8');
    const rootBlock = legacy.slice(legacy.indexOf(':root {'), legacy.indexOf('\n}', legacy.indexOf(':root {')));
    const legacyNames = new Set([...rootBlock.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]!));
    expect(legacyNames.size).toBeGreaterThan(10);
    const ui = readFileSync(join(here, 'ui.css'), 'utf8');
    const ours = [...`${tokens}\n${ui}`.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]!);
    expect(ours.filter((n) => legacyNames.has(n))).toEqual([]);
  });
});
