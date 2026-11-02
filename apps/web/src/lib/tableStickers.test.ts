import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STICKER_FORMATS,
  STICKER_LAYOUT,
  buildTableStickerPdf,
  safeStickerText,
  stickerFilename,
  stickerTile,
  tablePublicUrl,
  type StickerFormat,
  type StickerTable,
} from './tableStickers';

// PDFs are rendered with pdf.js (already a dependency) on @napi-rs/canvas (its Node canvas), and
// QR codes are decoded with the ZXing build that ships inside html5-qrcode (Apache-2.0), so the
// test needs no new packages.
const require = createRequire(import.meta.url);
const ZXing = require('html5-qrcode/third_party/zxing-js.umd.js');
const STANDARD_FONTS = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;
const pdfjs = () => (pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs'));

const MM = 72 / 25.4;
const A4_H_PT = 841.89;

async function openPdf(bytes: Uint8Array) {
  const lib = await pdfjs();
  return lib.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: STANDARD_FONTS,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
}

type Raster = {
  width: number;
  height: number;
  scale: number;
  rgba: Uint8ClampedArray;
  png: () => Buffer;
  crop: (x: number, y: number, w: number, h: number) => Buffer;
};

async function renderPage(doc: Awaited<ReturnType<typeof openPdf>>, pageNo: number, dpi: number): Promise<Raster> {
  const page = await doc.getPage(pageNo);
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });
  const factory = (doc as unknown as { canvasFactory: { create(w: number, h: number): { canvas: any; context: any } } })
    .canvasFactory;
  const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const img = context.getImageData(0, 0, canvas.width, canvas.height);
  return {
    width: canvas.width,
    height: canvas.height,
    scale,
    rgba: img.data,
    png: () => canvas.toBuffer('image/png'),
    crop: (x: number, y: number, w: number, h: number) => {
      const part = factory.create(w, h);
      part.context.putImageData(context.getImageData(x, y, w, h), 0, 0);
      return part.canvas.toBuffer('image/png');
    },
  };
}

function zxingDecode(gray: Uint8ClampedArray, w: number, h: number): string | null {
  const source = new ZXing.RGBLuminanceSource(gray, w, h);
  const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
  const hints = new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]);
  try {
    return new ZXing.QRCodeReader().decode(bitmap, hints).getText();
  } catch {
    return null;
  }
}

/** Area-average downscale of a grey image by `f` (< 1). */
function downscale(gray: Uint8ClampedArray, w: number, h: number, f: number) {
  const W = Math.max(1, Math.floor(w * f));
  const H = Math.max(1, Math.floor(h * f));
  const out = new Uint8ClampedArray(W * H);
  for (let Y = 0; Y < H; Y++) {
    const ya = Math.floor(Y / f);
    const yb = Math.max(ya + 1, Math.floor((Y + 1) / f));
    for (let X = 0; X < W; X++) {
      const xa = Math.floor(X / f);
      const xb = Math.max(xa + 1, Math.floor((X + 1) / f));
      let sum = 0;
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) sum += gray[y * w + x]!;
      out[Y * W + X] = sum / ((yb - ya) * (xb - xa));
    }
  }
  return { gray: out, w: W, h: H };
}

/**
 * Decodes the single QR code inside a rectangle given in PDF points (origin bottom-left).
 * ZXing-js's detector is sensitive to the exact pixel grid of an anti-aliased render, so like a
 * phone trying the next camera frame it retries at slightly lower resolutions. It never retries
 * at a higher one, so a pass still proves the code reads at, or below, the resolution named.
 */
function decodeRegion(r: Raster, rect: { x: number; y: number; w: number; h: number }): string | null {
  const pageH = r.height / r.scale;
  const x0 = Math.max(0, Math.floor(rect.x * r.scale));
  const y0 = Math.max(0, Math.floor((pageH - rect.y - rect.h) * r.scale));
  const w = Math.min(r.width - x0, Math.ceil(rect.w * r.scale));
  const h = Math.min(r.height - y0, Math.ceil(rect.h * r.scale));
  const gray = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * r.width + (x0 + x)) * 4;
      gray[y * w + x] = (r.rgba[i]! * 299 + r.rgba[i + 1]! * 587 + r.rgba[i + 2]! * 114) / 1000;
    }
  }
  for (const f of [1, 0.9, 0.8, 0.7]) {
    const img = f === 1 ? { gray, w, h } : downscale(gray, w, h, f);
    const text = zxingDecode(img.gray, img.w, img.h);
    if (text) return text;
  }
  return null;
}

