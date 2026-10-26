/**
 * Captures screenshots for every observable Prompt Tax state across all
 * three supported platforms, using deterministic fixtures (extension
 * loaded unpacked from ./dist; content scripts injected by the real
 * manifest matches at each platform's origin).
 *
 *   node scripts/capture-screenshots.mjs
 *
 * Outputs PNGs to docs/screenshots/ and a machine-readable manifest to
 * docs/screenshots/cases.json.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const pathToExtension = path.join(repoRoot, 'dist');
const fixturesDir = path.join(here, 'fixtures');
const shotsDir = path.join(repoRoot, 'docs', 'screenshots');

const LONG_REPLY =
  'Certainly. Here is a generic debounce implementation with a trailing timeout, ' +
  'a cancel method, and typed overloads, followed by usage notes, edge cases, ' +
  'and a small unit-test harness exercising the timer lifecycle.';
const SHORT_REPLY = 'Short answer supplied promptly by the cluster.';

const PLATFORMS = [
  { key: 'gemini', url: 'https://gemini.google.com/app', fixture: 'gemini-fixture.html', chatPath: true },
  { key: 'chatgpt', url: 'https://chatgpt.com/c/e2e-thread', fixture: 'chatgpt-fixture.html', chatPath: true },
  { key: 'claude', url: 'https://claude.ai/chat/e2e-thread', fixture: 'claude-fixture.html', chatPath: true },
];

const norm = (value) => value.replace(/\s+/g, ' ').trim().toLowerCase();

async function run() {
  mkdirSync(shotsDir, { recursive: true });
  rmSync(path.join(repoRoot, '.capture-profile'), { recursive: true, force: true });

  const fixtures = new Map(
    PLATFORMS.map((p) => [
      p.url,
      readFileSync(path.join(fixturesDir, p.fixture), 'utf8'),
    ]),
  );

  const context = await chromium.launchPersistentContext(path.join(repoRoot, '.capture-profile'), {
    headless: true,
    channel: 'msedge',
    args: [`--disable-extensions-except=${pathToExtension}`, `--load-extension=${pathToExtension}`],
    viewport: { width: 1280, height: 860 },
  });

  const page = context.pages()[0] ?? (await context.newPage());
  const telemetry = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[MonkeyTax]') || text.includes('[PromptTax]')) telemetry.push(text);
  });

  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const hit = [...fixtures.entries()].find(
      ([target]) => url.href === target || url.href.startsWith(`${target}/`),
    );
    if (hit) {
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: hit[1] });
      return;
    }
    route.abort();
  });

  const cases = [];
  let swReady = context.serviceWorkers()[0] ?? null;
  let expectedBadgeCount = 1;
  const storedPromptCount = async () => {
    swReady ??= context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    return swReady.evaluate(async () => {
      const stored = await chrome.storage.local.get('days');
      return Object.values(stored.days ?? {}).reduce((total, day) => total + day.totalPrompts, 0);
    });
  };

  const gotoFixture = async (url) => {
    expectedBadgeCount = 1;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__ptxFixture, undefined, { timeout: 15000 });
  };

  const expectBadge = async (tier, roast, minBadges = 1, timeout = 25000) => {
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-prompt-tax="true"]').length >= n,
      Math.max(minBadges, expectedBadgeCount),
      { timeout, polling: 400 },
    );
    const badge = await page.evaluate(() => {
      const hosts = [...document.querySelectorAll('[data-prompt-tax="true"]')];
      const el = hosts[hosts.length - 1];
      return { tier: el.getAttribute('data-ptx-tier'), roast: el.getAttribute('data-ptx-roast') };
    });
    if (norm(badge.tier) !== norm(tier) || badge.roast !== String(roast)) {
      throw new Error(`expected ${tier}/roast=${roast}, got ${badge.tier}/roast=${badge.roast}`);
    }
    return badge;
  };

  const submit = async (prompt, reply, opts = {}) => {
    await page.evaluate((p) => window.__ptxFixture.submitUserTurn(p), prompt);
    await page.evaluate(
      ([text, options]) => window.__ptxFixture.completeTurn(text, options),
      [reply, opts],
    );
    expectedBadgeCount = await page.locator('model-response, [data-chatgpt-search-unit-key$=":assistant"], [data-testid="assistant-message"]').count();
  };

  const shot = async (name, opts = {}) => {
    const file = `${name}.png`;
    const target = path.join(shotsDir, file);
    if (opts.element) {
      await opts.element.screenshot({ path: target });
    } else {
      await page.screenshot({ path: target, ...opts });
    }
    console.log(`[capture] ${name} -> screenshots/${file}`);
    return `screenshots/${file}`;
  };

  const expectDock = async () => {
    await page.waitForFunction(
      () => document.querySelectorAll('[data-prompt-tax="thread"]').length >= 1,
      undefined,
      { timeout: 20000, polling: 400 },
    );
    return page.evaluate(() => {
      const el = document.querySelector('[data-prompt-tax="thread"]');
      const styles = getComputedStyle(el);
      const accent = styles.getPropertyValue('--ptx-chip-text').trim().toUpperCase();
      const expected = el.dataset.ptxTheme === 'light' ? '#963D25' : '#F4A28C';
      if (accent !== expected) throw new Error(`Unexpected dock palette: ${accent}, expected ${expected}`);
      return {
        turns: el.getAttribute('data-ptx-turns'),
        waterMl: el.getAttribute('data-ptx-water-ml'),
        energyWh: el.getAttribute('data-ptx-energy-wh'),
      };
    });
  };

  const openDrawer = async () => {
    // Real click on the centered pill (retargeted across the closed
    // shadow boundary), matching what a user does. A synthetic host
    // dispatch would bypass the pill's stopPropagation and hide bugs.
    const badge = page.locator('[data-prompt-tax="true"]').last();
    await badge.click();
    await page.waitForFunction(
      () => {
        const hosts = [...document.querySelectorAll('[data-prompt-tax="true"]')];
        return hosts[hosts.length - 1]?.getAttribute('data-ptx-open') === 'true';
      },
      undefined,
      { timeout: 5000 },
    );
    await page.waitForTimeout(450); // let the CSS accordion transition settle
  };

  await gotoFixture('https://gemini.google.com/app');
  await expectDock();
  const geminiPromptCount = await storedPromptCount();
  await page.evaluate(() => {
    const panel = document.createElement('main');
    panel.id = 'gemini-paged-history';
    panel.style.cssText = 'height:280px;overflow-y:auto;overflow-anchor:none';
    const app = document.getElementById('app');
    app.querySelectorAll('.conversation-container').forEach((turn) => { turn.style.cssText = 'display:block;min-height:220px'; });
    panel.append(app);
    document.body.append(panel);
    const offscreenLoader = document.createElement('mat-spinner');
    offscreenLoader.id = 'gemini-offscreen-loader';
    offscreenLoader.style.cssText = 'position:fixed;top:110vh;left:0;width:20px;height:20px';
    document.body.append(offscreenLoader);
    let pages = 0;
    let pending = false;
    panel.addEventListener('scroll', () => {
      if (panel.scrollTop > 1 || pending || pages >= 3) return;
      pending = true;
      const spinner = document.createElement('mat-progress-spinner');
      spinner.className = 'history-loading';
      panel.prepend(spinner);
      setTimeout(() => {
        pages += 1;
        const turn = app.querySelector('.conversation-container').cloneNode(true);
        turn.querySelectorAll('[data-prompt-tax]').forEach((el) => el.remove());
        turn.querySelector('user-query').textContent = `Explain earlier Gemini history page ${pages}`;
        turn.querySelector('message-content').textContent = `Older completed answer from page ${pages}`;
        app.querySelector('route-thread').prepend(turn);
        spinner.remove();
        panel.dataset.pages = String(pages);
        pending = false;
      }, 650);
    });
    panel.scrollTop = panel.scrollHeight;
  });
  const geminiDock = page.locator('[data-prompt-tax="thread"]');
  const geminiDockBox = await geminiDock.boundingBox();
  await page.mouse.click(geminiDockBox.x + geminiDockBox.width / 2, geminiDockBox.y + 14);
  await page.waitForFunction(() => {
    const host = document.querySelector('[data-prompt-tax="thread"]');
    return host?.dataset.ptxOpen === 'true' && !!host.dataset.ptxScanBtnRect;
  });
  const [geminiScanX, geminiScanY] = (await geminiDock.getAttribute('data-ptx-scan-btn-rect')).split(',').map(Number);
  const geminiOpenBox = await geminiDock.boundingBox();
  await page.mouse.click(geminiOpenBox.x + geminiScanX, geminiOpenBox.y + geminiScanY);
  await page.waitForFunction(
    () => document.querySelector('[data-prompt-tax="thread"]')?.dataset.ptxScanState === 'complete',
    undefined,
    { timeout: 25000 },
  );
  const geminiHistory = await page.evaluate(() => ({
    pages: document.getElementById('gemini-paged-history').dataset.pages,
    top: document.getElementById('gemini-paged-history').scrollTop,
    turns: document.querySelector('[data-prompt-tax="thread"]').dataset.ptxTurns,
  }));
  const offscreenLoaderStillPresent = await page.locator('#gemini-offscreen-loader').count();
  if (geminiHistory.pages !== '3' || geminiHistory.turns !== '5' || Math.abs(geminiHistory.top) > 1 || offscreenLoaderStillPresent !== 1) {
    throw new Error(`Gemini top-edge pagination stopped early: ${JSON.stringify(geminiHistory)}`);
  }
  if (await storedPromptCount() !== geminiPromptCount) {
    throw new Error('Gemini history scan incorrectly created new daily prompt receipts');
  }
  console.log('[scan-regression] Gemini: one click loads 3 top-edge pages, ignores offscreen spinner, and finishes at the top');

  // --- Per-platform standard states -----------------------------------------
  for (const platform of PLATFORMS) {
    const p = platform.key;
    console.log(`\n[capture] ===== ${p} =====`);

    // 1) Pre-seeded history only -> thread dock on an existing chat URL.
    await gotoFixture(platform.url);
    const dockHistory = await expectDock();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-prompt-tax="true"]').length === 2,
      undefined,
      { timeout: 10000 },
    );
    const dockImage = await shot(`${p}-thread-dock`, {
      clip: { x: 320, y: 0, width: 640, height: 56 },
    });
    cases.push({
      name: `${p}-thread-dock`,
      caption: `Thread dock pill on a pre-existing ${p} conversation (${dockHistory.turns} seeded turns): ${dockHistory.waterMl} ml / ${dockHistory.energyWh} Wh.`,
      image: dockImage,
    });

    // 1b) Dock drawer dashboard + deep-history scanner (Gemini detail).
    if (p === 'gemini') {
      // Use a REAL mouse click (not a host-dispatched event) so the click
      // crosses the closed shadow boundary and retargets, exercising the
      // exact path a user hits. This catches double-toggle regressions that
      // a synthetic host.dispatchEvent would mask.
      const box = await page.locator('[data-prompt-tax="thread"]').boundingBox();
      const dot = box ?? { x: 640, y: 14, width: 0, height: 28 };
      await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2);
      await page.waitForFunction(
        () => document.querySelector('[data-prompt-tax="thread"]')?.getAttribute('data-ptx-open') === 'true',
        undefined,
        { timeout: 5000 },
      );
      // REAL browser click on the "Scan Entire History" button itself:
      // it is unreachable to selectors inside the closed shadow root, so
      // the component publishes its center (offset from the host) via
      // data-ptx-scanbtn-rect once the drawer transition settles.
      const scanPt = await page.waitForFunction(
        () => document.querySelector('[data-prompt-tax="thread"]')?.getAttribute('data-ptx-scan-btn-rect') ?? false,
        undefined,
        { timeout: 8000, polling: 200 },
      );
      const [ox, oy] = (await scanPt.jsonValue()).split(',').map(Number);
      const hostBox = await page.locator('[data-prompt-tax="thread"]').boundingBox();
      const hb = hostBox ?? { x: 0, y: 0 };
      await page.mouse.click(hb.x + ox, hb.y + oy);
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-prompt-tax="thread"]');
          return !!el && el.hasAttribute('data-ptx-scanned') &&
            el.getAttribute('data-ptx-scanned') === el.getAttribute('data-ptx-turns');
        },
        undefined,
        { timeout: 20000 },
      );
      await page.waitForTimeout(500);
      const scanned = await page.evaluate(
        () => document.querySelector('[data-prompt-tax="thread"]').getAttribute('data-ptx-scanned'),
      );
      cases.push({
        name: 'thread-drawer-dashboard',
        caption: `Expanded thread dock: 4-card dashboard (water bottle fill, lamp hours, search equivalence, Xbox Series S runtime) and the "Scan Entire History" auto-scroll scanner after a full sweep (${scanned} turns).`,
        image: await shot('thread-drawer-dashboard', {
          clip: { x: 290, y: 0, width: 700, height: 300 },
        }),
      });

      // Fold the dock away (synthetic host click = same toggle path) so
      // later badge clicks in this iteration land on pills, not the dock.
      await page.evaluate(() => document.querySelector('[data-prompt-tax="thread"]')?.click());
      await page.waitForFunction(
        () => document.querySelector('[data-prompt-tax="thread"]')?.getAttribute('data-ptx-open') === 'false',
        undefined,
        { timeout: 5000 },
      );
    }

    // 2) INFORMATIVE turn -> centered collapsed pill.
    await submit('Write a TypeScript debounce function', LONG_REPLY);
    await expectBadge('INFORMATIVE', false);
    const badgeImage = await shot(`${p}-badge-informative`, {
      element: page.locator('[data-prompt-tax="true"]').last(),
    });
    cases.push({
      name: `${p}-badge-informative`,
      caption: `${p}: centered, collapsed INFORMATIVE pill (headline + human-relatable metric chip + chevron).`,
      image: badgeImage,
    });

    // 3) Click -> expandedaccordion with scope split + Reddit hardware check.
    await openDrawer();
    const drawerImage = await shot(`${p}-drawer-expanded`, p === 'claude' ? {
      clip: await page.locator('[data-prompt-tax="true"]').last().evaluate((host) => {
        const [x, y, width, height] = host.dataset.ptxDrawerRect.split(',').map(Number);
        return { x, y, width, height };
      }),
    } : { element: page.locator('[data-prompt-tax="true"]').last() });
    cases.push({
      name: `${p}-drawer-expanded`,
      caption: `${p}: accordion drawer expanded — Scope 1/Scope 2 cooling breakdown (incl. grid water), hardware reality check, citation link.`,
      image: drawerImage,
    });

    // Dock folded the live turn in: seeded + 1.
    const dockLive = await page.evaluate(() => {
      const el = document.querySelector('[data-prompt-tax="thread"]');
      return el ? el.getAttribute('data-ptx-turns') : null;
    });
    if (dockLive !== String(Number(dockHistory.turns) + 1)) {
      throw new Error(`${p}: thread dock live-count ${dockLive} !== seeded+1 (${dockHistory.turns}+1)`);
    }
  }

  for (const viewport of [
    { name: 'desktop', width: 1280, height: 860 },
    { name: 'compact', width: 1000, height: 640 },
    { name: 'mobile', width: 390, height: 700 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoFixture('https://claude.ai/chat/e2e-thread');
    await page.waitForFunction(() => document.querySelectorAll('[data-prompt-tax="true"]').length === 2);
    await page.evaluate(() => {
      const panel = document.createElement('main');
      panel.id = 'claude-scroll-panel';
      panel.style.cssText = 'position:absolute;inset:0;overflow-y:auto;padding:64px 16px 160px;box-sizing:border-box';
      const app = document.getElementById('app');
      app.style.cssText = 'min-height:1200px;display:flex;flex-direction:column;justify-content:flex-end';
      panel.append(app);
      const composer = document.createElement('form');
      composer.id = 'claude-fixed-composer';
      composer.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:110px;box-sizing:border-box;padding:16px;background:#30302e;z-index:100';
      const input = document.createElement('div');
      input.contentEditable = 'true';
      input.setAttribute('role', 'textbox');
      input.textContent = 'Unsent draft';
      composer.append(input);
      document.body.append(panel, composer);
      panel.scrollTop = panel.scrollHeight;
    });
    const badge = page.locator('[data-prompt-tax="true"]').last();
    const before = await page.evaluate(() => {
      const panel = document.getElementById('claude-scroll-panel');
      const badge = [...document.querySelectorAll('[data-prompt-tax="true"]')].at(-1);
      return { top: panel.scrollTop, height: panel.scrollHeight, badgeHeight: badge.getBoundingClientRect().height };
    });
    await badge.click();
    await page.waitForFunction(() => !![...document.querySelectorAll('[data-prompt-tax="true"]')].at(-1)?.dataset.ptxDrawerRect);
    await page.waitForTimeout(600);
    const geometry = await page.evaluate(() => {
      const panel = document.getElementById('claude-scroll-panel');
      const host = [...document.querySelectorAll('[data-prompt-tax="true"]')].at(-1);
      const [x, y, width, height] = host.dataset.ptxDrawerRect.split(',').map(Number);
      return {
        top: panel.scrollTop, height: panel.scrollHeight, badgeHeight: host.getBoundingClientRect().height,
        x, y, right: x + width, bottom: y + height,
        composerTop: document.getElementById('claude-fixed-composer').getBoundingClientRect().top,
        badgeBottom: host.getBoundingClientRect().bottom,
      };
    });
    if (Math.abs(geometry.top - before.top) > 1 || geometry.height !== before.height ||
        Math.abs(geometry.badgeHeight - before.badgeHeight) > 1 || geometry.y < 56 ||
        geometry.bottom > geometry.composerTop - 8 || geometry.x < 12 || geometry.right > viewport.width - 12 ||
        geometry.badgeBottom > geometry.composerTop - 8) {
      throw new Error(`Claude ${viewport.name}: composer/drawer scroll regression: ${JSON.stringify({ before, geometry })}`);
    }
    cases.push({
      name: `claude-composer-${viewport.name}`,
      caption: `Claude ${viewport.name}: drawer opens above the fixed composer without changing message height or scroll position.`,
      image: await shot(`claude-composer-${viewport.name}`),
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-prompt-tax="true"]')].at(-1)?.dataset.ptxOpen === 'false');
    await badge.click();
    await page.evaluate(() => { document.getElementById('claude-scroll-panel').scrollTop -= 80; });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-prompt-tax="true"]')].at(-1)?.dataset.ptxOpen === 'false');
    if (await page.locator('[contenteditable="true"]').innerText() !== 'Unsent draft') {
      throw new Error(`Claude ${viewport.name}: drawer interaction changed the composer draft`);
    }
    const overlapPoint = await page.evaluate(() => {
      const panel = document.getElementById('claude-scroll-panel');
      const host = [...document.querySelectorAll('[data-prompt-tax="true"]')].at(-1);
      const input = document.querySelector('[contenteditable="true"]');
      const inputRect = input.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const targetY = inputRect.top + inputRect.height / 2;
      panel.scrollTop += hostRect.top + hostRect.height / 2 - targetY;
      return { x: inputRect.left + inputRect.width / 2, y: targetY };
    });
    await page.waitForTimeout(100);
    const composerReceivesPointer = await page.evaluate(({ x, y }) =>
      !!document.elementFromPoint(x, y)?.closest('#claude-fixed-composer'), overlapPoint);
    if (!composerReceivesPointer) {
      throw new Error(`Claude ${viewport.name}: collapsed pill paints over the fixed composer and intercepts input`);
    }
    await page.mouse.click(overlapPoint.x, overlapPoint.y);
    if (!await page.locator('[contenteditable="true"]').evaluate((input) => input === document.activeElement)) {
      throw new Error(`Claude ${viewport.name}: composer cannot be focused while a pill scrolls underneath`);
    }
    console.log(`[composer-regression] Claude ${viewport.name}: no scroll jump, no composer overlap, Escape/scroll dismiss, draft preserved`);
  }
  await page.setViewportSize({ width: 1280, height: 860 });

  for (const platform of PLATFORMS.filter((item) => item.key !== 'gemini')) {
    await gotoFixture(platform.url);
    await expectDock();
    const promptCountBeforeScan = await storedPromptCount();
    await page.evaluate((platformKey) => {
      const panel = document.createElement('div');
      panel.id = 'delayed-history-panel';
      panel.style.cssText = 'height:280px;overflow-y:auto;scroll-behavior:smooth!important';
      const app = document.getElementById('app');
      panel.append(app);
      document.body.append(panel);
      const userSelector = platformKey === 'chatgpt'
        ? '[data-chatgpt-search-unit-key$=":user"]' : '[data-testid="user-message"]';
      const responseSelector = platformKey === 'chatgpt'
        ? '[data-chatgpt-search-unit-key$=":assistant"]' : '[data-testid="assistant-message"]';
      app.querySelectorAll(responseSelector).forEach((el) => { el.style.minHeight = '200px'; });
      const sidebar = document.createElement('aside');
      sidebar.id = 'unrelated-sidebar';
      sidebar.style.cssText = 'height:40px;overflow-y:auto';
      const spacer = document.createElement('div');
      spacer.style.height = '500px';
      sidebar.append(spacer);
      document.body.append(sidebar);
      sidebar.scrollTop = 100;
      let batches = 0;
      let pending = false;
      panel.addEventListener('scroll', () => {
        if (panel.scrollTop > 1 || pending || batches >= 3) return;
        pending = true;
        setTimeout(() => {
          batches += 1;
          const user = app.querySelector(userSelector).cloneNode(true);
          const response = app.querySelector(responseSelector).cloneNode(true);
          response.querySelectorAll('[data-prompt-tax]').forEach((el) => el.remove());
          user.textContent = `Explain delayed history batch ${batches}`;
          response.textContent = `Older response from delayed history batch ${batches}`;
          if (platformKey === 'chatgpt') {
            user.setAttribute('data-chatgpt-search-unit-key', `older-${batches}:0:user`);
            response.setAttribute('data-chatgpt-search-unit-key', `older-${batches}:1:assistant`);
          }
          app.prepend(user, response);
          panel.scrollTop = 120;
          panel.dataset.batches = String(batches);
          pending = false;
        }, 650);
      });
      panel.style.setProperty('scroll-behavior', 'auto');
      panel.scrollTop = panel.scrollHeight;
      panel.style.setProperty('scroll-behavior', 'smooth', 'important');
    }, platform.key);
    const dock = page.locator('[data-prompt-tax="thread"]');
    const dockBox = await dock.boundingBox();
    await page.mouse.click(dockBox.x + dockBox.width / 2, dockBox.y + 14);
    await page.waitForFunction(() => document.querySelector('[data-prompt-tax="thread"]')?.dataset.ptxOpen === 'true');
    await page.waitForTimeout(450);
    await page.waitForFunction(() => !!document.querySelector('[data-prompt-tax="thread"]')?.dataset.ptxScanBtnRect);
    const [offsetX, offsetY] = (await dock.getAttribute('data-ptx-scan-btn-rect')).split(',').map(Number);
    const openBox = await dock.boundingBox();
    await page.mouse.click(openBox.x + offsetX, openBox.y + offsetY);
    await page.waitForFunction(
      () => document.querySelector('[data-prompt-tax="thread"]')?.dataset.ptxScanState === 'complete',
      undefined,
      { timeout: 20000 },
    );
    const result = await page.evaluate(() => {
      const panel = document.getElementById('delayed-history-panel');
      return {
        batches: panel.dataset.batches,
        top: panel.scrollTop,
        turns: document.querySelector('[data-prompt-tax="thread"]').dataset.ptxTurns,
        sidebarTop: document.getElementById('unrelated-sidebar').scrollTop,
        behavior: panel.style.getPropertyValue('scroll-behavior'),
        priority: panel.style.getPropertyPriority('scroll-behavior'),
      };
    });
    if (result.batches !== '3' || result.turns !== '5' || Math.abs(result.top) > 1 ||
        result.sidebarTop !== 100 || result.behavior !== 'smooth' || result.priority !== 'important') {
      throw new Error(`${platform.key}: delayed-history scan failed: ${JSON.stringify(result)}`);
    }
    if (await storedPromptCount() !== promptCountBeforeScan) {
      throw new Error(`${platform.key}: scanning delayed history incorrectly recorded new daily prompts`);
    }
    console.log(`[scan-regression] ${platform.key}: one click loaded 3 delayed batches, 5 turns, stayed at top; sidebar and styles preserved`);

    await gotoFixture(platform.url);
    const promptCountBeforeVirtualScan = await storedPromptCount();
    await page.evaluate((platformKey) => {
      const app = document.getElementById('app');
      const panel = document.createElement('div');
      panel.id = 'virtual-history-panel';
      panel.style.cssText = 'height:280px;overflow-y:auto;overflow-anchor:none';
      const spacer = document.createElement('div');
      spacer.style.cssText = 'position:relative;height:2800px';
      app.style.cssText = 'position:absolute;left:0;right:0';
      spacer.append(app);
      panel.append(spacer);
      document.body.append(panel);
      const render = () => {
        const start = Math.max(0, Math.floor(panel.scrollTop / 200) - 1);
        app.style.top = `${start * 200}px`;
        const rows = [];
        for (let index = start; index < Math.min(14, start + 5); index += 1) {
          const row = document.createElement('div');
          row.style.cssText = 'height:200px;overflow:hidden';
          const assistant = index % 2 === 1;
          if (platformKey === 'chatgpt') {
            row.setAttribute('data-chatgpt-search-unit-key', `virtual-${Math.floor(index / 2)}:${assistant ? '1:assistant' : '0:user'}`);
          } else {
            row.setAttribute('data-testid', assistant ? 'assistant-message' : 'user-message');
            if (assistant) {
              row.setAttribute('data-is-streaming', 'false');
              row.setAttribute('data-turn-key', `virtual-${Math.floor(index / 2)}`);
            }
          }
          row.textContent = assistant ? `Completed response ${index}` : `Explain virtual history pair ${index}`;
          rows.push(row);
        }
        app.replaceChildren(...rows);
      };
      panel.scrollTop = panel.scrollHeight;
      render();
      panel.addEventListener('scroll', render);
    }, platform.key);
    await expectDock();
    const virtualDock = page.locator('[data-prompt-tax="thread"]');
    const virtualBox = await virtualDock.boundingBox();
    await page.mouse.click(virtualBox.x + virtualBox.width / 2, virtualBox.y + 14);
    await page.waitForFunction(() => {
      const host = document.querySelector('[data-prompt-tax="thread"]');
      return host?.dataset.ptxOpen === 'true' && !!host.dataset.ptxScanBtnRect;
    });
    const [virtualX, virtualY] = (await virtualDock.getAttribute('data-ptx-scan-btn-rect')).split(',').map(Number);
    const virtualOpenBox = await virtualDock.boundingBox();
    await page.mouse.click(virtualOpenBox.x + virtualX, virtualOpenBox.y + virtualY);
    await page.waitForFunction(
      () => document.querySelector('[data-prompt-tax="thread"]')?.dataset.ptxScanState === 'complete',
      undefined,
      { timeout: 20000 },
    );
    const virtualResult = await page.evaluate(() => ({
      turns: document.querySelector('[data-prompt-tax="thread"]').dataset.ptxTurns,
      top: document.getElementById('virtual-history-panel').scrollTop,
    }));
    if (virtualResult.turns !== '7' || Math.abs(virtualResult.top) > 1) {
      throw new Error(`${platform.key}: virtualized-history scan failed: ${JSON.stringify(virtualResult)}`);
    }
    if (await storedPromptCount() !== promptCountBeforeVirtualScan) {
      throw new Error(`${platform.key}: virtualized history incorrectly recorded new daily prompts`);
    }
    console.log(`[scan-regression] ${platform.key}: retained all 7 turns while 14 virtualized rows were recycled`);
  }

  // --- Gemini detail cases ---------------------------------------------------
  const GEMINI_DETAIL = [
    { name: 'badge-polite', prompt: 'Thanks', reply: SHORT_REPLY, tier: 'POLITE', roast: true, reasoning: false,
      caption: `Roast tier: politeness filler (${SHORT_REPLY} reply keeps it short).` },
    { name: 'badge-greeting', prompt: 'Good morning!', reply: SHORT_REPLY, tier: 'GREETING', roast: true, reasoning: false,
      caption: 'Roast tier: zero-question greeting opener; full punchline visible on the collapsed red pill.' },
    { name: 'badge-lazy-retry', prompt: 'fix it', reply: SHORT_REPLY, tier: 'LAZY_RETRY', roast: true, reasoning: false,
      caption: 'Roast tier: zero-context vague command ("fix it") caught only after the technical guardrails pass.' },
    { name: 'badge-simple-math', prompt: 'tell me how much is 7777+998', reply: SHORT_REPLY, tier: 'SIMPLE_MATH', roast: true, reasoning: false,
      caption: 'Roast tier: natural-language math ("tell me how much is 7777+998") classified SIMPLE_MATH; full punchline visible on the collapsed pill.' },
    { name: 'badge-quick-search', prompt: 'capital of france', reply: SHORT_REPLY, tier: 'QUICK_SEARCH', roast: true, reasoning: false,
      caption: 'Roast tier: ultra-short factual lookup.' },
    { name: 'badge-informative-reasoning', prompt: 'Prove that the sum of two even numbers is even', reply: LONG_REPLY, tier: 'INFORMATIVE', roast: false, reasoning: true,
      caption: 'Neutral telemetry with the 2.5x extended-thinking multiplier. Water split shown only in the drawer.' },
  ];
  for (const tc of GEMINI_DETAIL) {
    await gotoFixture('https://gemini.google.com/app');
    await submit(tc.prompt, tc.reply, { reasoning: tc.reasoning });
    await expectBadge(tc.tier, tc.roast);
    const image = await shot(tc.name, { element: page.locator('[data-prompt-tax="true"]').last() });
    cases.push({ name: tc.name, caption: tc.caption, image });
    if (tc.name === 'badge-polite') {
      // Prove the FULL punchline is readable after clicking, even when a
      // narrow viewport ellipsized it on the collapsed pill.
      await openDrawer();
      const drawerImg = await shot('badge-polite-drawer-fulltext', {
        element: page.locator('[data-prompt-tax="true"]').last(),
      });
      cases.push({
        name: 'badge-polite-drawer-fulltext',
        caption: 'Roast drawer after click: the complete headline + subtext punchline, fully wrapped and readable (the collapsed pill may ellipsize on narrow screens).',
        image: drawerImg,
      });
    }
  }

    // --- Adaptive theme proof (live in-app style theme switch) ---------------
  // Flips the fixture's <html class> exactly like ChatGPT/Claude's in-app
  // toggle and waits until EVERY mounted surface (badge + dock hosts)
  // carries data-ptx-theme=mode, proving the MutationObserver wiring.
  const setTheme = async (mode) => {
    await page.evaluate((m) => window.__ptxFixture.setTheme(m), mode);
    await page.waitForFunction(
      (m) => {
        const hosts = [...document.querySelectorAll('[data-prompt-tax]')];
        return hosts.length > 0 && hosts.every((host) => {
          const expected = m === 'light' ? '#963D25' : '#F4A28C';
          return host.dataset.ptxTheme === m &&
            getComputedStyle(host).getPropertyValue('--ptx-chip-text').trim().toUpperCase() === expected;
        });
      },
      mode,
      { timeout: 5000, polling: 200 },
    );
  };

  // Light-mode thread dock.
  await gotoFixture('https://gemini.google.com/app');
  await setTheme('light');
  await expectDock();
  cases.push({
    name: 'thread-dock-light',
    caption: 'Thread dock in LIGHT mode: warm peach glass, terracotta accents, and espresso text applied on a live theme change.',
    image: await shot('thread-dock-light', { clip: { x: 320, y: 0, width: 640, height: 56 } }),
  });

  // Light-mode pill + expanded drawer.
  await submit('Write a TypeScript debounce function', LONG_REPLY);
  await expectBadge('INFORMATIVE', false);
  cases.push({
    name: 'badge-informative-light',
    caption: 'Collapsed INFORMATIVE pill on a light-theme host: terracotta and peach tokens with blue water telemetry applied without a page reload.',
    image: await shot('badge-informative-light', { element: page.locator('[data-prompt-tax="true"]').last() }),
  });
  await openDrawer();
  cases.push({
    name: 'drawer-light',
    caption: 'Expanded drawer, light theme: warm cream surfaces, espresso text, terracotta energy meters, and blue water telemetry.',
    image: await shot('drawer-light', { element: page.locator('[data-prompt-tax="true"]').last() }),
  });

  // Light-mode roast pill keeps the high-contrast roast theme (#EF4444).
  await gotoFixture('https://gemini.google.com/app');
  await setTheme('light');
  await submit('Thanks', SHORT_REPLY);
  await expectBadge('POLITE', true);
  await page.waitForFunction(
    () => {
      const hosts = [...document.querySelectorAll('[data-prompt-tax="true"]')];
      return hosts[hosts.length - 1]?.getAttribute('data-ptx-pill-theme') === 'red';
    },
    undefined,
    { timeout: 5000 },
  );
  cases.push({
    name: 'badge-polite-light',
    caption: 'Roast pill in LIGHT mode: high-contrast roast tokens (#FEF2F2 bg, #EF4444 border, #7F1D1D text) keep instant regret loud.',
    image: await shot('badge-polite-light', { element: page.locator('[data-prompt-tax="true"]').last() }),
  });

  // Citation modal (gemini host, opened via sanctioned event).
  await gotoFixture('https://gemini.google.com/app');
  await submit('Write a TypeScript debounce function', LONG_REPLY);
  await expectBadge('INFORMATIVE', false);
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('prompt-tax:info', { bubbles: true, composed: true })),
  );
  // Overlay renders inside the closed shadow root, so the light-DOM host
  // is zero-size and never reports "visible" — wait for attachment.
  await page.waitForSelector('.ptx-modal-host', { state: 'attached', timeout: 5000 });
  await page.waitForFunction(
    () => document.querySelector('.ptx-modal-host')?.dataset.ptxMacroPerspective === 'true',
    undefined,
    { timeout: 5000 },
  );
  // The panel clips its overflow (content ~950px in a 640px box). A native
  // wheel gesture over the panel center scrolls the inner overflow
  // container directly — works even though it lives in a closed shadow.
  await page.mouse.move(640, 430, { steps: 4 });
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(350);
  cases.push({
    name: 'citation-modal',
    caption: 'Citation modal: Scope 1 on-site cooling / Scope 2 off-site thermoelectric grid water, citations (UC Riverside, Hugging Face, IEA), updated methodology with the 9x output-energy penalty.',
    image: await shot('citation-modal'),
  });

  // --- Popup states ------------------------------------------------------------
  swReady = context.serviceWorkers()[0] ?? null;
  const popupUrl = (url) => url.replace(/service-worker\.js.*$/, 'popup.html');
  // The test profile's storage already accumulated earlier cases; clear it
  // through the extension's own popup context to capture the clean state.
  const capturePopup = async (name, { clearFirst = false, seedAnnualPace = false } = {}) => {
    const worker = swReady ??
      (await context.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null));
    if (!worker) throw new Error('No extension service worker visible; cannot locate popup URL');
    swReady = worker;
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 180, height: 560 });
    await popup.goto(popupUrl(worker.url()));
    await popup.waitForTimeout(400);
    await popup.waitForFunction(() => {
      const logo = document.querySelector('.mtx-logo');
      return logo?.complete && logo.naturalWidth > 0 && getComputedStyle(document.body).backgroundColor === 'rgb(18, 14, 13)';
    });
    const intrinsicWidth = await popup.locator('body').evaluate((body) => body.getBoundingClientRect().width);
    if (intrinsicWidth !== 360) {
      throw new Error(`${name}: popup collapsed to ${intrinsicWidth}px in its initial narrow viewport`);
    }
    await popup.setViewportSize({ width: 360, height: 600 });
    if (clearFirst) {
      await popup.evaluate(() => chrome.storage.local.set({
        days: {},
        dailyHistory: {},
        allTime: { prompts: 0, waterMl: 0, energyWh: 0, fillerCount: 0 },
        scannedThreadFingerprints: [],
      }));
      await popup.waitForTimeout(400);
    }
    if (seedAnnualPace) {
      await popup.evaluate(async () => {
        const now = new Date();
        const history = Object.fromEntries([0, 1, 2].map((offset) => {
          const date = new Date(now);
          date.setUTCDate(date.getUTCDate() - offset);
          const key = date.toISOString().slice(0, 10);
          return [key, { totalWaterMl: 150, totalEnergyWh: 10, totalPrompts: 5, politeTaxCount: 1, fillerCount: 1 }];
        }));
        await chrome.storage.local.set({
          days: history,
          dailyHistory: history,
          allTime: { prompts: 15, waterMl: 450, energyWh: 30, fillerCount: 3 },
          scannedThreadFingerprints: [],
        });
      });
      await popup.waitForFunction(() => {
        const card = document.getElementById('ptx-annual-pace');
        const text = document.getElementById('ptx-pace-text')?.textContent ?? '';
        return card?.style.display === 'block' && text.includes('54.8 liters') && text.includes('3.6 kWh');
      });
    }
    const attributionVisible = await popup.locator('.mtx-attribution').isVisible();
    if (!attributionVisible) throw new Error(`${name}: Twemoji attribution disappeared after rendering receipts`);
    const dimensions = await popup.evaluate(() => {
      const body = document.body;
      const singleLine = (element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length === 1;
      };
      return {
        width: body.getBoundingClientRect().width,
        height: body.getBoundingClientRect().height,
        fits: body.scrollWidth <= body.clientWidth,
        buttonSingleLine: singleLine(document.querySelector('.ptx-scan-btn')),
        valuesSingleLine: [...document.querySelectorAll('.stat .value')].every(singleLine),
      };
    });
    if (dimensions.width !== 360 || dimensions.height > 600 || !dimensions.fits ||
        !dimensions.buttonSingleLine || !dimensions.valuesSingleLine) {
      throw new Error(`${name}: popup dimension regression: ${JSON.stringify(dimensions)}`);
    }
    const file = `${name}.png`;
    await popup.locator('body').screenshot({ path: path.join(shotsDir, file) });
    await popup.close();
    console.log(`[capture] ${name} -> screenshots/${file}`);
    return `screenshots/${file}`;
  };

  // --- Multi-tier conversation overview (Gemini thread) ----------------------
  await gotoFixture('https://gemini.google.com/app');
  await submit('Thanks', SHORT_REPLY);
  await expectBadge('POLITE', true, 1);
  await submit('45 * 12', SHORT_REPLY);
  await expectBadge('SIMPLE_MATH', true, 2);
  await submit('capital of france', SHORT_REPLY);
  await expectBadge('QUICK_SEARCH', true, 3);
  await submit('Write a TypeScript debounce function', LONG_REPLY);
  await expectBadge('INFORMATIVE', false, 4);
  cases.unshift({
    name: 'conversation-overview',
    caption: 'One Gemini thread: pre-seeded history in the thread dock, all four intent tiers centered under their responses.',
    image: await shot('conversation-overview', { fullPage: true }),
  });

  // Popup last: enough recorded prompts (>10) to show the ⚡ mid-tier
  // "Scale Reality Check" badge, then the zero state.
  cases.push({
    name: 'popup-populated',
    caption: 'Toolbar popup after the full run: combined water (Scope 1+2), energy, politeness-tax count, and the contextual Scale Reality Check tier.',
    image: await capturePopup('popup-populated'),
  });

  cases.push({
    name: 'popup-annual-pace',
    caption: 'Personal annual projection appears at 15 prompts and uses three active days of empirical water and energy totals.',
    image: await capturePopup('popup-annual-pace', { seedAnnualPace: true }),
  });

  cases.push({
    name: 'popup-zero-state',
    caption: 'Toolbar popup with storage cleared: zeroed stat grid, the "no receipts yet" footer, and the first-tier scale-check message.',
    image: await capturePopup('popup-zero-state', { clearFirst: true }),
  });

  writeFileSync(path.join(shotsDir, 'cases.json'), JSON.stringify({ cases, telemetry }, null, 2));
  await context.close();
  console.log(`\n[capture] Done: ${cases.length} screenshots + cases.json in docs/screenshots/`);
}

run().catch((err) => {
  console.error('[capture Error]:', err);
  process.exit(1);
});
