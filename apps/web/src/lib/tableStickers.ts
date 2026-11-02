import {
  PDFDocument,
  StandardFonts,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  type Color,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
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

/**
 * Print formats. Sizes are for A4 printed at 100% ("Actual size"), not "Fit to page".
 * - sticker4: four A6-size stickers per sheet, cut along the dashed lines.
 * - tent2: two table tents per sheet. Cut down the middle, fold each strip across the green band
 *   so the same sticker faces both sides of the table (the top half is printed upside down).
 * - small8: eight small stickers per sheet, for crowded tables; the QR is about 4 cm.
 */
export type StickerFormat = 'sticker4' | 'tent2' | 'small8';

export const STICKER_FORMATS: { id: StickerFormat; label: string; hint: string }[] = [
  {
    id: 'sticker4',
    label: 'Stickers, 4 per A4',
    hint: 'About A6. Print at actual size and cut along the dashed lines.',
  },
  {
    id: 'tent2',
    label: 'Table tents, 2 per A4, fold in half',
    hint: 'Print on card at actual size, cut down the middle, fold across the green band.',
  },
  {
    id: 'small8',
    label: 'Small stickers, 8 per A4',
    hint: 'For crowded tables. The QR code is about 4 cm across, so scan from closer.',
  },
];

export const DEFAULT_STICKER_FORMAT: StickerFormat = 'sticker4';

export function isStickerFormat(value: unknown): value is StickerFormat {
  return STICKER_FORMATS.some((f) => f.id === value);
}

/** The floor flow: scan, then unlock with the round PIN the arbiter desk hands out. */
export const STICKER_INSTRUCTION = 'Scan to score · Round PIN from the arbiter desk';

// ---------------------------------------------------------------------------------------------
// Geometry. PDF points; 1 mm = 72 / 25.4 pt.

const MM = 72 / 25.4;
const A4_W = 595.28;
const A4_H = 841.89;
/** White border between the cut line and the printed card; also keeps ink off the printer margin. */
const INSET = 4.5 * MM;
/** QR quiet zone, in modules (the QR standard asks for at least 4). */
const QUIET_MODULES = 4;
/** Q recovers about 25% damage (a scuffed or coffee-stained sticker) and stays a small symbol. */
const QR_ERROR_CORRECTION = 'Q' as const;

/** Helvetica-Bold digit height as a fraction of the font size. */
const DIGIT_HEIGHT = 0.716;
const CAP_HEIGHT = 0.718;

const COLOR = {
  forest: rgb(15 / 255, 61 / 255, 46 / 255),
  ink: rgb(26 / 255, 46 / 255, 36 / 255),
  sub: rgb(79 / 255, 97 / 255, 87 / 255),
  gold: rgb(212 / 255, 185 / 255, 138 / 255),
  goldLine: rgb(196 / 255, 165 / 255, 116 / 255),
  cream: rgb(250 / 255, 246 / 255, 238 / 255),
  qr: rgb(0, 0, 0),
  cut: rgb(0.62, 0.62, 0.62),
};

/** The Chess Alokas crown (docs/design/logo/crown.svg), in its 24-unit grid; vector, never a bitmap. */
const CROWN_PATH =
  'M10 4a2 2 0 1 0 4 0a2 2 0 1 0 -4 0z' +
  'M1.5 7a2 2 0 1 0 4 0a2 2 0 1 0 -4 0z' +
  'M18.5 7a2 2 0 1 0 4 0a2 2 0 1 0 -4 0z' +
  'M3.9 9.6 7.6 13l3.2-7h2.4l3.2 7 3.7-3.4L18.4 18H5.6z' +
  'M5 19.5h14a1 1 0 0 1 1 1v.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-.5a1 1 0 0 1 1-1z';
/** Crown ink spans x 1.5..22.5 and y 2..22 of the grid. */
const CROWN_BOX = { x: 1.5, y: 2, w: 21, h: 20 };

type Fonts = { bold: PDFFont; regular: PDFFont; charset: Set<number> };

/** A face drawn in its own top-left coordinate space (y grows downward), in points. */
type Face = { page: PDFPage; x: number; top: number; w: number; h: number };

type Qr = { size: number; path: string };

// ---------------------------------------------------------------------------------------------
// Text helpers

/** WinAnsi characters outside Latin-1 that Helvetica draws (quotes, dashes, ellipsis, euro...). */
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

/** Letters and marks with no WinAnsi form and no Unicode decomposition. */
const PLAIN_LETTERS: Record<string, string> = {
  Ł: 'L',
  ł: 'l',
  Đ: 'D',
  đ: 'd',
  Ħ: 'H',
  ħ: 'h',
  ı: 'i',
  Ŧ: 'T',
  ŧ: 't',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '−': '-',
};

/**
 * Keep only characters Helvetica can draw. Accents are kept where WinAnsi has them (é, ö, ñ),
 * otherwise reduced to the base letter; characters outside the font are dropped rather than
 * printed as boxes or question marks.
 */
export function safeStickerText(text: string, charset?: Set<number>, fallback = 'Tournament'): string {
  const supported = (ch: string) => {
    const cp = ch.codePointAt(0)!;
    if (charset) return charset.has(cp);
    return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp);
  };
  let out = '';
  for (const ch of text.normalize('NFC')) {
    if (/\s/.test(ch)) {
      out += ' ';
      continue;
    }
    if (supported(ch)) {
      out += ch;
      continue;
    }
    const plain = PLAIN_LETTERS[ch];
    if (plain) {
      out += plain;
      continue;
    }
    for (const part of ch.normalize('NFKD')) {
      if (!/[̀-ͯ]/.test(part) && supported(part)) out += part;
    }
  }
  return out.replace(/\s+/g, ' ').trim() || fallback;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= maxWidth;
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (fits(next)) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    if (fits(word)) {
      line = word;
      continue;
    }
    // A single word wider than the line: break it by characters.
    let chunk = '';
    for (const ch of word) {
      if (fits(chunk + ch)) chunk += ch;
      else {
        if (chunk) lines.push(chunk);
        chunk = ch;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

const LEADING = 1.15;

/** Height of a block of `n` lines from the first line's cap top to the last line's descender. */
function blockHeight(n: number, size: number): number {
  return size * (CAP_HEIGHT + 0.21) + (n - 1) * size * LEADING;
}

export type FittedText = { lines: string[]; size: number; truncated: boolean };

/**
 * Largest size from `maxSize` down to `minSize` at which the wrapped text fits the box.
 * Only if it cannot fit even at `minSize` is the last line shortened with an ellipsis.
 */
export function fitTextBlock(
  text: string,
  font: PDFFont,
  maxWidth: number,
  maxHeight: number,
  maxSize: number,
  minSize: number,
): FittedText {
  for (let size = maxSize; size >= minSize - 1e-6; size -= 0.25) {
    const lines = wrapText(text, font, size, maxWidth);
    if (blockHeight(lines.length, size) <= maxHeight) return { lines, size, truncated: false };
  }
  const size = minSize;
  let maxLines = 1;
  while (blockHeight(maxLines + 1, size) <= maxHeight) maxLines++;
  const lines = wrapText(text, font, size, maxWidth).slice(0, maxLines);
  let last = lines[lines.length - 1] ?? '';
  while (last && font.widthOfTextAtSize(`${last}…`, size) > maxWidth) last = last.slice(0, -1);
  lines[lines.length - 1] = `${last.trimEnd()}…`;
  return { lines, size, truncated: true };
}

function textWidth(font: PDFFont, text: string, size: number, spacing = 0): number {
  return font.widthOfTextAtSize(text, size) + spacing * Math.max(0, [...text].length - 1);
}

type Align = 'left' | 'center' | 'right';

/** Draws one line with its baseline at `baseline` (face coordinates) and x anchored by `align`. */
function drawLine(
  face: Face,
  text: string,
  opts: {
    x: number;
    baseline: number;
    size: number;
    font: PDFFont;
    color: Color;
    align?: Align;
    spacing?: number;
  },
) {
  const { x, baseline, size, font, color, align = 'left', spacing = 0 } = opts;
  const w = textWidth(font, text, size, spacing);
  const left = align === 'left' ? x : align === 'center' ? x - w / 2 : x - w;
  if (spacing) face.page.pushOperators(pushGraphicsState(), setCharacterSpacing(spacing));
  face.page.drawText(text, { x: face.x + left, y: face.top - baseline, size, font, color });
  if (spacing) face.page.pushOperators(popGraphicsState());
}

// ---------------------------------------------------------------------------------------------
// Shapes

function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: { tl: number; tr: number; br: number; bl: number },
): string {
  const arc = (rad: number, dx: number, dy: number) => (rad ? `a${rad} ${rad} 0 0 1 ${dx} ${dy}` : '');
  return [
    `M${x + r.tl} ${y}`,
    `H${x + w - r.tr}`,
    arc(r.tr, r.tr, r.tr),
    `V${y + h - r.br}`,
    arc(r.br, -r.br, r.br),
    `H${x + r.bl}`,
    arc(r.bl, -r.bl, -r.bl),
    `V${y + r.tl}`,
    arc(r.tl, r.tl, -r.tl),
    'z',
  ].join('');
}

/** Fills an SVG path given in face coordinates (points, y down). */
function fillPath(face: Face, path: string, color: Color, scale = 1, at = { x: 0, y: 0 }) {
  face.page.drawSvgPath(path, { x: face.x + at.x, y: face.top - at.y, scale, color });
}

function strokePath(face: Face, path: string, color: Color, width: number, dash?: number[]) {
  face.page.drawSvgPath(path, {
    x: face.x,
    y: face.top,
    borderColor: color,
    borderWidth: width,
    borderDashArray: dash,
  });
}

function drawCrown(face: Face, x: number, centerY: number, height: number) {
  const scale = height / CROWN_BOX.h;
  fillPath(face, CROWN_PATH, COLOR.gold, scale, {
    x: x - CROWN_BOX.x * scale,
    y: centerY - height / 2 - CROWN_BOX.y * scale,
  });
  return CROWN_BOX.w * scale;
}

// ---------------------------------------------------------------------------------------------
// QR codes

type QrSymbol = ReturnType<typeof QRCode.create>;
type Decoder = (gray: Uint8ClampedArray, size: number) => string | null;

/**
 * The ZXing decoder that the floor page's own "Scan next table" camera uses (bundled inside
 * html5-qrcode). Loaded lazily; if it cannot load, stickers are still made, just unchecked.
 */
let decoderPromise: Promise<Decoder | null> | null = null;
function loadDecoder(): Promise<Decoder | null> {
  decoderPromise ??= import('html5-qrcode/third_party/zxing-js.umd.js')
    .then((mod) => {
      const zx: any = (mod as { default?: unknown }).default ?? mod;
      if (!zx?.QRCodeReader) return null;
      const hints = new Map([[zx.DecodeHintType.TRY_HARDER, true]]);
      const decode: Decoder = (gray, size) => {
        try {
          const source = new zx.RGBLuminanceSource(gray, size, size);
          const bitmap = new zx.BinaryBitmap(new zx.HybridBinarizer(source));
          return String(new zx.QRCodeReader().decode(bitmap, hints).getText());
        } catch {
          return null;
        }
      };
      return decode;
    })
    .catch(() => null);
  return decoderPromise;
}

/** Module sizes, in pixels, at which a symbol must decode: far-away to close-up camera frames. */
const VERIFY_PIXELS = [3, 4, 5, 6, 8, 10];

/** How many of the test views (every size, four camera orientations) decode to `url`. */
function readScore(symbol: QrSymbol, url: string, decode: Decoder): number {
  const n = symbol.modules.size;
  const data = symbol.modules.data;
  // Module (r, c) as seen with the camera turned by `turn` quarter turns.
  const dark = (r: number, c: number, turn: number) => {
    for (let t = 0; t < turn; t++) [r, c] = [c, n - 1 - r];
    return data[r * n + c];
  };
  let score = 0;
  for (let turn = 0; turn < 4; turn++) {
    for (const px of VERIFY_PIXELS) {
      const size = (n + 2 * QUIET_MODULES) * px;
      const gray = new Uint8ClampedArray(size * size).fill(255);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (!dark(r, c, turn)) continue;
          const y0 = (r + QUIET_MODULES) * px;
          const x0 = (c + QUIET_MODULES) * px;
          for (let y = y0; y < y0 + px; y++) gray.fill(0, y * size + x0, y * size + x0 + px);
        }
      }
      if (decode(gray, size) === url) score++;
    }
  }
  return score;
}

