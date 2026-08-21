/**
 * يضغط صور الموقع ويولّد نسخ WebP بأحجام مناسبة للعرض الفعلي.
 * الصور الأصلية كانت تتجاوز 2.4 ميجابايت للصورة الواحدة، وهو ما يضر بسرعة
 * الموقع وبتقييم Core Web Vitals لدى جوجل مباشرة.
 *
 * الأصول تبقى كما هي على القرص، وتُضاف بجانبها نسخة .webp يشير إليها الموقع.
 *
 *   node tools/optimize-images.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.join(ROOT, "assets");

/** أقصى عرض لكل مجلد، مبني على الحجم الفعلي الذي تُعرض به الصورة في التصميم. */
const MAX_WIDTH = {
  "assets/clients": 480,
  "assets/trust": 480,
  "assets/office": 1600,
  "assets/uploads": 1600,
  "assets": 1024,
};

const SKIP_DIRS = new Set(["vendor", "fonts", "legal-documents"]);

function maxWidthFor(relDir) {
  return MAX_WIDTH[relDir.replace(/\\/g, "/")] ?? 1280;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
    } else if (/\.(png|jpe?g)$/i.test(entry.name)) {
      yield path.join(dir, entry.name);
    }
  }
}

const kb = (bytes) => (bytes / 1024).toFixed(0) + "KB";

let savedBytes = 0;
let count = 0;

for (const file of walk(ASSETS)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const relDir = path.dirname(rel);
  const target = file.replace(/\.(png|jpe?g)$/i, ".webp");

  const source = sharp(file);
  const meta = await source.metadata();
  const limit = maxWidthFor(relDir);
  const width = meta.width && meta.width > limit ? limit : undefined;

  const buffer = await sharp(file)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 82, effort: 6 })
    .toBuffer();

  const originalSize = fs.statSync(file).size;
  fs.writeFileSync(target, buffer);
  savedBytes += originalSize - buffer.length;
  count += 1;
  console.log(`  ${rel}  ${kb(originalSize)} → ${kb(buffer.length)}`);
}

// شعار مضغوط بصيغة PNG لأيقونة أجهزة أبل والمشاركة (لا تدعم كل المنصات WebP).
await sharp(path.join(ASSETS, "logo.png"))
  .resize({ width: 512, withoutEnlargement: true })
  .png({ quality: 90, compressionLevel: 9, palette: true })
  .toFile(path.join(ASSETS, "apple-touch-icon.png"));

// صورة المشاركة (Open Graph) بمقاس 1200×630 الذي تتوقعه المنصات.
await sharp(path.join(ASSETS, "office/office-reception.png"))
  .resize({ width: 1200, height: 630, fit: "cover", position: "center" })
  .png({ quality: 88, compressionLevel: 9 })
  .toFile(path.join(ASSETS, "og-cover.png"));

console.log(`\n✓ ${count} صورة — الوفر: ${(savedBytes / 1024 / 1024).toFixed(1)}MB`);
console.log("✓ assets/apple-touch-icon.png");
console.log("✓ assets/og-cover.png");
