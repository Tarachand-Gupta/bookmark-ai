// Generates apps/web/app/apple-icon.png — the 180x180 apple-touch icon for
// iOS home screens / pinned tabs. Same bookmark-ribbon mark as the web favicon
// (apps/web/app/icon.svg) and the extension toolbar icon, but full-bleed:
// a solid near-black field with a near-white mark, no transparency (iOS renders
// touch icons poorly with alpha and applies its own rounded-corner mask).
//
// Dependency-free PNG encoder, same technique as
// apps/extension/scripts/generate-icons.mjs. Keep the inBookmark shape in sync
// with that generator. Run: pnpm apple-icon
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 180;
const OUT_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "apple-icon.png");
const BG = [10, 10, 10]; // #0a0a0a — near-black field (shadcn neutral)
const FG = [250, 250, 250]; // #fafafa — near-white mark

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

// Filled bookmark-ribbon silhouette (matches lucide "Bookmark"): a tall
// rounded-top rectangle with a V-notch cut out of the bottom edge. Must match
// apps/extension/scripts/generate-icons.mjs.
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

// Full-bleed: every pixel is opaque; the mark is anti-aliased over the field.
function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const S = 4; // supersampling for smooth edges
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let fgHits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          if (inBookmark(x, y)) fgHits++;
        }
      }
      const mix = fgHits / (S * S);
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) {
        rgba[i + c] = Math.round(BG[c] + (FG[c] - BG[c]) * mix);
      }
      rgba[i + 3] = 255; // opaque — apple touch icons dislike transparency
    }
  }
  return rgba;
}

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, encodePng(SIZE, render(SIZE)));
console.log(`wrote ${OUT_FILE}`);
