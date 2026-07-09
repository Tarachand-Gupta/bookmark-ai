// Generates placeholder extension icons (rounded square + bookmark glyph)
// as PNGs without any image-library dependency. Run: pnpm icons
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = [16, 32, 48, 96, 128];
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icon");
const BG = [79, 70, 229]; // indigo-600
const FG = [255, 255, 255];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Shape tests in normalized [0,1] coordinates.
function inRoundedSquare(x, y) {
  const r = 0.2;
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
  return dx * dx + dy * dy <= r * r;
}

function inBookmark(x, y) {
  if (x < 0.34 || x > 0.66 || y < 0.24 || y > 0.76) return false;
  // V-notch cut out of the bottom edge.
  const notchTop = 0.62;
  const half = 0.16;
  const lineY = notchTop + (Math.abs(x - 0.5) / half) * (0.76 - notchTop);
  return y <= lineY;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const S = 4; // supersampling for smooth edges
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0;
      let fgHits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          if (!inRoundedSquare(x, y)) continue;
          bgHits++;
          if (inBookmark(x, y)) fgHits++;
        }
      }
      const total = S * S;
      const alpha = bgHits / total;
      if (alpha === 0) continue;
      const mix = fgHits / bgHits;
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) {
        rgba[i + c] = Math.round(BG[c] + (FG[c] - BG[c]) * mix);
      }
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${file}`);
}
