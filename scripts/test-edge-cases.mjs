/**
 * Edge-case DOM verification: drives the real content script (dist/
 * loaded unpacked) against the Gemini fixture and proves, for all 25
 * matrix prompts, that (a) the classifier routes to the expected tier
 * and (b) the CLOSED-SHADOW pill honours the instant-regret contract
 * via the sanctioned data-ptx-* surface:
 *
 *   roast rows     -> data-ptx-roast="true", data-ptx-pill-chars >= 35
 *                     (full punchline visible on the COLLAPSED pill),
 *                     data-ptx-pill-theme="red" (rgba(239,68,68,...) border)
 *   trap rows      -> data-ptx-tier="INFORMATIVE", data-ptx-roast="false"
 *
 *   node scripts/build.mjs && node scripts/test-edge-cases.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const pathToExtension = path.join(repoRoot, 'dist');

const GEMINI_URL = 'https://gemini.google.com/app';
const fixtureHtml = readFileSync(path.join(here, 'fixtures', 'gemini-fixture.html'), 'utf8');

const SHORT_REPLY = 'Short answer supplied promptly by the cluster.';
const LONG_REPLY =
  'Certainly. Here is a detailed implementation walkthrough with typed overloads, ' +
  'usage notes, edge cases, and a small unit-test harness exercising the lifecycle.';

/** [ n, prompt, expectedTier, roast, reply ] */
const MATRIX = [
  [1, 'Thanks', 'POLITE', true, SHORT_REPLY],
  [2, 'Thank you so much!!', 'POLITE', true, SHORT_REPLY],
  [3, 'ok got it', 'POLITE', true, SHORT_REPLY],
  [4, '\u{1F44D}', 'POLITE', true, SHORT_REPLY],
  [5, 'Hi', 'GREETING', true, SHORT_REPLY],
  [6, 'Good morning!', 'GREETING', true, SHORT_REPLY],
  [7, '7777+998', 'SIMPLE_MATH', true, SHORT_REPLY],
  [8, 'tell me how much is 7777+998', 'SIMPLE_MATH', true, SHORT_REPLY],
  [9, 'what is 20% of 450?', 'SIMPLE_MATH', true, SHORT_REPLY],
  [10, '45 times 12', 'SIMPLE_MATH', true, SHORT_REPLY],
  [11, 'calculate (150 / 3) + 22', 'SIMPLE_MATH', true, SHORT_REPLY],
  [12, 'try again', 'LAZY_RETRY', true, SHORT_REPLY],
  [13, 'fix it', 'LAZY_RETRY', true, SHORT_REPLY],
  [14, '???', 'LAZY_RETRY', true, SHORT_REPLY],
  [15, 'capital of france', 'QUICK_SEARCH', true, SHORT_REPLY],
  [16, 'weather in bengaluru', 'QUICK_SEARCH', true, SHORT_REPLY],
  [17, 'tokyo time', 'QUICK_SEARCH', true, SHORT_REPLY],
  [18, 'define ephemeral', 'QUICK_SEARCH', true, SHORT_REPLY],
  [19, 'who is the ceo of nvidia?', 'QUICK_SEARCH', true, SHORT_REPLY],
  [20, 'Thanks, now refactor this function to use async/await', 'INFORMATIVE', false, LONG_REPLY],
  [21, 'Hi, can you explain how Kafka consumer groups work?', 'INFORMATIVE', false, LONG_REPLY],
  [22, 'What is the time complexity of quicksort?', 'INFORMATIVE', false, LONG_REPLY],
  [23, 'Prove that 2 + 2 = 4 using Peano axioms', 'INFORMATIVE', false, LONG_REPLY],
  [24, 'Fix this TypeScript regex: /^[0-9]+$/', 'INFORMATIVE', false, LONG_REPLY],
  [25, 'Why is 0.1 + 0.2 !== 0.3 in JavaScript?', 'INFORMATIVE', false, LONG_REPLY],
];

async function run() {
  const context = await chromium.launchPersistentContext(path.join(repoRoot, '.edge-profile'), {
    headless: true,
    channel: 'msedge',
    args: [`--disable-extensions-except=${pathToExtension}`, `--load-extension=${pathToExtension}`],
    viewport: { width: 1280, height: 860 },
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.href === GEMINI_URL || url.href.startsWith(`${GEMINI_URL}/`)) {
        route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixtureHtml });
        return;
      }
      route.abort();
    });

    await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__ptxFixture, undefined, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-prompt-tax="true"]').length === 2);

    const rows = [];
    let failures = 0;

    for (let i = 0; i < MATRIX.length; i += 1) {
      const [n, prompt, tier, roast, reply] = MATRIX[i];
      await page.evaluate((p) => window.__ptxFixture.submitUserTurn(p), prompt);
      await page.evaluate(
        ([text]) => window.__ptxFixture.completeTurn(text, {}),
        [reply],
      );

      const expectedBadges = i + 3;
      const badge = await page
        .waitForFunction(
          (count) => {
            const hosts = [...document.querySelectorAll('[data-prompt-tax="true"]')];
            if (hosts.length < count) return false;
            const el = hosts[hosts.length - 1];
            const theme = el.getAttribute('data-ptx-pill-theme');
            if (!theme) return false; // resolved on first frame after attach
            return {
              tier: el.getAttribute('data-ptx-tier'),
              roast: el.getAttribute('data-ptx-roast'),
              chars: Number(el.getAttribute('data-ptx-pill-chars') ?? '-1'),
              theme,
            };
          },
          expectedBadges,
          { timeout: 25000, polling: 400 },
        )
        .then((h) => h.jsonValue());

      const problems = [];
      if (badge.tier !== tier) problems.push(`tier=${badge.tier}`);
      if (badge.roast !== String(roast)) problems.push(`roast=${badge.roast}`);
      if (roast) {
        if (badge.chars < 35) problems.push(`pillChars=${badge.chars} (<35)`);
        if (badge.theme !== 'red') problems.push(`theme=${badge.theme} (expected red)`);
      }

      const pass = problems.length === 0;
      if (!pass) failures += 1;
      rows.push({
        '#': n,
        prompt: prompt.length > 34 ? `${prompt.slice(0, 31)}...` : prompt,
        expect: `${tier}/roast=${roast}`,
        got: `${badge.tier}/roast=${badge.roast} chars=${badge.chars} theme=${badge.theme}`,
        result: pass ? 'PASS' : `FAIL: ${problems.join('; ')}`,
      });
    }

    console.table(rows);
    console.log(
      `\n[edge-cases] ${MATRIX.length - failures}/${MATRIX.length} DOM assertions passed` +
        (failures ? ` (${failures} FAILED)` : ''),
    );
    if (failures > 0) process.exitCode = 1;
  } finally {
    await context.close();
  }
}

run().catch((err) => {
  console.error('[edge-cases] harness error:', err);
  process.exitCode = 1;
});
