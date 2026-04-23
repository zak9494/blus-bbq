#!/usr/bin/env node
/* Generates placeholder PWA icons into static/icons/.
   All icons are solid orange (#FF8800) with white pixel-art "BB" glyph.
   Run: node scripts/gen-icons.js
   Replace files in static/icons/ with real logo assets — no code changes needed. */
'use strict';
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 for PNG chunk integrity
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(d.length, 0);
  const combined = Buffer.concat([t, d]);
  const crc = Buffer.allocUnsafe(4); crc.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crc]);
}

// 5×7 pixel-art glyph for letter "B"
const GLYPH_B = [
  0b11110,
  0b10001,
  0b10001,
  0b11110,
  0b10001,
  0b10001,
  0b11110,
];
const GLYPH_W = 5, GLYPH_H = 7;

function drawGlyph(rgba, w, glyph, cx, cy, scale, fgR, fgG, fgB) {
  for (let row = 0; row < glyph.length; row++) {
    for (let bit = 0; bit < GLYPH_W; bit++) {
      if (glyph[row] & (1 << (GLYPH_W - 1 - bit))) {
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = cx + bit * scale + sx;
            const py = cy + row * scale + sy;
            const idx = (py * w + px) * 4;
            rgba[idx] = fgR; rgba[idx+1] = fgG; rgba[idx+2] = fgB; rgba[idx+3] = 255;
          }
        }
      }
    }
  }
}

function generatePNG(size, bgR, bgG, bgB, fgR, fgG, fgB) {
  const w = size, h = size;
  const rgba = new Uint8Array(w * h * 4);

  // Fill background
  for (let i = 0; i < w * h; i++) {
    rgba[i*4] = bgR; rgba[i*4+1] = bgG; rgba[i*4+2] = bgB; rgba[i*4+3] = 255;
  }

  // Draw "BB" centered — two glyphs side by side
  const scale = Math.max(1, Math.floor(size / 22));
  const gap   = Math.max(2, scale * 2);
  const totalW = GLYPH_W * scale * 2 + gap;
  const totalH = GLYPH_H * scale;
  const x0 = Math.floor((w - totalW) / 2);
  const y0 = Math.floor((h - totalH) / 2);

  drawGlyph(rgba, w, GLYPH_B, x0,                         y0, scale, fgR, fgG, fgB);
  drawGlyph(rgba, w, GLYPH_B, x0 + GLYPH_W * scale + gap, y0, scale, fgR, fgG, fgB);

  // Build PNG scanlines (filter byte 0 = None + RGBA)
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.allocUnsafe(1 + w * 4);
    row[0] = 0;
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4, dst = 1 + x * 4;
      row[dst] = rgba[src]; row[dst+1] = rgba[src+1];
      row[dst+2] = rgba[src+2]; row[dst+3] = rgba[src+3];
    }
    rows.push(row);
  }
  const compressed = zlib.deflateSync(Buffer.concat(rows), { level: 6 });

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.resolve(__dirname, '../static/icons');
fs.mkdirSync(outDir, { recursive: true });

// Brand: #FF8800 bg, white text
const BG = [0xFF, 0x88, 0x00];
const FG = [0xFF, 0xFF, 0xFF];

const icons = [
  { file: 'icon-192.png',          size: 192 },
  { file: 'icon-512.png',          size: 512 },
  { file: 'icon-maskable-512.png', size: 512 },
  { file: 'apple-touch-icon.png',  size: 180 },
];

for (const { file, size } of icons) {
  const png = generatePNG(size, ...BG, ...FG);
  fs.writeFileSync(path.join(outDir, file), png);
  console.log(`✓  ${file}  (${size}×${size})`);
}
console.log('Icons written to static/icons/. Swap with real logo assets — no code changes needed.');
