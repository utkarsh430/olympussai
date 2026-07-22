#!/usr/bin/env node
/**
 * Brand asset pipeline (Section 17).
 *
 *   npm run process-logo
 *
 * Reads the untouched source logo and produces optimized, dark-theme-ready
 * assets. The source is never modified. Crop constants below are the only
 * things to tune if the source art changes.
 *
 * White-background removal is luminance-keyed: pixels are made transparent in
 * proportion to how close to neutral-white they are (high min-channel, low
 * saturation), so the saturated gold artwork stays fully opaque while the white
 * field drops out — without the bright halo naive thresholding leaves on thin
 * anti-aliased rays.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BRAND = path.join(ROOT, 'public', 'brand');
const APP = path.join(ROOT, 'src', 'app');
const SOURCE = path.join(BRAND, 'olympuss-logo-source.png');

// ── Crop constants (2000×2000 source). Easy to adjust. ──────────────────────
// The emblem = sunburst + halo + ascending peak, excluding the wordmark.
const EMBLEM_CROP = { left: 330, top: 110, width: 1340, height: 1250 };

// Near-white keying thresholds (min channel value).
const WHITE_FULL = 236; // >= this → fully transparent
const WHITE_KEEP = 208; // <= this → fully opaque

const GOLD = { bg: '#050507' };

/** Key out the near-white background of an RGB(A) buffer → transparent PNG. */
async function keyWhite(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += channels) {
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    const mn = Math.min(r, g, b);
    let alpha;
    if (mn >= WHITE_FULL) alpha = 0;
    else if (mn <= WHITE_KEEP) alpha = 255;
    else alpha = Math.round(255 * (1 - (mn - WHITE_KEEP) / (WHITE_FULL - WHITE_KEEP)));
    // Combine with any existing alpha.
    out[i + 3] = Math.round((out[i + 3] / 255) * alpha);
  }
  return sharp(out, { raw: { width, height, channels } }).png();
}

/** A transparent, tightly-trimmed emblem at a given size. */
async function makeEmblem(size) {
  const cropped = await sharp(SOURCE).extract(EMBLEM_CROP).png().toBuffer();
  const keyed = await (await keyWhite(cropped)).toBuffer();
  return sharp(keyed)
    .trim({ threshold: 12 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function write(buf, file) {
  await sharp(buf).toFile(file);
  console.log('  ✓', path.relative(ROOT, file));
}

async function main() {
  console.log('Processing brand assets from', path.relative(ROOT, SOURCE));

  // 1. Transparent emblem (header, hero, login, loader).
  const emblem512 = await makeEmblem(512);
  await write(emblem512, path.join(BRAND, 'olympuss-emblem.png'));
  await sharp(emblem512).webp({ quality: 92 }).toFile(path.join(BRAND, 'olympuss-emblem.webp'));
  console.log('  ✓ public/brand/olympuss-emblem.webp');

  // 2. Full logo (with wordmark), trimmed, transparent.
  const fullKeyed = await (await keyWhite(await sharp(SOURCE).png().toBuffer())).toBuffer();
  const full = await sharp(fullKeyed).trim({ threshold: 12 }).resize({ width: 1200 }).png().toBuffer();
  await write(full, path.join(BRAND, 'olympuss-logo-full.png'));
  await sharp(full).webp({ quality: 92 }).toFile(path.join(BRAND, 'olympuss-logo-full.webp'));
  console.log('  ✓ public/brand/olympuss-logo-full.webp');

  // 3. Favicon set (Next.js App Router auto-detects app/icon.png & apple-icon.png).
  //    Emblem on a dark rounded field so it stays visible on any browser chrome.
  const iconBg = (size, radius) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
         <rect width="${size}" height="${size}" rx="${radius}" fill="${GOLD.bg}"/>
       </svg>`,
    );

  const favEmblem = await makeEmblem(400);
  // app/icon.png (512)
  await sharp(iconBg(512, 96))
    .composite([{ input: await sharp(favEmblem).resize(360, 360, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer(), gravity: 'centre' }])
    .png()
    .toFile(path.join(APP, 'icon.png'));
  console.log('  ✓ src/app/icon.png');
  // app/apple-icon.png (180)
  await sharp(iconBg(180, 34))
    .composite([{ input: await sharp(favEmblem).resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer(), gravity: 'centre' }])
    .png()
    .toFile(path.join(APP, 'apple-icon.png'));
  console.log('  ✓ src/app/apple-icon.png');
  // public touch icon copy (Section 17 name)
  await sharp(iconBg(180, 34))
    .composite([{ input: await sharp(favEmblem).resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer(), gravity: 'centre' }])
    .png()
    .toFile(path.join(BRAND, 'olympuss-touch-icon.png'));
  console.log('  ✓ public/brand/olympuss-touch-icon.png');

  // 4. Open Graph image (1200×630): dark field, emblem, wordmark, tagline.
  const ogW = 1200, ogH = 630;
  const ogEmblem = await makeEmblem(300);
  const ogText = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ogW}" height="${ogH}">
       <defs>
         <radialGradient id="glow" cx="32%" cy="45%" r="45%">
           <stop offset="0" stop-color="#D6A13A" stop-opacity="0.22"/>
           <stop offset="0.6" stop-color="#11182A" stop-opacity="0.10"/>
           <stop offset="1" stop-color="#050507" stop-opacity="0"/>
         </radialGradient>
       </defs>
       <rect width="${ogW}" height="${ogH}" fill="#050507"/>
       <rect width="${ogW}" height="${ogH}" fill="url(#glow)"/>
       <text x="470" y="300" font-family="Georgia, 'Times New Roman', serif" font-size="76" letter-spacing="2">
         <tspan fill="#F2EEE7">OLYMPUSS</tspan><tspan fill="#D6A13A" dx="34">AI</tspan>
       </text>
       <text x="472" y="352" font-family="Georgia, serif" font-size="26" fill="#A3A7B2" letter-spacing="1">Intelligence, elevated.</text>
       <text x="472" y="398" font-family="ui-monospace, monospace" font-size="17" fill="#9D7127" letter-spacing="4">ARTIFICIAL INTELLIGENCE · INTELLIGENT SYSTEMS</text>
     </svg>`,
  );
  await sharp({ create: { width: ogW, height: ogH, channels: 4, background: GOLD.bg } })
    .composite([
      { input: ogText, top: 0, left: 0 },
      { input: ogEmblem, top: Math.round((ogH - 300) / 2), left: 90 },
    ])
    .jpeg({ quality: 88 })
    .toFile(path.join(BRAND, 'olympuss-og-image.jpg'));
  console.log('  ✓ public/brand/olympuss-og-image.jpg');

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
