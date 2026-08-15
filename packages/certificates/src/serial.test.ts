import { describe, expect, it } from 'vitest';
import {
  certificateYear,
  formatCertificateSerial,
  renderCertTemplate,
  certBodyToHtml,
} from '@chess-alokas/shared';

describe('certificate serials', () => {
  it('formats ARCC/001/2026', () => {
    expect(formatCertificateSerial('ARCC', 1, 3, 2026)).toBe('ARCC/001/2026');
    expect(formatCertificateSerial('CLUB', 12, 4, 2026)).toBe('CLUB/0012/2026');
  });

  it('takes year from tournament date', () => {
    expect(certificateYear('2026-08-14')).toBe(2026);
  });
});

describe('certificate email merge', () => {
  it('replaces merge tags', () => {
    const out = renderCertTemplate('Hi {{playerName}} — {{tournament}} {{serial}}', {
      playerName: 'Ada',
      tournament: 'Spring Open',
      certType: 'winner',
      serial: 'ARCC/001/2026',
    });
    expect(out).toBe('Hi Ada — Spring Open ARCC/001/2026');
  });

  it('wraps plain text as HTML paragraphs', () => {
    const html = certBodyToHtml('Hello Ada,\n\nSee attached.');
    expect(html).toContain('<p>Hello Ada,</p>');
    expect(html).toContain('<p>See attached.</p>');
  });
});