/**
 * The QR library picks the mask with the lowest standard penalty, but ZXing (the in-app
 * scanner) misses a few percent of perfectly drawn symbols at some sizes or orientations. So
 * every symbol is decoded before printing, at every size and in four orientations, and if any
 * view fails the other masks are tried. All eight masks are equally valid QR codes; this only
 * picks one our own scanner reads every way up. Phone camera apps read any of them.
 */
async function chooseQrSymbol(url: string): Promise<QrSymbol> {
  const preferred = QRCode.create(url, { errorCorrectionLevel: QR_ERROR_CORRECTION });
  const decode = await loadDecoder();
  if (!decode) return preferred;
  const full = 4 * VERIFY_PIXELS.length;
  let best = preferred;
  let bestScore = readScore(preferred, url, decode);
  for (let mask = 0; mask < 8 && bestScore < full; mask++) {
    if (mask === preferred.maskPattern) continue;
    const symbol = QRCode.create(url, {
      errorCorrectionLevel: QR_ERROR_CORRECTION,
      maskPattern: mask as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
    });
    const score = readScore(symbol, url, decode);
    if (score > bestScore) [best, bestScore] = [symbol, score];
  }
  return best;
}

async function buildQr(url: string): Promise<Qr> {
  const { modules } = await chooseQrSymbol(url);
  const n = modules.size;
  let path = '';
  // One filled path of horizontal runs: crisp vector modules, no seams between them.
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!modules.data[r * n + c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && modules.data[r * n + c]) c++;
      path += `M${start} ${r}h${c - start}v1h${start - c}z`;
    }
  }
  return { size: n, path };
}

