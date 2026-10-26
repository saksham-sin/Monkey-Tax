import sharp from 'sharp';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function generateIcons() {
  const source = join(root, '1f412.png');
  const output = join(root, 'public', 'icons');
  mkdirSync(output, { recursive: true });
  await Promise.all([16, 32, 48, 128].map(async (size) => {
    const padding = Math.max(1, Math.round(size * 0.08));
    const contentSize = size - padding * 2;
    await sharp(source)
      .trim()
      .resize(contentSize, contentSize, { fit: 'contain', background: '#00000000' })
      .extend({ top: padding, bottom: padding, left: padding, right: padding, background: '#00000000' })
      .png()
      .toFile(join(output, `icon-${size}.png`));
  }));
  copyFileSync(source, join(output, 'monkey-logo.png'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateIcons();
  console.log('MonkeyTax icons generated in public/icons/');
}