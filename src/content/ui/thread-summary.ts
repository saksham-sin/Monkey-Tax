/**
 * Existing-chat thread rollup. When a conversation URL already contains
 * history, the adapter's getThreadTurns() scan aggregates every visible
 * turn and a translucent dark-glass dock pinned to the top center shows
 * a compact line: turns, water, lamp-runtime, and a Details toggle.
 * expanded it becomes a 4-card dashboard plus a deep-history scanner:
 * chat apps virtualize their message lists, so the "Scan Entire
 * History" button incrementally scrolls the container to the top,
 * forcing the web app to hydrate older turns, then recomputes totals.
 *
 * Idempotent by construction: totals are always recomputed from the
 * DOM, so seeded history and live turns can never be double-counted.
 * Copy rule: no em/en dashes in user-facing strings.
 */
import { calculateFootprint, GOOGLE_SEARCH_WH, humanWaterVisual } from '../engine/calculator';
import { createIsolatedRoot } from './shadow-root';
import type { ThreadTurn } from '../adapters/base.adapter';

/** Wh that keeps a 10 W desk lamp lit for an hour fraction helper. */
const LAMP_WATTS = 10;
/** High-power microwave input used for the household-equivalence card. */
const MICROWAVE_WATTS = 900;
/** Approximate continuous phone screen draw for higher thread totals. */
const PHONE_SCREEN_WATTS = 1.8;

export const DEEP_SCAN_EVENT = 'prompt-tax:deepscan';

const STYLES = `
  :host {
    position: fixed !important;
    top: 12px !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    width: auto !important;
    margin: 0 !important;
    z-index: 2147483646 !important;
    pointer-events: auto !important;
    align-items: flex-start !important;
  }
  .ptx-thread-wrap { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .ptx-thread-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    backdrop-filter: blur(8px);
    background: var(--ptx-bg-pill);
    border: 1px solid var(--ptx-border-subtle);
    border-radius: 999px;
    padding: 6px 14px;
    font: 12px/1.3 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ptx-text-primary);
    box-shadow: var(--ptx-shadow);
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    max-width: 94vw;
  }
  .ptx-thread-pill b { color: var(--ptx-text-primary); font-weight: 600; }
  .ptx-thread-pill .caret { color: var(--ptx-chip-text); font-weight: 700; font-size: 10px; }
  .ptx-thread-heading { color: var(--ptx-text-primary); font-size: 12px; font-weight: 700; margin: 2px 0; }
  .ptx-thread-drawer {
    width: max-content;
    max-width: 94vw;
    max-height: 0;
    opacity: 0;
    overflow: hidden;
    transform: translateY(-6px);
    transition: max-height 280ms ease, opacity 240ms ease, transform 240ms ease;
    backdrop-filter: blur(10px);
    background: var(--ptx-surface-drawer);
    border: 1px solid var(--ptx-border-subtle);
    border-radius: 12px;
    padding: 0 12px;
    font: 11.5px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ptx-text-secondary);
    box-shadow: var(--ptx-shadow);
  }
  .ptx-thread-wrap.open .ptx-thread-drawer {
    max-height: 340px;
    opacity: 1;
    transform: translateY(0);
    padding: 10px 12px 12px;
  }
  .ptx-thread-drawer .ptx-stat-value { color: var(--ptx-chip-text); }
  .ptx-bottle {
    display: inline-block;
    width: 10px;
    height: 18px;
    border: 1px solid var(--ptx-water-accent);
    border-radius: 3px;
    position: relative;
    overflow: hidden;
    background: var(--ptx-water-bg);
    flex: 0 0 auto;
  }
  .ptx-bottle i {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--ptx-water-accent);
  }
  .ptx-scan-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 4px;
    padding: 6px 8px;
    border: 1px dashed var(--ptx-chip-border);
    border-radius: 8px;
    color: var(--ptx-text-secondary);
    font-size: 10.5px;
  }
`;

export interface ThreadSummary {
  /**
   * Recompute from the adapter's current view of the DOM and (re)mount
   * the dock. Idempotent: seeded history and freshly completed live
   * turns are always counted from the page itself.
   */
  refresh(): void;
}

