// Generates the PNG icons from the same shapes as icons/icon.svg, so the
// installed icon matches the in-page one. No image dependencies: writes PNG
// chunks directly. Run with `npm run icons` after changing the design.
//
// Deliberately a different palette and motif to the reference-tracker icon --
// with both apps installed, the two need to be tellable apart at thumbnail
// size on a home screen.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

const BG = [0x0f, 0x17, 0x20];
const SHELF = [0x8f, 0xa3, 0xb8];
const BOX = [0xe0, 0xa4, 0x58];

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // truecolour RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixels(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Shared geometry, in 0..1 units, so SVG and PNG stay in step. */
const UPRIGHTS = [
  { x0: 0.120, x1: 0.155, y0: 0.22, y1: 0.84 },
  { x0: 0.845, x1: 0.880, y0: 0.22, y1: 0.84 },
];
const RAILS = [
  { x0: 0.12, x1: 0.88, y0: 0.475, y1: 0.510 },
  { x0: 0.12, x1: 0.88, y0: 0.805, y1: 0.840 },
];
const BOXES = [
  { x0: 0.19, x1: 0.40, y0: 0.280, y1: 0.475 },
  { x0: 0.46, x1: 0.63, y0: 0.340, y1: 0.475 },
  { x0: 0.19, x1: 0.36, y0: 0.600, y1: 0.805 },
  { x0: 0.42, x1: 0.68, y0: 0.660, y1: 0.805 },
];

const hit = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

function shade(u, v, inset) {
  // Map into the inset content box (maskable icons keep clear of the edges).
  const s = 1 - 2 * inset;
  const x = (u - inset) / s;
  const y = (v - inset) / s;
  if (x < 0 || x > 1 || y < 0 || y > 1) return BG;

  for (const b of BOXES) if (hit(b, x, y)) return BOX;
  for (const r of RAILS) if (hit(r, x, y)) return SHELF;
  for (const p of UPRIGHTS) if (hit(p, x, y)) return SHELF;
  return BG;
}

function build(size, inset) {
  return png(size, (x, y) => shade((x + 0.5) / size, (y + 0.5) / size, inset));
}

const files = [
  ['icon-180.png', 180, 0.06],
  ['icon-192.png', 192, 0.06],
  ['icon-512.png', 512, 0.06],
  ['icon-maskable-512.png', 512, 0.20],
];

for (const [name, size, inset] of files) {
  writeFileSync(join(OUT, name), build(size, inset));
  console.log('wrote icons/' + name);
}

// Same rectangles, expressed at 100x100. translate(6 6) scale(0.88) reproduces
// the 0.06 inset the PNGs use.
const rect = (r, fill) =>
  `    <rect x="${(r.x0 * 100).toFixed(1)}" y="${(r.y0 * 100).toFixed(1)}" ` +
  `width="${((r.x1 - r.x0) * 100).toFixed(1)}" height="${((r.y1 - r.y0) * 100).toFixed(1)}" fill="${fill}"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Home Organiser">
  <rect width="100" height="100" rx="18" fill="#0f1720"/>
  <g transform="translate(6 6) scale(0.88)">
${[...UPRIGHTS, ...RAILS].map((r) => rect(r, '#8fa3b8')).join('\n')}
${BOXES.map((r) => rect(r, '#e0a458')).join('\n')}
  </g>
</svg>
`;
writeFileSync(join(OUT, 'icon.svg'), svg);
console.log('wrote icons/icon.svg');