/** Draws the symbol with its top-left at (x, y) in face coordinates; `side` is the symbol width. */
function drawQr(face: Face, qr: Qr, x: number, y: number, side: number) {
  fillPath(face, qr.path, COLOR.qr, side / qr.size, { x, y });
}

/** Largest symbol whose quiet zone fits a `w` x `h` area, in points. */
function qrSideFor(qr: Qr, w: number, h: number, maxSide: number): number {
  const total = qr.size + 2 * QUIET_MODULES;
  return Math.min(maxSide, (Math.min(w, h) / total) * qr.size);
}

// ---------------------------------------------------------------------------------------------
// Sticker faces

type FaceContent = { name: string; tableNumber: number; url: string; qr: Qr };

function drawBrand(face: Face, fonts: Fonts, x: number, centerY: number, crownH: number, size: number) {
  const crownW = drawCrown(face, x, centerY, crownH);
  const gap = crownH * 0.35;
  drawLine(face, 'Chess Alokas', {
    x: x + crownW + gap,
    baseline: centerY + (size * CAP_HEIGHT) / 2,
    size,
    font: fonts.bold,
    color: COLOR.cream,
  });
  return crownW + gap + fonts.bold.widthOfTextAtSize('Chess Alokas', size);
}

function drawNameBlock(
  face: Face,
  fonts: Fonts,
  fit: FittedText,
  x: number,
  top: number,
  height: number,
  align: Align,
) {
  const h = blockHeight(fit.lines.length, fit.size);
  const firstBaseline = top + (height - h) / 2 + fit.size * CAP_HEIGHT;
  fit.lines.forEach((line, i) =>
    drawLine(face, line, {
      x,
      baseline: firstBaseline + i * fit.size * LEADING,
      size: fit.size,
      font: fonts.bold,
      color: COLOR.cream,
      align,
    }),
  );
}

