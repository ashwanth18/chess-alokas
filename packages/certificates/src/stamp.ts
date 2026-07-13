import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { CertificateField, CertificateLayout, CertificateRow } from './types.js';
import { DIGITAL_TARGET_BYTES } from './types.js';

function parseColor(hex: string): ReturnType<typeof rgb> {
  const raw = hex.replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw.padEnd(6, '0').slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return rgb(0.1, 0.07, 0.03);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function loadFont(
  doc: PDFDocument,
  name: CertificateField['font'],
): Promise<PDFFont> {
  switch (name) {
    case 'Helvetica-Bold':
      return doc.embedFont(StandardFonts.HelveticaBold);
    case 'Times-Roman':
      return doc.embedFont(StandardFonts.TimesRoman);
    case 'Times-Bold':
      return doc.embedFont(StandardFonts.TimesRomanBold);
    default:
      return doc.embedFont(StandardFonts.Helvetica);
  }
}

function drawField(
  page: PDFPage,
  field: CertificateField,
  text: string,
  font: PDFFont,
  pageWidth: number,
  pageHeight: number,
): void {
  if (!text) return;
  const fontSize = field.fontSize;
  const maxWidth = (field.width ?? 0.8) * pageWidth;
  let display = text;
  while (font.widthOfTextAtSize(display, fontSize) > maxWidth && display.length > 1) {
    display = `${display.slice(0, -2)}…`;
  }

  const textWidth = font.widthOfTextAtSize(display, fontSize);
  // field.x / field.y are normalized page coords for the text center (designer overlay).
  const anchorX = field.x * pageWidth;
  const centerY = (1 - field.y) * pageHeight;
  // PDF text is drawn from the baseline; shift down by ~half the em size.
  const baselineY = centerY - fontSize * 0.35;

  let x = anchorX;
  if (field.align === 'center') x = anchorX - textWidth / 2;
  else if (field.align === 'right') x = anchorX - textWidth;

  page.drawText(display, {
    x: Math.max(0, x),
    y: Math.max(0, baselineY),
    size: fontSize,
    font,
    color: parseColor(field.color),
  });
}

export async function stampCertificate(
  templateBytes: Uint8Array,
  layout: CertificateLayout,
  row: CertificateRow,
): Promise<Uint8Array> {
  const src = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const [copied] = await out.copyPages(src, [0]);
  if (!copied) throw new Error('Template PDF has no pages');
  out.addPage(copied);

  const page = out.getPage(0);
  const { width, height } = page.getSize();
  const fontCache = new Map<string, PDFFont>();

  for (const field of layout.fields) {
    const raw = row[field.sourceColumn];
    const text = raw == null ? '' : String(raw);
    let font = fontCache.get(field.font);
    if (!font) {
      font = await loadFont(out, field.font);
      fontCache.set(field.font, font);
    }
    drawField(page, field, text, font, width, height);
  }

  return out.save({ useObjectStreams: true });
}

/** Light compression: re-save with object streams. Templates with huge images stay large. */
export async function compressPdfForDigital(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const compressed = await doc.save({ useObjectStreams: true });
    if (compressed.byteLength <= bytes.byteLength) return compressed;
    return bytes;
  } catch {
    return bytes;
  }
}

export async function stampAndCompressDigital(
  templateBytes: Uint8Array,
  layout: CertificateLayout,
  row: CertificateRow,
): Promise<{ pdf: Uint8Array; byteSize: number; underTarget: boolean }> {
  const stamped = await stampCertificate(templateBytes, layout, row);
  const pdf = await compressPdfForDigital(stamped);
  return {
    pdf,
    byteSize: pdf.byteLength,
    underTarget: pdf.byteLength <= DIGITAL_TARGET_BYTES,
  };
}

export async function mergePdfs(pdfs: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const bytes of pdfs) {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }
  return merged.save({ useObjectStreams: true });
}

export function readTemplatePageSize(templateBytes: Uint8Array): Promise<{
  pageWidth: number;
  pageHeight: number;
}> {
  return PDFDocument.load(templateBytes, { ignoreEncryption: true }).then((doc) => {
    const page = doc.getPage(0);
    if (!page) throw new Error('Template PDF has no pages');
    const { width, height } = page.getSize();
    return { pageWidth: width, pageHeight: height };
  });
}
