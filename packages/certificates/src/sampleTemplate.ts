import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { CertificateLayout } from './types.js';

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;

/** A plain landscape certificate for the demo tenant, marked so it can't pass for a real one. */
export async function buildDemoCertificateTemplate(): Promise<{
  template: Uint8Array;
  layout: CertificateLayout;
}> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const forest = rgb(0.06, 0.24, 0.18);
  const gold = rgb(0.72, 0.56, 0.2);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const plain = await doc.embedFont(StandardFonts.Helvetica);

  page.drawRectangle({ x: 24, y: 24, width: PAGE_WIDTH - 48, height: PAGE_HEIGHT - 48, borderColor: forest, borderWidth: 3 });
  page.drawRectangle({ x: 34, y: 34, width: PAGE_WIDTH - 68, height: PAGE_HEIGHT - 68, borderColor: gold, borderWidth: 1 });

  const centred = (text: string, y: number, size: number, font = plain, color = forest) => {
    page.drawText(text, { x: (PAGE_WIDTH - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });
  };
  centred('Akademi Catur Demo', 510, 16);
  centred('Certificate', 455, 42, bold);
  centred('awarded to', 350, 14);
  centred('SAMPLE CERTIFICATE FROM A FICTIONAL DEMO EVENT', 52, 10, plain, rgb(0.7, 0.11, 0.11));

  const field = (id: string, sourceColumn: string, y: number, fontSize: number, font: 'Times-Bold' | 'Helvetica') => ({
    id,
    sourceColumn,
    x: 0.5,
    y,
    width: 0.8,
    fontSize,
    align: 'center' as const,
    color: '#0f3d2e',
    font,
  });

  return {
    template: await doc.save(),
    layout: {
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
      fields: [
        field('name', 'name', 0.33, 30, 'Times-Bold'),
        field('award', 'award', 0.45, 16, 'Helvetica'),
        field('tournament', 'tournament', 0.52, 16, 'Helvetica'),
        field('date', 'date', 0.6, 12, 'Helvetica'),
        field('serial', 'serial', 0.85, 10, 'Helvetica'),
      ],
    },
  };
}
