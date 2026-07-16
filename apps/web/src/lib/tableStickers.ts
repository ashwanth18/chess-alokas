import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

export type StickerTable = {
  tableNumber: number;
  slug: string;
};

/** Public HTTPS URL for floor QR stickers (never desktop hash routes). */
export function tablePublicUrl(slug: string): string {
  const configured = import.meta.env.VITE_PUBLIC_WEB_URL as string | undefined;
  if (configured) return `${configured.replace(/\/$/, '')}/t/${slug}`;
  if (typeof window !== 'undefined' && !window.desktop?.isDesktop) {
    return `${window.location.origin}/t/${slug}`;
  }
  return `https://chess-manager.alokas.com/t/${slug}`;
}

export async function buildTableStickerPdf(
  tournamentName: string,
  tables: StickerTable[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await pdf.embedFont(StandardFonts.Helvetica);

  // A6-ish sticker tiles: 4 per A4 page
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const cols = 2;
  const rows = 2;
  const cellW = pageWidth / cols;
  const cellH = pageHeight / rows;

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i]!;
    if (i % (cols * rows) === 0) {
      pdf.addPage([pageWidth, pageHeight]);
    }
    const page = pdf.getPages()[pdf.getPageCount() - 1]!;
    const slot = i % (cols * rows);
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const x0 = col * cellW;
    const y0 = pageHeight - (row + 1) * cellH;

    const url = tablePublicUrl(table.slug);
    const dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 256,
      color: { dark: '#0f3d2e', light: '#ffffff' },
    });
    const pngBytes = dataUrlToBytes(dataUrl);
    const qrImage = await pdf.embedPng(pngBytes);

    const qrSize = Math.min(cellW, cellH) * 0.52;
    const qrX = x0 + (cellW - qrSize) / 2;
    const qrY = y0 + cellH * 0.28;

    page.drawRectangle({
      x: x0 + 10,
      y: y0 + 10,
      width: cellW - 20,
      height: cellH - 20,
      borderColor: rgb(0.55, 0.45, 0.28),
      borderWidth: 1.2,
    });

    page.drawText(tournamentName.slice(0, 42), {
      x: x0 + 18,
      y: y0 + cellH - 36,
      size: 11,
      font: fontReg,
      color: rgb(0.15, 0.2, 0.18),
      maxWidth: cellW - 36,
    });

    page.drawText(`Table ${table.tableNumber}`, {
      x: x0 + 18,
      y: y0 + cellH - 58,
      size: 22,
      font,
      color: rgb(0.06, 0.24, 0.18),
    });

    page.drawImage(qrImage, {
      x: qrX,
      y: qrY,
      width: qrSize,
      height: qrSize,
    });

    page.drawText('Scan to score · PIN required', {
      x: x0 + 18,
      y: y0 + 28,
      size: 9,
      font: fontReg,
      color: rgb(0.35, 0.35, 0.32),
    });
  }

  return pdf.save();
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function downloadPdfBytes(filename: string, bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