/** The QR-bearing regions of a tile: one per face (tents have two). */
function faceRegions(format: StickerFormat, slot: number) {
  const t = stickerTile(format, slot);
  if (format !== 'tent2') return [t];
  return [
    { x: t.x, y: t.y + t.h / 2, w: t.w, h: t.h / 2 },
    { x: t.x, y: t.y, w: t.w, h: t.h / 2 },
  ];
}

function makeTables(numbers: number[]): StickerTable[] {
  // Slugs shaped like the API's generateTableSlug(): 16 bytes in base64url (22 characters),
  // derived from the table number so the samples are stable.
  return numbers.map((n) => ({
    tableNumber: n,
    slug: createHash('sha256').update(`table-${n}`).digest().subarray(0, 16).toString('base64url'),
  }));
}

type TextBox = { str: string; x0: number; y0: number; x1: number; y1: number };

async function textBoxes(doc: Awaited<ReturnType<typeof openPdf>>, pageNo: number): Promise<TextBox[]> {
  const page = await doc.getPage(pageNo);
  const content = await page.getTextContent();
  const out: TextBox[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const [a, b, c, d, e, f] = item.transform as number[];
    const sx = Math.hypot(a!, b!);
    const sy = Math.hypot(c!, d!);
    // Advance along the baseline direction; glyph height (cap + descender) along the up direction.
    const ux = a! / sx;
    const uy = b! / sx;
    const vx = c! / sy;
    const vy = d! / sy;
    const asc = sy * 0.75;
    const desc = sy * 0.22;
    const pts = [
      [e! - vx * desc, f! - vy * desc],
      [e! + vx * asc, f! + vy * asc],
      [e! + ux * item.width - vx * desc, f! + uy * item.width - vy * desc],
      [e! + ux * item.width + vx * asc, f! + uy * item.width + vy * asc],
    ];
    out.push({
      str: item.str,
      x0: Math.min(...pts.map((p) => p[0]!)),
      x1: Math.max(...pts.map((p) => p[0]!)),
      y0: Math.min(...pts.map((p) => p[1]!)),
      y1: Math.max(...pts.map((p) => p[1]!)),
    });
  }
  return out;
}

const LONG_NAME =
  'Karnataka State Under-13 Open Rapid & Blitz Chess Championship 2026 (Categories A, B, C) presented by the Bengaluru Urban District Chess Association';

describe('tablePublicUrl', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('points at the production floor page outside the browser', () => {
    expect(tablePublicUrl('abc123def456')).toBe('https://chess-manager.alokas.com/t/abc123def456');
  });

  it('keeps https production URLs in the desktop file:// build', () => {
    vi.stubGlobal('window', { desktop: { isDesktop: true }, location: { origin: 'file://' } });
    expect(tablePublicUrl('slug-1234')).toBe('https://chess-manager.alokas.com/t/slug-1234');
  });

  it('uses the web origin in the browser, as before', () => {
    vi.stubGlobal('window', { location: { origin: 'https://chess-manager.alokas.com' } });
    expect(tablePublicUrl('slug-1234')).toBe('https://chess-manager.alokas.com/t/slug-1234');
  });
});

describe('safeStickerText', () => {
  it('keeps Latin-1 accents, reduces others to the base letter and drops what Helvetica lacks', () => {
    expect(safeStickerText('Örebro Schack Öppna')).toBe('Örebro Schack Öppna');
    expect(safeStickerText('Łódź Open')).toBe('Lódz Open');
    expect(safeStickerText('“Café” Open – Round‑robin')).toBe('“Café” Open – Round-robin');
    expect(safeStickerText('Pune शतरंज Open')).toBe('Pune Open');
    expect(safeStickerText('शतरंज')).toBe('Tournament');
  });
});

