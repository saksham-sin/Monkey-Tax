import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { marked, Renderer } from 'marked';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const docsDir = path.join(root, 'docs');
const sourcePath = path.join(docsDir, 'showcase.md');
const outputPath = path.join(docsDir, 'showcase.pdf');
const markdown = await readFile(sourcePath, 'utf8');
const imageAssets = new Map();
const imageRefs = [...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)];
await Promise.all(imageRefs.map(async ([, href]) => {
  const imagePath = path.resolve(docsDir, decodeURIComponent(href));
  if (!imagePath.startsWith(`${path.resolve(docsDir)}${path.sep}`)) {
    throw new Error(`Image path escapes docs directory: ${href}`);
  }
  imageAssets.set(href, await readFile(imagePath));
}));

// Embed gallery screenshots as data URLs so the resulting PDF is self-contained.
const renderer = new Renderer();
renderer.image = ({ href, title, text }) => {
  const bytes = imageAssets.get(href);
  if (!bytes) throw new Error(`Missing screenshot referenced by Markdown: ${href}`);
  const extension = path.extname(href ?? '').toLowerCase();
  const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png';
  const data = `data:${mime};base64,${bytes.toString('base64')}`;
  const alt = escapeAttribute(text ?? '');
  const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
  return `<img src="${data}" alt="${alt}"${titleAttribute}>`;
};

function escapeAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

const body = await marked.parse(markdown, { gfm: true, renderer });
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Prompt Tax — Visual Case Gallery</title>
  <style>
    @page { size: A4; margin: 17mm 16mm 19mm; }
    * { box-sizing: border-box; }
    body {
      color: #17231c;
      font: 10.5pt/1.52 "Segoe UI", Arial, sans-serif;
      overflow-wrap: anywhere;
    }
    h1, h2, h3, h4 { color: #183b2a; line-height: 1.2; break-after: avoid; }
    h1 { font-size: 25pt; margin: 0 0 16pt; border-bottom: 2px solid #4cc38a; padding-bottom: 9pt; }
    h2 { font-size: 17pt; margin: 25pt 0 11pt; padding-bottom: 5pt; border-bottom: 1px solid #cddbd1; }
    h3 { font-size: 13pt; margin: 19pt 0 7pt; }
    h4 { font-size: 11pt; margin: 15pt 0 6pt; }
    p { margin: 6pt 0 9pt; orphans: 3; widows: 3; }
    blockquote { margin: 12pt 0; padding: 8pt 12pt; border-left: 3px solid #4cc38a; background: #f1f7f3; }
    blockquote p { margin: 0; }
    code, pre { font-family: Consolas, "Courier New", monospace; }
    code { font-size: 9pt; background: #eef3ef; padding: 1pt 3pt; border-radius: 2pt; }
    pre { white-space: pre-wrap; background: #f2f5f3; border: 1px solid #dce6df; padding: 8pt 10pt; font-size: 8.5pt; break-inside: avoid; }
    pre code { background: transparent; padding: 0; }
    img { display: block; width: auto; max-width: 100%; max-height: 225mm; object-fit: contain; margin: 10pt auto 13pt; break-inside: avoid; }
    p:has(> img) { break-inside: avoid; margin: 9pt 0 14pt; }
    table { width: 100%; border-collapse: collapse; margin: 10pt 0 16pt; font-size: 9pt; break-inside: auto; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td { border: 1px solid #cddbd1; padding: 5pt 6pt; text-align: left; vertical-align: top; }
    th { color: #183b2a; background: #eaf3ed; }
    hr { border: 0; border-top: 1px solid #cddbd1; margin: 17pt 0; }
    a { color: #176a45; text-decoration: none; }
    @media print {
      h2 { break-before: auto; }
      img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>${body}</body>
</html>`;

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.images, (image) =>
      image.decode().catch(() => undefined),
    ));
  });
  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;margin:0 16mm;color:#708078;font:8px Segoe UI,Arial,sans-serif;text-align:right"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    margin: { top: '17mm', right: '16mm', bottom: '19mm', left: '16mm' },
  });
} finally {
  await browser.close();
}

console.log(`Exported ${path.relative(root, outputPath)}`);