/** Font size for the table number: as tall as `capHeight`, never wider than `maxWidth`. */
function numberSize(fonts: Fonts, label: string, capHeight: number, maxWidth: number): number {
  const bySize = capHeight / DIGIT_HEIGHT;
  const byWidth = maxWidth / fonts.bold.widthOfTextAtSize(label, 1);
  return Math.min(bySize, byWidth);
}

/**
 * Portrait face, used by the 4-up sticker and both halves of the table tent:
 * green band (crown, Chess Alokas, tournament name), TABLE and a very large number,
 * the QR code with its quiet zone, the URL under it, and the one-line instruction.
 * `flushTop` makes the band run square into the top edge (the fold of a tent).
 */
function drawPortraitFace(face: Face, fonts: Fonts, c: FaceContent, flushTop: boolean) {
  const { w, h } = face;
  const pad = 5.5 * MM;
  const bandH = 22 * MM;
  const r = 3 * MM;
  const cardRadius = flushTop ? { tl: 0, tr: 0, br: r, bl: r } : { tl: r, tr: r, br: r, bl: r };

  fillPath(face, roundedRectPath(0, 0, w, bandH, { ...cardRadius, br: 0, bl: 0 }), COLOR.forest);

  // Brand row, centred.
  const brandSize = 10;
  const crownH = 5.6 * MM;
  const brandY = (flushTop ? 7.5 : 6.5) * MM;
  const brandW = (crownH / CROWN_BOX.h) * CROWN_BOX.w + crownH * 0.35 + fonts.bold.widthOfTextAtSize('Chess Alokas', brandSize);
  drawBrand(face, fonts, (w - brandW) / 2, brandY, crownH, brandSize);

  // Tournament name: wraps to as many lines as fit, shrinking from 13 pt to 7 pt.
  const nameTop = brandY + 4.2 * MM;
  const nameH = bandH - nameTop - 2.2 * MM;
  const nameFit = fitTextBlock(c.name, fonts.bold, w - 2 * pad, nameH, 13, 7);
  drawNameBlock(face, fonts, nameFit, w / 2, nameTop, nameH, 'center');

  // TABLE + number.
  const labelBaseline = bandH + 6.5 * MM;
  drawLine(face, 'TABLE', {
    x: w / 2,
    baseline: labelBaseline,
    size: 11,
    font: fonts.bold,
    color: COLOR.forest,
    align: 'center',
    spacing: 3,
  });
  const numLabel = String(c.tableNumber);
  const numTop = labelBaseline + 2.5 * MM;
  const numSize = numberSize(fonts, numLabel, 26 * MM, w - 2 * pad);
  const numBaseline = numTop + numSize * DIGIT_HEIGHT;
  drawLine(face, numLabel, {
    x: w / 2,
    baseline: numBaseline,
    size: numSize,
    font: fonts.bold,
    color: COLOR.forest,
    align: 'center',
  });

  // Footer: instruction on the bottom line, the URL just above it (under the QR).
  const bottomPad = 5 * MM;
  const instrBaseline = h - bottomPad;
  const instrSize = fitTextBlock(STICKER_INSTRUCTION, fonts.bold, w - 2 * pad, 9 * 0.93, 9, 6).size;
  drawLine(face, STICKER_INSTRUCTION, {
    x: w / 2,
    baseline: instrBaseline,
    size: instrSize,
    font: fonts.bold,
    color: COLOR.ink,
    align: 'center',
  });
  const urlSize = Math.min(7, ((w - 2 * pad) / fonts.regular.widthOfTextAtSize(c.url, 1)) * 0.98);
  const urlBaseline = instrBaseline - 4.4 * MM;
  drawLine(face, c.url, {
    x: w / 2,
    baseline: urlBaseline,
    size: urlSize,
    font: fonts.regular,
    color: COLOR.sub,
    align: 'center',
  });

  // QR in the space between the number and the URL, quiet zone included.
  const areaTop = numBaseline + 1.5 * MM;
  const areaBottom = urlBaseline - urlSize * CAP_HEIGHT - 0.8 * MM;
  const side = qrSideFor(c.qr, w - 2 * MM, areaBottom - areaTop, 62 * MM);
  const quiet = (side / c.qr.size) * QUIET_MODULES;
  const qrTop = areaTop + (areaBottom - areaTop - side - 2 * quiet) / 2 + quiet;
  drawQr(face, c.qr, (w - side) / 2, qrTop, side);
}

