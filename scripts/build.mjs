import { build } from 'vite';
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateIcons } from './generate-icons.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist');
const watch = process.argv.includes('--watch');

await generateIcons();
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(join(root, 'public', 'icons'), join(outDir, 'icons'), { recursive: true });

// Static assets first (also in --watch mode, where builds below never resolve).
copyFileSync(join(root, 'manifest.json'), join(outDir, 'manifest.json'));
copyFileSync(join(root, 'src', 'popup', 'popup.css'), join(outDir, 'popup.css'));
writeFileSync(
  join(outDir, 'popup.html'),
  readFileSync(join(root, 'src', 'popup', 'popup.html'), 'utf8'),
);

/**
 * Builds one entry as a standalone IIFE library bundle (no shared chunks,
 * no imports) so it can load as an MV3 content script / classic service
 * worker / popup script.
 */
function buildEntry(entryRelative, jsName) {
  return build({
    root,
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      minify: false,
      target: 'chrome110',
      lib: {
        entry: join(root, entryRelative),
        name: jsName.replace(/[^A-Za-z0-9_]/g, '_'),
        formats: ['iife'],
        fileName: () => `${jsName}.js`,
      },
      ...(watch ? { watch: {} } : {}),
    },
  });
}

await Promise.all([
  buildEntry('src/content/index.ts', 'content'),
  buildEntry('src/background/service-worker.ts', 'service-worker'),
  buildEntry('src/popup/popup.ts', 'popup'),
]);

if (!watch) {
  console.log('MonkeyTax built to dist/ - load dist/ via chrome://extensions (Load unpacked).');
}
