import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { ordinal, collectColumns, winnersFromStandings } from './rows.js';
import { stampCertificate, readTemplatePageSize } from './stamp.js';
import type { CertificateLayout } from './types.js';

async function blankTemplate(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([842, 595]);
  return doc.save();
}

describe('ordinal', () => {
  it('formats ranks', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(21)).toBe('21st');
  });
});

describe('winnersFromStandings', () => {
  it('keeps top N by rank', () => {
    const rows = winnersFromStandings(
      [
        { id: 'a', name: 'A', rank: 1, score: 3 },
        { id: 'b', name: 'B', rank: 2, score: 2 },
        { id: 'c', name: 'C', rank: 3, score: 1 },
      ],
      2,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe('A');
  });
});

describe('stampCertificate', () => {
  it('stamps a name onto a blank page', async () => {
    const template = await blankTemplate();
    const size = await readTemplatePageSize(template);
    expect(size.pageWidth).toBeGreaterThan(0);

    const layout: CertificateLayout = {
      pageWidth: size.pageWidth,
      pageHeight: size.pageHeight,
      fields: [
        {
          id: 'f1',
          sourceColumn: 'name',
          x: 0.5,
          y: 0.5,
          fontSize: 24,
          align: 'center',
          color: '#000000',
          font: 'Helvetica',
        },
      ],
    };

    const out = await stampCertificate(template, layout, { name: 'Alice' });
    expect(out.byteLength).toBeGreaterThan(100);
    const cols = collectColumns([{ name: 'Alice', club: 'X' }]);
    expect(cols).toContain('name');
    expect(cols).toContain('serial');
  });
});
