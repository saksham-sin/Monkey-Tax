/**
 * Playwright E2E harness for the Prompt Tax extension on Gemini.
 *
 * Launches a persistent context (owned profile dir, so it is reusable and
 * never conflicts with a running Edge/Chrome) with ./dist loaded
 * unpacked. Two modes:
 *
 *   node scripts/test-gemini.js                     # live gemini.google.com
 *   node scripts/test-gemini.js --mode=fixture      # deterministic, no auth
 *
 * Because badges render inside CLOSED shadow roots (by spec), pages can
 * never read them via el.shadowRoot. Assertions use the sanctioned
 * surface: [data-prompt-tax] host elements with data-ptx-tier /
 * data-ptx-roast attributes, plus [PromptTax] console telemetry.
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const pathToExtension = path.join(repoRoot, 'dist');
const fixturePath = path.join(here, 'fixtures', 'gemini-fixture.html');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const MODE = arg('mode', 'live');
const BROWSER_CHANNEL = arg('channel', 'msedge');
const PROFILE_DIR = arg('profile', path.join(repoRoot, '.test-profile'));
const HEADLESS = argv.includes('--headless');
const LOGIN_TIMEOUT_MS = Number(arg('login-timeout-ms', 240000));

const TEST_CASES = [
  { prompt: 'Thanks', expectedTier: 'POLITE', shouldRoast: true },
  { prompt: '45 * 12', expectedTier: 'SIMPLE_MATH', shouldRoast: true },
  { prompt: 'capital of france', expectedTier: 'QUICK_SEARCH', shouldRoast: true },
  { prompt: 'Write a TypeScript debounce function', expectedTier: 'INFORMATIVE', shouldRoast: false },
];

// --- Badge inspection via the sanctioned data-attribute surface ---------

async function readBadges(page) {
  return page.evaluate(() => {
    const hosts = Array.from(document.querySelectorAll('[data-prompt-tax="true"]'));
    return hosts.map((el) => ({
      tier: el.getAttribute('data-ptx-tier'),
      roast: el.getAttribute('data-ptx-roast'),
    }));
  });
}

async function expectBadgeCount(page, count, timeoutMs) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-prompt-tax="true"]').length >= expected,
    count,
    { timeout: timeoutMs, polling: 500 },
  );
}

// --- Live-mode Gemini interaction ----------------------------------------

async function submitPromptLive(page, text) {
  const input = page
    .locator('rich-textarea .ql-editor, div[contenteditable="true"], textarea[aria-label*="prompt" i]')
    .first();
  await input.waitFor({ state: 'visible', timeout: 20000 });
  await input.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text, { delay: 12 });

  const sendButton = page.locator('button[aria-label^="Send"], .send-button').first();
  await page.keyboard.press('Enter');
  // Fallback: if Enter was intercepted, press the send control.
  await page.waitForTimeout(700);
  const stillFilled = await page
    .evaluate(() => {
      const el = document.querySelector('rich-textarea .ql-editor, div[contenteditable="true"]');
      return el ? (el.innerText ?? '').trim().length > 0 : false;
    })
    .catch(() => false);
  if (stillFilled && (await sendButton.isVisible().catch(() => false))) {
    await sendButton.click();
  }
}

async function startFreshChat(page) {
  await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
}

async function ensureLoggedIn(page) {
  if (!/accounts\.google\.com|serviceLogin|signin/i.test(page.url())) return;
  console.log(
    '\n\x1b[33m[test] Gemini requires sign-in. Log in in the opened browser window —\n' +
      '       the script waits automatically and the profile is remembered.\x1b[0m\n',
  );
  await page.waitForURL(/gemini\.google\.com\/(app|u\/\d+\/app)/, { timeout: LOGIN_TIMEOUT_MS });
  await page.waitForTimeout(2000);
}

// --- Fixture-mode Gemini simulation ---------------------------------------

async function startFreshChatFixture(page) {
  await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!window.__ptxFixture,
    undefined,
    { timeout: 15000 },
  );
}

async function submitPromptFixture(page, text) {
  // Response prose length varies by tier so copy variants stay exercised.
  const reply =
    text.length > 25
      ? 'Certainly. Here is a debounce implementation with generics, trailing timeout, and a cancel method, followed by usage notes and tests. '
      : 'Short answer supplied promptly by the cluster.';
  await page.evaluate((p) => window.__ptxFixture.submitUserTurn(p), text);
  await page.evaluate((r) => window.__ptxFixture.completeTurn(r), reply);
}

// --- Main ----------------------------------------------------------------

async function runGeminiTests() {
  console.log('[test] Mode:', MODE, '| extension from:', pathToExtension, '| channel:', BROWSER_CHANNEL);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: HEADLESS && MODE === 'fixture', // extensions require a headed live run
    channel: BROWSER_CHANNEL,
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
      '--start-maximized',
    ],
    viewport: null,
  });

  const page = context.pages()[0] ?? (await context.newPage());

  // Forward extension telemetry to the terminal.
  page.on('console', (msg) => {
    if (msg.text().includes('[PromptTax]')) {
      console.log(`\x1b[36mBrowser Log: ${msg.text()}\x1b[0m`);
    }
  });

  const submitPrompt = MODE === 'fixture' ? submitPromptFixture : submitPromptLive;
  const freshChat = MODE === 'fixture' ? startFreshChatFixture : startFreshChat;

  if (MODE === 'fixture') {
    const fixtureHtml = await import('node:fs/promises').then((fs) =>
      fs.readFile(fixturePath, 'utf8'),
    );
    await page.route('**/*', (route) => {
      const { hostname } = new URL(route.request().url());
      if (hostname === 'gemini.google.com') {
        route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixtureHtml });
        return;
      }
      route.abort();
    });
  } else {
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await ensureLoggedIn(page);
  }

  const results = [];

  for (const tc of TEST_CASES) {
    console.log(`\n--- Testing prompt: "${tc.prompt}" (expected: ${tc.expectedTier}) ---`);

    await freshChat(page); // fresh conversation per case => exactly one badge per page
    await submitPrompt(page, tc.prompt);

    console.log('[test] Prompt submitted. Waiting for response to settle + badge injection...');
    const badgeTimeout = MODE === 'fixture' ? 20000 : Number(arg('badge-timeout-ms', 90000));
    let badgeOk = true;
    try {
      await expectBadgeCount(page, 1, badgeTimeout);
    } catch {
      badgeOk = false;
    }

    const badges = await readBadges(page);
    const badge = badges.length > 0 ? badges[badges.length - 1] : null;

    let status;
    let reason = '';
    if (!badgeOk || !badge) {
      status = 'FAIL';
      reason = `No badge injected (found ${badges.length}). ` +
        (MODE === 'live'
          ? 'Likely: Gemini DOM selector drift, response still streaming, or login wall.'
          : 'Adapter/observer regression — check [PromptTax] logs above.');
    } else if (badge.tier !== tc.expectedTier) {
      status = 'FAIL';
      reason = `Expected tier ${tc.expectedTier}, extraction produced ${badge.tier}. ` +
        'The raw [PromptTax] prompt line above shows what the adapter actually extracted.';
    } else if (badge.roast !== String(tc.shouldRoast)) {
      status = 'FAIL';
      reason = `Tier ${badge.tier} correct but roast flag ${badge.roast} !== expected ${tc.shouldRoast}.`;
    } else {
      status = 'PASS';
      reason = `tier=${badge.tier} roast=${badge.roast}`;
    }

    const color = status === 'PASS' ? '32' : '31';
    console.log(`\x1b[${color}m[${status}] "${tc.prompt}" -> ${reason}\x1b[0m`);
    results.push({ prompt: tc.prompt, status, reason });

    if (status === 'FAIL' && MODE === 'live') {
      await page.screenshot({ path: path.join(repoRoot, `.debug-fail-${results.length + 1}.png`), fullPage: true })
        .catch(() => {});
      console.log('[test] Screenshot saved for diagnosis.');
    }

    await page.waitForTimeout(500);
  }

  await context.close();

  const failed = results.filter((r) => r.status !== 'PASS');
  console.log('\n===== TEST SUITE SUMMARY =====');
  for (const r of results) {
    console.log(`  ${r.status === 'PASS' ? '[PASS]' : '[FAIL]'} "${r.prompt}" — ${r.reason}`);
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length}/${results.length} assertions FAILED`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} assertions passed (${MODE} mode).`);
}

runGeminiTests().catch((err) => {
  console.error('[test Error]:', err);
  process.exit(1);
});
