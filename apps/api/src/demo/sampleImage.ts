import { deflateSync } from 'node:zlib';

/** A 5x7 font as column bytes: enough for sample receipts, with no image library to install. */
const FONT: Record<string, number[]> = {
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e], B: [0x7f, 0x49, 0x49, 0x49, 0x36], C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x22, 0x1c], E: [0x7f, 0x49, 0x49, 0x49, 0x41], F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x49, 0x7a], H: [0x7f, 0x08, 0x08, 0x08, 0x7f], I: [0x00, 0x41, 0x7f, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3f, 0x01], K: [0x7f, 0x08, 0x14, 0x22, 0x41], L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x0c, 0x02, 0x7f], N: [0x7f, 0x04, 0x08, 0x10, 0x7f], O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06], Q: [0x3e, 0x41, 0x51, 0x21, 0x5e], R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x46, 0x49, 0x49, 0x49, 0x31], T: [0x01, 0x01, 0x7f, 0x01, 0x01], U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f], W: [0x3f, 0x40, 0x38, 0x40, 0x3f], X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07], Z: [0x61, 0x51, 0x49, 0x45, 0x43], '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],
  '1': [0x00, 0x42, 0x7f, 0x40, 0x00], '2': [0x42, 0x61, 0x51, 0x49, 0x46], '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7f, 0x10], '5': [0x27, 0x45, 0x45, 0x45, 0x39], '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
  '7': [0x01, 0x71, 0x09, 0x05, 0x03], '8': [0x36, 0x49, 0x49, 0x49, 0x36], '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08], '.': [0x00, 0x60, 0x60, 0x00, 0x00], ':': [0x00, 0x36, 0x36, 0x00, 0x00],
  '/': [0x20, 0x10, 0x08, 0x04, 0x02], ' ': [0, 0, 0, 0, 0],
};

type Rgb = readonly [number, number, number];

const WHITE: Rgb = [255, 255, 255];
const INK: Rgb = [38, 38, 38];
const FOREST: Rgb = [15, 61, 46];
const RED: Rgb = [180, 28, 28];

class Canvas {
  private readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8Array(width * height * 3).fill(255);
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb): void {
    for (let py = y; py < Math.min(this.height, y + h); py++) {
      for (let px = x; px < Math.min(this.width, x + w); px++) {
        const i = (py * this.width + px) * 3;
        this.pixels[i] = color[0];
        this.pixels[i + 1] = color[1];
        this.pixels[i + 2] = color[2];
      }
    }
  }

  text(x: number, y: number, text: string, scale: number, color: Rgb): void {
    let cursor = x;
    for (const ch of text.toUpperCase()) {
      const glyph = FONT[ch] ?? FONT[' ']!;
      glyph.forEach((column, cx) => {
        for (let cy = 0; cy < 7; cy++) {
          if (column & (1 << cy)) {
            this.rect(cursor + cx * scale, y + cy * scale, scale, scale, color);
          }
        }
      });
      cursor += 6 * scale;
    }
  }

  png(): Uint8Array {
    const raw = new Uint8Array((this.width * 3 + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      const row = y * (this.width * 3 + 1);
      raw[row] = 0;
      raw.set(this.pixels.subarray(y * this.width * 3, (y + 1) * this.width * 3), row + 1);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header[8] = 8;
    header[9] = 2;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  Buffer.from(typed).copy(out, 4);
  out.writeUInt32BE(crc32(typed), 8 + data.length);
  return out;
}

function sampleHeader(canvas: Canvas, title: string): void {
  canvas.rect(0, 0, canvas.width, 56, RED);
  canvas.text(16, 14, 'SAMPLE', 4, WHITE);
  canvas.text(16, 66, title, 2, FOREST);
  canvas.rect(16, 88, canvas.width - 32, 2, FOREST);
}

/** A payment receipt that nobody could take for a real one. PNG bytes. */
export function sampleReceiptPng(input: {
  reference: string;
  payer: string;
  amountCents: number;
  currency: string;
  dateIso: string;
}): Uint8Array {
  const canvas = new Canvas(420, 300);
  sampleHeader(canvas, 'DEMO BANK TRANSFER');
  const amount = `${input.currency} ${(input.amountCents / 100).toFixed(2)}`;
  const lines: Array<[string, string]> = [
    ['AMOUNT', amount],
    ['PAID BY', input.payer.slice(0, 26)],
    ['TO', 'AKADEMI CATUR DEMO'],
    ['REF', input.reference],
    ['DATE', input.dateIso.slice(0, 10)],
  ];
  lines.forEach(([label, value], i) => {
    canvas.text(16, 104 + i * 26, label, 2, FOREST);
    canvas.text(110, 104 + i * 26, value, 2, INK);
  });
  canvas.rect(0, 244, canvas.width, 56, RED);
  canvas.text(16, 256, 'NOT A REAL RECEIPT', 2, WHITE);
  canvas.text(16, 278, 'NO MONEY WAS SENT', 2, WHITE);
  return canvas.png();
}

/** Stands where an organizer's DuitNow QR goes. It isn't a QR code, so it can't be paid. */
export function sampleQrPng(): Uint8Array {
  const canvas = new Canvas(300, 300);
  sampleHeader(canvas, 'DEMO EVENT');
  canvas.rect(40, 104, 220, 136, [240, 240, 240]);
  canvas.text(62, 130, 'NO REAL', 4, INK);
  canvas.text(62, 180, 'PAYMENT', 4, INK);
  canvas.text(16, 262, 'DO NOT PAY', 3, RED);
  return canvas.png();
}

export function pngDataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}