describe('stickerFilename', () => {
  it('is a safe slug per format', () => {
    expect(stickerFilename('Örebro Rapid / Open 2026', 'sticker4')).toBe('orebro-rapid-open-2026-table-qr.pdf');
    expect(stickerFilename('X', 'tent2')).toBe('x-table-tents.pdf');
  });
});

// 1-, 2- and 3-digit tables (a big event with several categories), with a partly filled last
// page in every format.
const NUMBERS = [...Array.from({ length: 120 }, (_, i) => i + 1), 128, 250, 999];
const TABLES = makeTables(NUMBERS);

/** Paints a filled rectangle over part of a raster, in PDF points (origin bottom-left). */
function smudge(r: Raster, rect: { x: number; y: number; w: number; h: number }, value: number) {
  const pageH = r.height / r.scale;
  const x0 = Math.round(rect.x * r.scale);
  const y0 = Math.round((pageH - rect.y - rect.h) * r.scale);
  for (let y = y0; y < y0 + Math.round(rect.h * r.scale); y++) {
    for (let x = x0; x < x0 + Math.round(rect.w * r.scale); x++) {
      const i = (y * r.width + x) * 4;
      r.rgba[i] = r.rgba[i + 1] = r.rgba[i + 2] = value;
    }
  }
}

/** Bounding box of pure-black pixels (only the QR modules are pure black) in a region. */
function qrBox(r: Raster, rect: { x: number; y: number; w: number; h: number }) {
  const pageH = r.height / r.scale;
  const x0 = Math.floor(rect.x * r.scale);
  const y0 = Math.floor((pageH - rect.y - rect.h) * r.scale);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = y0; y < y0 + Math.floor(rect.h * r.scale); y++) {
    for (let x = x0; x < x0 + Math.floor(rect.w * r.scale); x++) {
      const i = (y * r.width + x) * 4;
      if (r.rgba[i]! < 8 && r.rgba[i + 1]! < 8 && r.rgba[i + 2]! < 8) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  // Back to PDF points.
  return {
    x: minX / r.scale,
    y: pageH - (maxY + 1) / r.scale,
    w: (maxX + 1 - minX) / r.scale,
    h: (maxY + 1 - minY) / r.scale,
  };
}

describe('QR size and quiet zone', () => {
  it.each(STICKER_FORMATS.map((f) => f.id))('%s: symbol size, module size and a clear quiet zone', async (format) => {
    const bytes = await buildTableStickerPdf('Riverside Spring Rapid 2026', makeTables([42]), { format });
    const doc = await openPdf(bytes);
    const r = await renderPage(doc, 1, 300);
    const region = faceRegions(format, 0)[faceRegions(format, 0).length - 1]!;
    const box = qrBox(r, region);
    const sideMm = box.w / MM;
    if (process.env.STICKER_SAMPLES === '1') console.info(`${format}: QR ${sideMm.toFixed(1)} mm`);
    expect(Math.abs(box.w - box.h)).toBeLessThan(1);
    const modules = 37; // version 5 at level Q for a production URL
    const moduleMm = sideMm / modules;
    const min = { sticker4: 55, tent2: 55, small8: 38 }[format];
    expect(sideMm).toBeGreaterThanOrEqual(min);
    // No ink at all within 4 modules of the symbol.
    const q = 4 * moduleMm * MM;
    const pageH = r.height / r.scale;
    const ring = { x: box.x - q, y: box.y - q, w: box.w + 2 * q, h: box.h + 2 * q };
    const px = (x: number, y: number) => {
      const i = (Math.floor((pageH - y) * r.scale) * r.width + Math.floor(x * r.scale)) * 4;
      return r.rgba[i]! + r.rgba[i + 1]! + r.rgba[i + 2]!;
    };
    let darkest = 765;
    const step = 0.25;
    for (let y = ring.y + 1; y <= ring.y + ring.h - 1; y += step) {
      for (let x = ring.x + 1; x <= ring.x + ring.w - 1; x += step) {
        const inside = x > box.x - 0.5 && x < box.x + box.w + 0.5 && y > box.y - 0.5 && y < box.y + box.h + 0.5;
        if (!inside) darkest = Math.min(darkest, px(x, y));
      }
    }
    expect(darkest, 'quiet zone is white').toBeGreaterThan(740);
  });
});

describe.each(STICKER_FORMATS.map((f) => f.id))('%s PDF', (format) => {
  it(
    'every QR code decodes to its own table URL',
    async () => {
      const bytes = await buildTableStickerPdf('Riverside Spring Rapid 2026', TABLES, { format });
      const doc = await openPdf(bytes);
      const { perPage } = STICKER_LAYOUT[format];
      expect(doc.numPages).toBe(Math.ceil(TABLES.length / perPage));
      for (let p = 1; p <= doc.numPages; p++) {
        // 150 dpi: an ordinary office scan of the sheet.
        const raster = await renderPage(doc, p, 150);
        for (let slot = 0; slot < perPage; slot++) {
          const table = TABLES[(p - 1) * perPage + slot];
          for (const region of faceRegions(format, slot)) {
            const text = decodeRegion(raster, region);
            if (!table) expect(text).toBeNull();
            else expect(text, `table ${table.tableNumber}`).toBe(tablePublicUrl(table.slug));
          }
        }
      }
    },
    60_000,
  );

  it(
    'still decodes with a scuff or ink blot across the code (error correction Q)',
    async () => {
      const subset = makeTables([3, 57, 999]);
      const bytes = await buildTableStickerPdf('Riverside Spring Rapid 2026', subset, { format });
      const doc = await openPdf(bytes);
      const raster = await renderPage(doc, 1, 150);
      subset.forEach((table, slot) => {
        if (slot >= STICKER_LAYOUT[format].perPage) return;
        const region = faceRegions(format, slot)[0]!;
        const box = qrBox(raster, region);
        // A blot a fifth of the symbol across, off-centre (a coffee ring or a pen mark).
        const blot = { x: box.x + box.w * 0.45, y: box.y + box.h * 0.3, w: box.w * 0.2, h: box.h * 0.2 };
        smudge(raster, blot, slot % 2 ? 255 : 0);
        expect(decodeRegion(raster, region), `table ${table.tableNumber}`).toBe(tablePublicUrl(table.slug));
      });
    },
    30_000,
  );

  it(
    'still decodes at the pixel density a phone camera sees from 60 cm',
    async () => {
      // A phone previewing 1920 px across a ~70 degree field covers about 1.4 x distance in width,
      // so at 60 cm it sees ~1920 / (1.4 * 600) = 2.3 px per mm of sticker. (Measured: the
      // standard sticker and tent still read at the 90 cm equivalent; small stickers stop at ~75.)
      const distanceMm = 600;
      const pxPerMm = 1920 / (1.4 * distanceMm);
      const dpi = pxPerMm * 25.4;
      const subset = makeTables([7, 18, 29, 40, 88, 101, 250, 999]);
      const bytes = await buildTableStickerPdf('Riverside Spring Rapid 2026', subset, { format });
      const doc = await openPdf(bytes);
      const { perPage } = STICKER_LAYOUT[format];
      for (let p = 1; p <= doc.numPages; p++) {
        const raster = await renderPage(doc, p, dpi);
        for (let slot = 0; slot < perPage; slot++) {
          const table = subset[(p - 1) * perPage + slot];
          if (!table) continue;
          for (const region of faceRegions(format, slot)) {
            expect(decodeRegion(raster, region), `table ${table.tableNumber}`).toBe(tablePublicUrl(table.slug));
          }
        }
      }
    },
    30_000,
  );

  it(
    'keeps every line of text inside its sticker, even with a very long name and 3-digit tables',
    async () => {
      const many = makeTables([...Array.from({ length: 140 }, (_, i) => i + 1), 999]);
      const bytes = await buildTableStickerPdf(LONG_NAME, many, { format });
      const doc = await openPdf(bytes);
      const { perPage } = STICKER_LAYOUT[format];
      const inset = 4.5 * MM - 0.5;
      for (let p = 1; p <= doc.numPages; p++) {
        const boxes = await textBoxes(doc, p);
        const used = Math.min(perPage, many.length - (p - 1) * perPage);
        const numbersSeen: string[] = [];
        for (const box of boxes) {
          const slot = Array.from({ length: used }, (_, s) => s).find((s) => {
            const t = stickerTile(format, s);
            const cx = (box.x0 + box.x1) / 2;
            const cy = (box.y0 + box.y1) / 2;
            return cx >= t.x && cx <= t.x + t.w && cy >= t.y && cy <= t.y + t.h;
          });
          expect(slot, `"${box.str}" lies in a used tile`).toBeDefined();
          const t = stickerTile(format, slot!);
          const msg = `"${box.str}" on page ${p} stays inside its card`;
          expect(box.x0, msg).toBeGreaterThanOrEqual(t.x + inset);
          expect(box.x1, msg).toBeLessThanOrEqual(t.x + t.w - inset);
          if (format !== 'tent2') {
            expect(box.y0, msg).toBeGreaterThanOrEqual(t.y + inset);
            expect(box.y1, msg).toBeLessThanOrEqual(t.y + t.h - inset);
          } else {
            expect(box.y0, msg).toBeGreaterThanOrEqual(t.y + inset);
            expect(box.y1, msg).toBeLessThanOrEqual(t.y + t.h - inset);
            // Nothing crosses the fold.
            const fold = t.y + t.h / 2;
            expect(box.y1 <= fold + 0.5 || box.y0 >= fold - 0.5, `${msg} (fold)`).toBe(true);
          }
          if (/^\d+$/.test(box.str)) numbersSeen.push(box.str);
        }
        const expected = many
          .slice((p - 1) * perPage, p * perPage)
          .flatMap((tb) => (format === 'tent2' ? [String(tb.tableNumber), String(tb.tableNumber)] : [String(tb.tableNumber)]));
        expect(numbersSeen.sort()).toEqual(expected.sort());
      }
      // The whole long name is printed somewhere (shrunk and wrapped, not cut off).
      const first = (await textBoxes(doc, 1)).map((b) => b.str).join(' ');
      for (const word of ['Karnataka', 'Championship', 'Association']) expect(first).toContain(word);
    },
    60_000,
  );
});

// Writes sample PDFs and PNG previews for design review:
//   STICKER_SAMPLES=1 pnpm vitest run src/lib/tableStickers.test.ts
const SAMPLES_DIR = join(import.meta.dirname, '../../../../docs/design/screenshots/stickers');
describe.runIf(process.env.STICKER_SAMPLES === '1')('samples', () => {
  it(
    'writes sample PDFs and previews',
    async () => {
      mkdirSync(SAMPLES_DIR, { recursive: true });
      const samples: { file: string; name: string; numbers: number[]; format: StickerFormat }[] = [
        { file: 'stickers-4up', name: 'Riverside Spring Rapid 2026', numbers: [1, 2, 14, 27], format: 'sticker4' },
        { file: 'stickers-4up-long', name: LONG_NAME, numbers: [9, 48, 100, 250], format: 'sticker4' },
        { file: 'tents-2up', name: 'Lakeside Junior Open · Under-11', numbers: [7, 112], format: 'tent2' },
        { file: 'stickers-8up', name: 'Hilltop Weekend Blitz', numbers: [1, 2, 3, 14, 27, 64, 100, 999], format: 'small8' },
      ];
      for (const s of samples) {
        const bytes = await buildTableStickerPdf(s.name, makeTables(s.numbers), { format: s.format });
        writeFileSync(join(SAMPLES_DIR, `${s.file}.pdf`), bytes);
        const doc = await openPdf(bytes);
        writeFileSync(join(SAMPLES_DIR, `${s.file}.png`), (await renderPage(doc, 1, 110)).png());
      }
      // A close-up of one sticker's header at 600 dpi, to judge the crown and type.
      const bytes = await buildTableStickerPdf('Riverside Spring Rapid 2026', makeTables([14]), { format: 'sticker4' });
      const doc = await openPdf(bytes);
      const r = await renderPage(doc, 1, 600);
      const tile = stickerTile('sticker4', 0);
      const sx = Math.round(tile.x * r.scale);
      const sy = Math.round((A4_H_PT - tile.y - tile.h) * r.scale);
      const cw = Math.round(tile.w * r.scale);
      const ch = Math.round(48 * MM * r.scale);
      writeFileSync(join(SAMPLES_DIR, 'sticker-header-600dpi.png'), r.crop(sx, sy, cw, ch));
    },
    60_000,
  );
});
