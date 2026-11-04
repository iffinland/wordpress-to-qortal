import { mkdir, writeFile } from 'node:fs/promises';
import zlib from 'node:zlib';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'build/icons');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function png(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function draw(size) {
  const ss = 3;
  const width = size * ss;
  const height = size * ss;
  const pixels = Buffer.alloc(width * height * 4);
  const radius = width * 0.22;
  const center = width / 2;
  const ringRadius = width * 0.27;
  const ringWidth = width * 0.075;
  const cy = width * 0.46;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const dx = Math.max(Math.abs(x - center) - (width / 2 - radius), 0);
      const dy = Math.max(Math.abs(y - height / 2) - (height / 2 - radius), 0);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const inside = 1 - smoothstep(radius - 1.5, radius + 1.5, dist);
      if (inside <= 0) continue;
      const gx = x / width;
      const gy = y / height;
      let r = Math.round(10 + 8 * gx);
      let g = Math.round(26 + 52 * gy);
      let b = Math.round(43 + 72 * gx);
      // Q ring
      const rdx = x - center;
      const rdy = y - cy;
      const rdist = Math.sqrt(rdx * rdx + rdy * rdy);
      const ring = (1 - smoothstep(ringWidth / 2, ringWidth / 2 + 1.6, Math.abs(rdist - ringRadius))) * inside;
      if (ring > 0) {
        r = Math.round(r * (1 - ring) + 236 * ring);
        g = Math.round(g * (1 - ring) + 248 * ring);
        b = Math.round(b * (1 - ring) + 255 * ring);
      }
      // Q tail
      const tailDx = x - (center + ringRadius * 0.62);
      const tailDy = y - (cy + ringRadius * 0.62);
      const along = tailDx * 0.7071 + tailDy * 0.7071;
      const across = Math.abs(-tailDx * 0.7071 + tailDy * 0.7071);
      if (along > 0 && along < width * 0.18 && across < ringWidth * 0.56) {
        const a = inside * (1 - smoothstep(width * 0.15, width * 0.18, along));
        r = Math.round(r * (1 - a) + 45 * a);
        g = Math.round(g * (1 - a) + 212 * a);
        b = Math.round(b * (1 - a) + 191 * a);
      }
      // Migration arrow (bottom)
      const ax = x - center;
      const ay = y - height * 0.79;
      const shaft = Math.abs(ay) < width * 0.028 && ax > -width * 0.20 && ax < width * 0.12;
      const head = ax >= width * 0.10 && ax < width * 0.20 && Math.abs(ay) < (width * 0.20 - ax) * 0.55;
      if ((shaft || head) && Math.abs(ax) < width * 0.21) {
        r = Math.round(r * 0.15 + 45 * 0.85);
        g = Math.round(g * 0.15 + 212 * 0.85);
        b = Math.round(b * 0.15 + 191 * 0.85);
      }
      pixels[index] = r;
      pixels[index + 1] = g;
      pixels[index + 2] = b;
      pixels[index + 3] = Math.round(255 * inside);
    }
  }
  // Downsample with box filter.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const i = (((y * ss + sy) * width) + (x * ss + sx)) * 4;
          r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; a += pixels[i + 3];
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
      out[i + 3] = Math.round(a / n);
    }
  }
  return png(size, size, out);
}

await mkdir(outDir, { recursive: true });
for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  await writeFile(path.join(outDir, size + 'x' + size + '.png'), draw(size));
  console.log('icon ' + size);
}