/** Renders 12.0 as "12" but keeps 12.34 as "12.34"-precision output. */
function fmt(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return text.endsWith(`.${'0'.repeat(decimals)}`) ? String(Math.round(value)) : text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * All scrollable containers that could host the conversation, including
 * ones inside OPEN shadow roots of the host app (Gemini/ChatGPT/Claude
 * wrap their chat panels in custom elements, so a single document-
 * level `main` lookup finds the wrong or a non-scrollable node in real
 * browsers). Ranked by how many message-ish nodes each contains.
 */
function findScrollers(): Element[] {
  const found: Element[] = [];
  let budget = 5000;

  const visit = (el: Element): void => {
    if (budget <= 0) return;
    budget -= 1;
    const styled = el instanceof HTMLElement ? el : null;
    if (styled) {
      const overflowY = getComputedStyle(styled).overflowY;
      if (
        styled.scrollHeight > styled.clientHeight + 40 &&
        (overflowY === 'auto' || overflowY === 'scroll')
      ) {
        found.push(styled);
      }
      const nested = styled.shadowRoot;
      if (nested) {
        for (const child of Array.from(nested.children)) visit(child);
      }
    }
    for (const child of Array.from(el.children)) visit(child);
  };
  for (const child of Array.from(document.body.children)) visit(child);

  if (document.scrollingElement) found.push(document.scrollingElement);

  // The true chat scroller almost always contains the messages.
  const score = (el: Element): number =>
    el.querySelectorAll(
      '[class*="message"], [data-message-id], [data-test-id*="message"], [data-testid*="message"], [data-turn], article, .conversation-container',
    ).length;
  found.sort((a, b) => score(b) - score(a));
  return found;
}

function conversationScrollers(): Element[] {
  const candidates = findScrollers();
  const chatScrollers = candidates.filter((el) => el !== document.scrollingElement &&
    !!el.querySelector('[data-chatgpt-search-unit-key], [data-message-author-role], [data-is-streaming], [data-testid="assistant-message"], model-response, .conversation-container'));
  return chatScrollers.length > 0 ? chatScrollers : candidates;
}

async function scrollHistoryToTop(getThreadTurns: () => ThreadTurn[]): Promise<boolean> {
  const savedStyles = new Map<HTMLElement, { value: string; priority: string }>();
  const topProbes = new WeakMap<Element, number>();
  const gemini = location.hostname === 'gemini.google.com';
  const quietWindowMs = gemini ? 7000 : 3000;
  const started = Date.now();
  let stableSince = started;
  let previous = '';
  try {
    while (Date.now() - started < 60_000) {
      const scrollers = conversationScrollers();
      const loadingBefore = historyIsLoading(scrollers, gemini);
      const rearm = gemini && !loadingBefore ? scrollers.filter((el) =>
        el.scrollTop <= 1 && el.scrollHeight > el.clientHeight + 40 &&
        Date.now() - (topProbes.get(el) ?? 0) >= 1500) : [];
      scrollers.forEach((el) => {
        if (el instanceof HTMLElement && !savedStyles.has(el)) {
          savedStyles.set(el, {
            value: el.style.getPropertyValue('scroll-behavior'),
            priority: el.style.getPropertyPriority('scroll-behavior'),
          });
          el.style.setProperty('scroll-behavior', 'auto', 'important');
        }
        if (rearm.includes(el)) {
          topProbes.set(el, Date.now());
          el.scrollTop = Math.min(el.clientHeight + 80, el.scrollHeight - el.clientHeight);
        } else {
          el.scrollTop = gemini ? 0 : Math.max(0, el.scrollTop - Math.max(200, el.clientHeight * 0.7));
        }
      });
      if (rearm.length > 0) {
        await sleep(120);
        rearm.forEach((el) => { el.scrollTop = 0; });
      }
      await sleep(250);
      const dimensions = scrollers.map((el) => [el.scrollHeight, el.clientHeight].join(':')).join('|');
      const snapshot = [getThreadTurns().length, dimensions].join('|');
      const atTop = scrollers.every((el) => !el.isConnected || Math.abs(el.scrollTop) <= 1);
      const loading = historyIsLoading(scrollers, gemini);
      if (snapshot !== previous || !atTop || loading) stableSince = Date.now();
      previous = snapshot;
      if (atTop && !loading && Date.now() - stableSince >= quietWindowMs) return true;
    }
    return false;
  } finally {
    savedStyles.forEach((style, el) => el.style.setProperty('scroll-behavior', style.value, style.priority));
  }
}

function historyIsLoading(scrollers: Element[], gemini: boolean): boolean {
  const selector = gemini
    ? '[aria-busy="true"], [role="progressbar"], mat-progress-spinner, mat-spinner, [data-test-id="loading-content-spinner"], .loading-content-spinner-container'
    : '[aria-busy="true"], [role="progressbar"]';
  const loaders = new Set<HTMLElement>();
  for (const scroller of scrollers) {
    scroller.querySelectorAll<HTMLElement>(selector).forEach((loader) => loaders.add(loader));
  }
  if (gemini) {
    document.querySelectorAll<HTMLElement>(selector).forEach((loader) => loaders.add(loader));
  }
  const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  return Array.from(loaders).some((loader) => {
    if (!loader.checkVisibility()) return false;
    const rect = loader.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= viewport.left ||
        rect.left >= viewport.right || rect.bottom <= viewport.top || rect.top >= viewport.bottom) return false;
    if (!gemini) return true;
    return scrollers.some((scroller) => {
      const bounds = scroller.getBoundingClientRect();
      return rect.right > bounds.left && rect.left < bounds.right &&
        rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
  });
}

export function createThreadSummary(getThreadTurns: () => ThreadTurn[]): ThreadSummary {
  let host: HTMLElement | null = null;
  let pill: HTMLElement | null = null;
  let drawerBody: HTMLElement | null = null;
  let wrapRef: HTMLElement | null = null;
  let lastTurnCount = 0;
  let scanning = false;
  let threadUrl = location.href;
  const observedTurns = new Map<string, ThreadTurn>();

  function collectTurns(): ThreadTurn[] {
    if (threadUrl !== location.href) {
      threadUrl = location.href;
      observedTurns.clear();
      host?.removeAttribute('data-ptx-scanned');
      host?.removeAttribute('data-ptx-scan-state');
    }
    const turns = getThreadTurns();
    for (const turn of turns) {
      if (turn.id) observedTurns.set(turn.id, turn);
    }
    return turns.every((turn) => !!turn.id) ? [...observedTurns.values()] : turns;
  }

  function ensureMounted(): void {
    if (host) return;
    const root = createIsolatedRoot('div', 'ptx-thread-host');
    root.addStyle(STYLES);
    root.host.dataset['promptTax'] = 'thread';

    const wrap = document.createElement('div');
    wrap.className = 'ptx-thread-wrap';

    const pillEl = document.createElement('div');
    pillEl.className = 'ptx-thread-pill';
    pillEl.setAttribute('role', 'button');
    pillEl.setAttribute('tabindex', '0');

    const drawer = document.createElement('div');
    drawer.className = 'ptx-thread-drawer';
    const inner = document.createElement('div');
    drawer.appendChild(inner);

    wrap.append(pillEl, drawer);
    root.body.appendChild(wrap);
    // Mount DIRECTLY on <body>: appending inside a chat app's clipped or
    // transformed container would hide the dock behind sticky chrome.
    document.body.appendChild(root.host);

    host = root.host;
    pill = pillEl;
    drawerBody = inner;
    wrapRef = wrap;

    // Single host-level listener. A real click on the pill is retargeted
    // to the host as it crosses the closed shadow boundary, so listening
    // on the host alone catches every click exactly once. (Attaching a
    // second listener on the pill would double-toggle: once from the
    // pill, again from the retargeted host event, netting a no-op.)
    const toggle = (event: Event): void => {
      const path = event.composedPath();
      if (path.some((node) => node instanceof HTMLButtonElement)) return;
      event.preventDefault();
      event.stopPropagation();
      const open = wrap.classList.toggle('open');
      // Sanctioned E2E surface for dock state (shadow root is closed).
      root.host.dataset['ptxOpen'] = String(open);
      refresh(); // re-renders the caret label to match the new state
    };
    root.host.addEventListener('click', toggle);
    pillEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') toggle(event);
    });

    // The expanded dock overlays the chat like a popover: any click that
    // lands outside it (verified via composedPath across the closed
    // shadow boundary) collapses it, so it can never trap the page.
    // Capture phase: runs before the clicked widget, never cancels it.
    document.addEventListener(
      'click',
      (event) => {
        if (!root.host.isConnected || !host || !wrap.classList.contains('open')) return;
        if (event.composedPath().includes(root.host)) return;
        wrap.classList.remove('open');
        root.host.dataset['ptxOpen'] = 'false';
        refresh();
      },
      true,
    );

    // Automation hook (capture script/E2E): run the deep scan without
    // being able to reach the button inside the closed shadow root.
    root.host.addEventListener(DEEP_SCAN_EVENT, () => void deepScan());
  }

  async function deepScan(): Promise<void> {
    if (!host || scanning) return;
    scanning = true;
    host.dataset['ptxScanState'] = 'scanning';
    delete host.dataset['ptxScanned'];
    const button = findScanButton();
    if (button) button.textContent = 'Scanning thread...';
    try {
      const complete = await scrollHistoryToTop(collectTurns);
      refresh();
      host.dataset['ptxScanState'] = complete ? 'complete' : 'limited';
      if (complete) host.dataset['ptxScanned'] = String(lastTurnCount);
      const doneButton = findScanButton();
      if (doneButton) {
        doneButton.textContent = complete
          ? `\u2713 Thread Scanned (${lastTurnCount} loaded turns)`
          : `Scan limit reached (${lastTurnCount} loaded turns). Retry`;
      }
    } catch {
      host.dataset['ptxScanState'] = 'error';
      const retryButton = findScanButton();
      if (retryButton) retryButton.textContent = 'Scan interrupted. Retry';
    } finally {
      scanning = false;
      const scanButton = findScanButton() as HTMLButtonElement | null;
      if (scanButton) scanButton.disabled = false;
    }
  }

  function findScanButton(): HTMLElement | null {
    return drawerBody ? drawerBody.querySelector<HTMLButtonElement>('#ptx-deep-scan-btn') : null;
  }

  function card(icon: string, value: string, label: string, extra?: HTMLElement): HTMLElement {
    const cardEl = document.createElement('div');
    cardEl.className = 'ptx-stat-card';
    const valueEl = document.createElement('div');
    valueEl.className = 'ptx-stat-value';
    valueEl.textContent = `${icon} ${value}`;
    if (extra) valueEl.insertBefore(extra, valueEl.firstChild);
    const labelEl = document.createElement('div');
    labelEl.className = 'ptx-stat-label';
    labelEl.textContent = label;
    cardEl.append(valueEl, labelEl);
    return cardEl;
  }

  function refresh(): void {
    const turns = collectTurns();
    if (turns.length === 0) {
      host?.remove();
      host = null;
      return;
    }

    // If the page tore down our dock (SPA full re-render), remount it.
    if (host && !host.isConnected) host = null;
    ensureMounted();
    const mountedHost = host as HTMLElement;
    const mountedPill = pill as HTMLElement;
    const inner = drawerBody as HTMLElement;
    const wrap = wrapRef as HTMLElement;

    const aggregate = turns.map((turn) =>
      calculateFootprint(turn.inputChars, turn.outputChars, turn.isReasoning),
    );
    const totalWaterMl = aggregate.reduce((sum, m) => sum + m.waterMl, 0);
    const totalEnergyWh = aggregate.reduce((sum, m) => sum + m.energyWh, 0);
    const ledHours = totalEnergyWh / LAMP_WATTS;
    const searches = Math.round(totalEnergyWh / GOOGLE_SEARCH_WH);
    const microwaveSecs = Math.max(1, Math.round((totalEnergyWh / MICROWAVE_WATTS) * 3600));
    const card4Value = totalEnergyWh < 20
      ? `${microwaveSecs} secs`
      : `${(totalEnergyWh / PHONE_SCREEN_WATTS).toFixed(1)} hrs`;
    const card4Label = totalEnergyWh < 20
      ? 'Blasts a microwave on high that long'
      : 'Continuous phone screen-on time';
    lastTurnCount = turns.length;

    // Dataset on the light-DOM host is the sanctioned E2E surface.
    mountedHost.dataset['ptxTurns'] = String(turns.length);
    mountedHost.dataset['ptxWaterMl'] = String(Math.round(totalWaterMl * 100) / 100);
    mountedHost.dataset['ptxEnergyWh'] = String(Math.round(totalEnergyWh * 100) / 100);

    // --- Collapsed dock pill ---
    const bold = (parts: (string | HTMLElement)[]): HTMLElement => {
      const span = document.createElement('span');
      for (const part of parts) {
        if (typeof part === 'string') {
          span.appendChild(document.createTextNode(part));
        } else {
          span.appendChild(part);
        }
      }
      return span;
    };
    const b = (text: string): HTMLElement => {
      const el = document.createElement('b');
      el.textContent = text;
      return el;
    };
    mountedPill.replaceChildren(
      bold([
        '\uD83D\uDC12 MonkeyTax: ',
        b(`${turns.length} turns`),
        ' | \uD83D\uDCA7 ',
        b(`~${fmt(totalWaterMl, 0)}ml`),
        ' | \uD83D\uDCA1 ',
        b(`${fmt(ledHours, 1)}h lamp`),
      ]),
    );
    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.textContent = wrap.classList.contains('open')
      ? '\u25B2 Hide'
      : '\u25BC Details';
    mountedPill.appendChild(caret);

    // --- Expanded dashboard ---
    inner.replaceChildren();
    const grid = document.createElement('div');
    grid.className = 'ptx-stat-grid';
    const heading = document.createElement('div');
    heading.className = 'ptx-thread-heading';
    heading.textContent = '\uD83D\uDC12 Thread Consumption \u2022 MonkeyTax';

    const bottle = document.createElement('span');
    bottle.className = 'ptx-bottle';
    const fill = document.createElement('i');
    fill.style.height = `${Math.min(100, Math.max(6, (totalWaterMl / 500) * 100)).toFixed(0)}%`;
    bottle.appendChild(fill);

    grid.append(
      card('\uD83D\uDCA7', `~${fmt(totalWaterMl, 0)}ml`, `Water drank (${humanWaterVisual(totalWaterMl)})`, bottle),
      card('\u26A1', `${fmt(totalEnergyWh, 1)} Wh`, `\uD83D\uDCA1 ${fmt(ledHours, 1)} hours of light`),
      card('\uD83D\uDD0D', `${searches}\u00D7`, 'Equivalent regular web searches'),
      card('\u26A1', card4Value, card4Label),
    );
    inner.append(heading, grid);

    const banner = document.createElement('div');
    banner.className = 'ptx-scan-banner';
    const note = document.createElement('span');
    note.textContent = `Viewing ${turns.length} turns currently loaded in view.`;
    const scanButton = document.createElement('button');
    scanButton.id = 'ptx-deep-scan-btn';
    scanButton.className = 'ptx-btn-primary';
    scanButton.type = 'button';
    scanButton.disabled = scanning;
    scanButton.textContent =
      mountedHost.dataset['ptxScanned'] === String(turns.length)
        ? `\u2713 Thread Scanned (${turns.length} loaded turns)`
        : '\u26A1 Scan Entire History';
    if (scanning) scanButton.textContent = 'Scanning thread...';
    scanButton.addEventListener('click', (event) => {
      event.stopPropagation();
      void deepScan();
    });
    banner.append(note, scanButton);
    inner.appendChild(banner);

    // Sanctioned real-click surface: the button lives in a CLOSED shadow
    // root, so a Playwright/mouse harness cannot select it. Publish its
    // position relative to the host once the open/close transition has
    // settled; harnesses click at host + (x, y) like an actual user.
    const measureHost = mountedHost;
    delete measureHost.dataset['ptxScanBtnRect'];
    window.setTimeout(() => {
      if (!scanButton.isConnected || !wrap.classList.contains('open')) return;
      const rect = scanButton.getBoundingClientRect();
      if (rect.height <= 0) return;
      const hostRect = measureHost.getBoundingClientRect();
      measureHost.dataset['ptxScanBtnRect'] = [
        Math.round(rect.left - hostRect.left + rect.width / 2),
        Math.round(rect.top - hostRect.top + rect.height / 2),
      ].join(',');
    }, 340);

    console.log(
      '[MonkeyTax] Thread rollup:',
      turns.length,
      'turns |',
      totalWaterMl.toFixed(1),
      'ml |',
      totalEnergyWh.toFixed(2),
      'Wh',
    );
  }

  return { refresh };
}
