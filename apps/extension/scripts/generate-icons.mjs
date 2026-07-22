// Generates the Bookmark AI toolbar icons (a filled rounded plate + white
// bookmark ribbon) as PNGs without any image-library dependency. Run: pnpm icons
//
// THREE color-coded plate variants, one per build target, so the three
// side-by-side installs (prod / dev / local) are instantly distinguishable in
// the toolbar (see apps/extension/CLAUDE.md → Build targets):
//   - public/icon/        prod   near-black plate (#0a0a0a), white mark
//   - public/icon-dev/     dev    GREEN plate (#16a34a),      white mark
//   - public/icon-local/   local  RED plate (#dc2626),        white mark
// Only the PLATE color changes; the glyph/shape is identical across all three.
//
// The mark is the SAME bookmark-ribbon shape as the web favicon
// (apps/web/app/icon.svg) and apple icon — one consistent brand mark
// everywhere. The prod plate is the shadcn-neutral brand palette
// (packages/ui/src/theme.css). A toolbar icon needs a filled plate for
// contrast, so it's plated rather than the transparent silhouette the favicon
// uses. Keep the inBookmark shape in sync with
// apps/web/scripts/generate-apple-icon.mjs.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = [16, 32, 48, 96, 128];
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const FG = [250, 250, 250]; // #fafafa — near-white mark (shared by all targets)

// One entry per build target: { dir, plate-background rgb }.
const TARGETS = [
  { dir: "icon", bg: [10, 10, 10] },       // prod  — #0a0a0a near-black
  { dir: "icon-dev", bg: [22, 163, 74] },  // dev   — #16a34a green-600
  { dir: "icon-local", bg: [220, 38, 38] }, // local — #dc2626 red-600
];

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

// Filled bookmark-ribbon silhouette (matches lucide "Bookmark"): a tall
// rounded-top rectangle with a V-notch cut out of the bottom edge. 3:4-ish
// aspect like the lucide glyph, centered with margin for the plate.
function inBookmark(x, y) {
  const left = 0.32;
  const right = 0.68;
  const top = 0.26;
  const bottom = 0.74;
  if (x < left || x > right || y < top || y > bottom) return false;

  // Rounded top corners (the lucide bookmark's `a2 2` arcs).
  const rr = 0.05;
  if (y < top + rr) {
    if (x < left + rr) {
      const dx = left + rr - x;
      const dy = top + rr - y;
      if (dx * dx + dy * dy > rr * rr) return false;
    } else if (x > right - rr) {
      const dx = x - (right - rr);
      const dy = top + rr - y;
      if (dx * dx + dy * dy > rr * rr) return false;
    }
  }

  // V-notch cut out of the bottom edge (apex points up at the center).
  const notchApex = 0.63;
  const half = (right - left) / 2;
  const lineY = notchApex + (Math.abs(x - 0.5) / half) * (bottom - notchApex);
  return y <= lineY;
}

function render(size, BG) {
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

for (const { dir, bg } of TARGETS) {
  const outDir = join(PUBLIC_DIR, dir);
  mkdirSync(outDir, { recursive: true });
  for (const size of SIZES) {
    const file = join(outDir, `${size}.png`);
    writeFileSync(file, encodePng(size, render(size, bg)));
    console.log(`wrote ${file}`);
  }
}