/**
 * Landscape face for small stickers: band with brand and name, TABLE + number on the left,
 * the QR on the right, the instruction under the number and the URL along the bottom.
 */
function drawLandscapeFace(face: Face, fonts: Fonts, c: FaceContent) {
  const { w, h } = face;
  const pad = 4 * MM;
  const bandH = 11 * MM;
  const r = 2.5 * MM;
  fillPath(face, roundedRectPath(0, 0, w, bandH, { tl: r, tr: r, br: 0, bl: 0 }), COLOR.forest);

  const brandW = drawBrand(face, fonts, pad, bandH / 2, 4.6 * MM, 8.5);
  const nameLeft = pad + brandW + 4 * MM;
  const nameFit = fitTextBlock(c.name, fonts.bold, w - pad - nameLeft, bandH - 2 * MM, 9, 5.5);
  drawNameBlock(face, fonts, nameFit, w - pad, 1 * MM, bandH - 2 * MM, 'right');

  // URL along the bottom, right-aligned (it sits under the QR).
  const urlBaseline = h - 3.5 * MM;
  const urlSize = Math.min(6, ((w - 2 * pad) / fonts.regular.widthOfTextAtSize(c.url, 1)) * 0.98);
  drawLine(face, c.url, {
    x: w - pad,
    baseline: urlBaseline,
    size: urlSize,
    font: fonts.regular,
    color: COLOR.sub,
    align: 'right',
  });

  // QR on the right.
  const areaTop = bandH + 0.8 * MM;
  const areaBottom = urlBaseline - urlSize * CAP_HEIGHT - 0.6 * MM;
  const side = qrSideFor(c.qr, w, areaBottom - areaTop, 50 * MM);
  const quiet = (side / c.qr.size) * QUIET_MODULES;
  const qrLeft = w - 1.5 * MM - quiet - side;
  const qrTop = areaTop + (areaBottom - areaTop - side - 2 * quiet) / 2 + quiet;
  drawQr(face, c.qr, qrLeft, qrTop, side);

  // Left column: TABLE, number, two-line instruction above the URL line.
  const colW = qrLeft - quiet - pad - 1 * MM;
  const colX = pad;
  const labelBaseline = bandH + 5 * MM;
  drawLine(face, 'TABLE', {
    x: colX,
    baseline: labelBaseline,
    size: 8.5,
    font: fonts.bold,
    color: COLOR.forest,
    spacing: 2.2,
  });
  const instr2Baseline = urlBaseline - 4 * MM;
  const instr1Baseline = instr2Baseline - 3.3 * MM;
  const numTop = labelBaseline + 2 * MM;
  const numLabel = String(c.tableNumber);
  const numSize = numberSize(fonts, numLabel, instr1Baseline - 3.6 * MM - numTop, colW);
  drawLine(face, numLabel, {
    x: colX - numSize * 0.02,
    baseline: numTop + numSize * DIGIT_HEIGHT,
    size: numSize,
    font: fonts.bold,
    color: COLOR.forest,
  });
  const [first, second] = STICKER_INSTRUCTION.split(' · ');
  const l1 = Math.min(8, (colW / fonts.bold.widthOfTextAtSize(first!, 1)) * 0.98);
  const l2 = Math.min(7, (colW / fonts.regular.widthOfTextAtSize(second!, 1)) * 0.98);
  drawLine(face, first!, { x: colX, baseline: instr1Baseline, size: l1, font: fonts.bold, color: COLOR.ink });
  drawLine(face, second!, { x: colX, baseline: instr2Baseline, size: l2, font: fonts.regular, color: COLOR.ink });
}

