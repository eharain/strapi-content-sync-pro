import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, 'docs');

const OUTPUT_SIZE = 1024;

const logos = [
  { in: 'logo-horizontal.svg', out: 'logo-horizontal.png' },
  { in: 'logo-mark.svg', out: 'logo-mark.png' },
  { in: 'logo-square.svg', out: 'logo-square.png' },
];

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function convertSvgToSquarePng(inputPath, outputPath) {
  // density affects SVG rasterization quality
  const image = sharp(inputPath, { density: 300 });

  // Make all outputs square. For non-square sources (e.g. horizontal logo),
  // letterbox into a square with transparent padding.
  await image
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ quality: 100 })
    .toFile(outputPath);
}

async function main() {
  const missing = [];
  for (const l of logos) {
    const p = path.join(DOCS_DIR, l.in);
    if (!(await exists(p))) missing.push(l.in);
  }

  if (missing.length > 0) {
    throw new Error(`Missing input SVG(s) in docs/: ${missing.join(', ')}`);
  }

  for (const l of logos) {
    const inputPath = path.join(DOCS_DIR, l.in);
    const outputPath = path.join(DOCS_DIR, l.out);
    await convertSvgToSquarePng(inputPath, outputPath);
    // eslint-disable-next-line no-console
    console.log(`Created ${path.relative(ROOT, outputPath)}`);
  }
}

await main();