function strokeCard(face: Face, radius: { tl: number; tr: number; br: number; bl: number }) {
  strokePath(face, roundedRectPath(0, 0, face.w, face.h, radius), COLOR.goldLine, 0.9);
}

/** Runs `draw` with the page rotated 180 degrees about the centre of `face`. */
function upsideDown(face: Face, draw: () => void) {
  const cx = face.x + face.w / 2;
  const cy = face.top - face.h / 2;
  face.page.pushOperators(pushGraphicsState(), concatTransformationMatrix(-1, 0, 0, -1, 2 * cx, 2 * cy));
  draw();
  face.page.pushOperators(popGraphicsState());
}

function dashedLine(page: PDFPage, x1: number, y1: number, x2: number, y2: number, color = COLOR.cut) {
  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness: 0.6,
    color,
    dashArray: [4, 3],
  });
}

// ---------------------------------------------------------------------------------------------
// Pages

type Layout = { cols: number; rows: number; perPage: number };

export const STICKER_LAYOUT: Record<StickerFormat, Layout> = {
  sticker4: { cols: 2, rows: 2, perPage: 4 },
  tent2: { cols: 2, rows: 1, perPage: 2 },
  small8: { cols: 2, rows: 4, perPage: 8 },
};

/** Tile rectangle (PDF coordinates, origin bottom-left) for slot `slot` on a page. */
export function stickerTile(format: StickerFormat, slot: number) {
  const { cols, rows } = STICKER_LAYOUT[format];
  const w = A4_W / cols;
  const h = A4_H / rows;
  const col = slot % cols;
  const row = Math.floor(slot / cols);
  return { x: col * w, y: A4_H - (row + 1) * h, w, h };
}

function drawCutLines(page: PDFPage, format: StickerFormat) {
  const { cols, rows } = STICKER_LAYOUT[format];
  for (let c = 1; c < cols; c++) dashedLine(page, (A4_W / cols) * c, 0, (A4_W / cols) * c, A4_H);
  for (let r = 1; r < rows; r++) dashedLine(page, 0, (A4_H / rows) * r, A4_W, (A4_H / rows) * r);
}

function drawTile(page: PDFPage, format: StickerFormat, slot: number, fonts: Fonts, c: FaceContent) {
  const tile = stickerTile(format, slot);
  if (format === 'tent2') {
    // Two faces meeting at the fold (the tile's middle); bands touch the fold on both sides.
    const foldY = tile.y + tile.h / 2;
    const w = tile.w - 2 * INSET;
    const faceH = tile.h / 2 - INSET;
    const lower: Face = { page, x: tile.x + INSET, top: foldY, w, h: faceH };
    const upper: Face = { page, x: tile.x + INSET, top: tile.y + tile.h - INSET, w, h: faceH };
    drawPortraitFace(lower, fonts, c, true);
    upsideDown(upper, () => drawPortraitFace(upper, fonts, c, true));
    const r = 3 * MM;
    const card: Face = { page, x: lower.x, top: upper.top, w, h: 2 * faceH };
    strokeCard(card, { tl: r, tr: r, br: r, bl: r });
    // Fold guide: dashed across the band, and ticks in the margins outside the card.
    dashedLine(page, lower.x + 2 * MM, foldY, lower.x + w - 2 * MM, foldY, COLOR.gold);
    dashedLine(page, tile.x, foldY, lower.x - 1 * MM, foldY);
    dashedLine(page, lower.x + w + 1 * MM, foldY, tile.x + tile.w, foldY);
    return;
  }
  const face: Face = {
    page,
    x: tile.x + INSET,
    top: tile.y + tile.h - INSET,
    w: tile.w - 2 * INSET,
    h: tile.h - 2 * INSET,
  };
  const r = (format === 'small8' ? 2.5 : 3) * MM;
  if (format === 'small8') drawLandscapeFace(face, fonts, c);
  else drawPortraitFace(face, fonts, c, false);
  strokeCard(face, { tl: r, tr: r, br: r, bl: r });
}

export type StickerOptions = { format?: StickerFormat };

export async function buildTableStickerPdf(
  tournamentName: string,
  tables: StickerTable[],
  options: StickerOptions = {},
): Promise<Uint8Array> {
  const format = options.format ?? DEFAULT_STICKER_FORMAT;
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const regularSet = new Set(regular.getCharacterSet());
  const charset = new Set(bold.getCharacterSet().filter((cp) => regularSet.has(cp)));
  const fonts: Fonts = { bold, regular, charset };
  const name = safeStickerText(tournamentName, charset);
  pdf.setTitle(`${name} · table QR ${format === 'tent2' ? 'tents' : 'stickers'}`);
  pdf.setCreator('Chess Alokas');
  pdf.setProducer('Chess Alokas');

  const { perPage } = STICKER_LAYOUT[format];
  let page: PDFPage | null = null;
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i]!;
    const slot = i % perPage;
    if (slot === 0) {
      page = pdf.addPage([A4_W, A4_H]);
      drawCutLines(page, format);
    }
    const url = tablePublicUrl(table.slug);
    const qr = await buildQr(url);
    drawTile(page!, format, slot, fonts, { name, tableNumber: table.tableNumber, url, qr });
  }
  return pdf.save();
}

export function stickerFilename(tournamentName: string, format: StickerFormat): string {
  const base =
    tournamentName
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tournament';
  const kind = format === 'tent2' ? 'table-tents' : format === 'small8' ? 'table-qr-small' : 'table-qr';
  return `${base}-${kind}.pdf`;
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
