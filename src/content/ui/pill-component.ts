/**
 * Response badge: a compact, icon-first status pill rendered inside a
 * closed shadow root. Collapsed it is a row of tiny visual widgets
 * (water glass icons + everyday visual, lamp-runtime meter, search
 * equivalence), never a wall of text. Clicking toggles an accordion
 * drawer with in-line SVG segment meters for energy and water, the
 * Scope 1/Scope 2 cooling split, the rotating Reddit hardware reality
 * check, and a citation link that opens the research modal.
 *
 * Copy rule: no em/en dashes anywhere in user-facing strings.
 */
import type { RenderedCopy } from '../engine/generator';
import { GOOGLE_SEARCH_WH } from '../engine/calculator';
import { createIsolatedRoot } from './shadow-root';

export const INFO_EVENT = 'prompt-tax:info';

const STYLES = `
  :host, .ptx-body { all: initial; display: contents; }
  .ptx-wrap { display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 720px; }
  .ptx-pill {
    --ptx-muted: var(--ptx-text-secondary);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--ptx-border-pill);
    border-radius: 999px;
    background: var(--ptx-bg-pill);
    backdrop-filter: blur(6px);
    font: 11.5px/1.4 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ptx-text-primary);
    box-shadow: var(--ptx-shadow);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }
  .ptx-pill:hover { border-color: var(--ptx-chip-border); }
  /* Keep the open pill + drawer stacked above sticky chat input bars. */
  :host([data-ptx-open="true"]) {
    position: relative !important;
    z-index: 2147483645 !important;
  }
  :host([data-ptx-platform="claude"]),
  :host([data-ptx-platform="claude"][data-ptx-open="true"]) {
    z-index: 0 !important;
    isolation: isolate;
  }
  .ptx-widget {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--ptx-chip-bg);
    border: 1px solid var(--ptx-chip-border);
    border-radius: 999px;
    padding: 2px 8px;
    font-weight: 600;
    color: var(--ptx-chip-text);
  }
  .ptx-widget.ptx-water {
    color: var(--ptx-water-accent);
    background: var(--ptx-water-bg);
    border-color: var(--ptx-water-accent);
  }
  .ptx-flame { font-size: 13px; flex: 0 0 auto; }
  .ptx-pill-text {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .ptx-pill-text b { color: var(--ptx-text-primary); font-weight: 700; }
  .ptx-pill-sub { opacity: 0.85; }
  .ptx-chip, .ptx-metric-chip {
    flex: 0 0 auto;
    font-size: 10px;
    font-weight: 700;
    color: var(--ptx-chip-text);
    background: var(--ptx-chip-bg);
    border: 1px solid var(--ptx-chip-border);
    border-radius: 999px;
    padding: 2px 7px;
    white-space: nowrap;
  }
  .ptx-chevron {
    flex: 0 0 auto;
    font-size: 10px;
    color: var(--ptx-muted);
    transition: transform 220ms ease;
  }
  .ptx-wrap.ptx-open .ptx-chevron { transform: rotate(180deg); }
  .ptx-drawer {
    width: 100%;
    max-height: 0;
    opacity: 0;
    overflow: hidden;
    transform: translateY(-6px);
    transition: max-height 260ms ease, opacity 220ms ease, transform 260ms ease;
    font: 11.5px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ptx-text-primary);
    background: var(--ptx-surface-drawer);
    border: 1px solid var(--ptx-border-subtle);
    border-radius: 12px;
    box-shadow: var(--ptx-shadow);
  }
  .ptx-wrap.ptx-open .ptx-drawer { max-height: 520px; opacity: 1; transform: translateY(0); }
  :host([data-ptx-platform="claude"]) .ptx-drawer:not(:popover-open) { display: none; }
  :host([data-ptx-platform="claude"]) .ptx-drawer[popover] {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    overflow: auto;
    transition: none;
    transform: none;
  }
  .ptx-drawer-inner { padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 7px; }
  .ptx-drawer h4 { margin: 2px 0 0; font-size: 10px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--ptx-chip-text); }
  .ptx-meter-row { display: flex; align-items: center; gap: 8px; color: var(--ptx-text-primary); }
  .ptx-meter-row .tag { color: var(--ptx-text-secondary); font-size: 10.5px; white-space: nowrap; }
  .ptx-scope { display: flex; justify-content: space-between; gap: 12px; color: var(--ptx-text-primary); }
  .ptx-scope b { color: var(--ptx-text-primary); font-weight: 600; }
  /* Full punchline in the drawer: the collapsed pill may ellipsize on
     narrow viewports, so the drawer always shows the whole roast, wrapped. */
  .ptx-fullline { white-space: normal; color: var(--ptx-roast-text); line-height: 1.45; }
  .ptx-fullline b { color: var(--ptx-roast-text); font-weight: 700; }
  .ptx-reddit { color: var(--ptx-text-primary); }
  .ptx-info {
    align-self: flex-start;
    border: none;
    background: transparent;
    color: var(--ptx-muted);
    font: 600 11px/1 sans-serif;
    cursor: pointer;
    padding: 0;
    text-decoration: underline dotted;
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .ptx-info:hover { color: var(--ptx-text-primary); }
`;

/** Drops the trailing " of water"/"water" noise for compact chips. */
function shortWater(waterVisual: string): string {
  return waterVisual
    .replace(' of water', '')
    .replace('water bottles', 'bottles')
    .replace('a cup of water', 'a cup');
}

/** 4-segment CSS battery; segments light per whole web-search equivalent. */
function meter(segments: number, kind: 'power' | 'water'): HTMLElement {
  const bar = document.createElement('span');
  bar.className = kind === 'water' ? 'ptx-meter water' : 'ptx-meter';
  for (let i = 0; i < 4; i += 1) {
    const seg = document.createElement('i');
    if (i < segments) seg.classList.add('on');
    bar.appendChild(seg);
  }
  return bar;
}

function litSegments(wh: number): number {
  return Math.min(4, Math.max(1, Math.round(wh / GOOGLE_SEARCH_WH)));
}

export function createPillElement(copy: RenderedCopy, tier: string): HTMLElement {
  const { host, body, addStyle } = createIsolatedRoot();
  addStyle(STYLES);
  // Closed shadow roots are intentionally unreadable from the page; these
  // attributes are the sanctioned surface for E2E assertions.
  host.dataset['ptxTier'] = tier;
  host.dataset['ptxRoast'] = String(copy.isRoast);

  const wrap = document.createElement('div');
  wrap.className = 'ptx-wrap';

  const pill = document.createElement('div');
  pill.className = copy.isRoast ? 'ptx-pill ptx-roast' : 'ptx-pill';
  pill.setAttribute('role', 'button');
  pill.setAttribute('tabindex', '0');
  pill.setAttribute('aria-expanded', 'false');
  pill.setAttribute('aria-label', `MonkeyTax | ${copy.headline}`);

  const chevron = document.createElement('span');
  chevron.className = 'ptx-chevron';
  chevron.textContent = '\u25BC';

  if (copy.isRoast) {
    // Instant regret: the FULL punchline is on the pill, no click needed.
    // [flame] [bold headline + spoken-mode tail] [N x search chip] [chevron]
    const flame = document.createElement('span');
    flame.className = 'ptx-flame';
    flame.textContent = '\uD83D\uDD25';

    const text = document.createElement('span');
    text.className = 'ptx-pill-text';
    const head = document.createElement('b');
    head.textContent = copy.headline;
    const tail = document.createElement('span');
    tail.className = 'ptx-pill-sub';
    tail.textContent = ` ${copy.subtext}`;
    text.append(head, tail);

    const chip = document.createElement('span');
    chip.className = 'ptx-chip ptx-metric-chip';
    chip.textContent = `${copy.googleSearchEquiv}\u00D7 search`;
    pill.append(flame, text, chip, chevron);
  } else {
    // [water widget] [lamp meter widget] [search widget] [chevron]
    const water = document.createElement('span');
    water.className = 'ptx-widget ptx-water';
    water.textContent = `\uD83D\uDCA7 ~${shortWater(copy.waterVisual)}`;

    const lamp = document.createElement('span');
    lamp.className = 'ptx-widget';
    lamp.textContent = `\uD83D\uDCA1 ${copy.ledMinutes}m lamp`;

    const search = document.createElement('span');
    search.className = 'ptx-widget';
    search.textContent = `\u26A1 ${copy.googleSearchEquiv}\u00D7 web search`;

    pill.append(water, lamp, search, chevron);
  }

  // --- Accordion drawer: icon meters first, details below ---
  const drawer = document.createElement('div');
  drawer.className = 'ptx-drawer';
  const inner = document.createElement('div');
  inner.className = 'ptx-drawer-inner';

  const energyRow = document.createElement('div');
  energyRow.className = 'ptx-meter-row';
  const lampTag = document.createElement('span');
  const laptopSeconds = Math.max(1, Math.round((copy.energyWh / 65) * 3600));
  lampTag.textContent =
    copy.ledMinutes >= 1
      ? `\uD83D\uDCA1 ${copy.ledMinutes}m desk lamp`
      : `\uD83D\uDCA1 ${laptopSeconds}s laptop load`;
  energyRow.append(meter(litSegments(copy.energyWh), 'power'), lampTag);

  const waterRow = document.createElement('div');
  waterRow.className = 'ptx-meter-row';
  const glassCount = Math.min(4, Math.max(1, Math.round(copy.waterMl / 20)));
  const glasses = document.createElement('span');
  glasses.textContent = '\uD83E\uDD5B'.repeat(glassCount);
  waterRow.append(
    meter(litSegments(copy.waterMl / 12), 'water'),
    glasses,
    document.createTextNode(`~${copy.waterVisual}`),
  );

  const scopeTitle = document.createElement('h4');
  scopeTitle.textContent = 'Cooling breakdown';
  const scope1 = document.createElement('div');
  scope1.className = 'ptx-scope';
  scope1.innerHTML =
    `<span>Scope 1 \u00B7 Direct towers</span><b>~${copy.waterMlDirect.toFixed(0)}ml</b>`;
  const scope2 = document.createElement('div');
  scope2.className = 'ptx-scope';
  scope2.innerHTML =
    `<span>Scope 2 \u00B7 Grid water</span><b>~${copy.waterMlGrid.toFixed(0)}ml</b>`;

  const hardwareTitle = document.createElement('h4');
  hardwareTitle.textContent = 'Hardware reality check';
  const reddit = document.createElement('div');
  reddit.className = 'ptx-reddit';
  reddit.textContent = copy.redditRoast;

  // The collapsed pill can ellipsize on narrow viewports, so the drawer
  // always spells out the complete punchline in wrapping text.
  if (copy.isRoast) {
    const fullLine = document.createElement('div');
    fullLine.className = 'ptx-fullline';
    const fullHead = document.createElement('b');
    fullHead.textContent = copy.headline;
    fullLine.append(fullHead, document.createTextNode(` ${copy.subtext}`));
    inner.append(fullLine, energyRow, waterRow, scopeTitle, scope1, scope2, hardwareTitle, reddit);
  } else {
    const telemetry = document.createElement('div');
    telemetry.className = 'ptx-scope';
    telemetry.textContent = copy.subtext;
    inner.append(energyRow, waterRow, scopeTitle, scope1, scope2, telemetry, hardwareTitle, reddit);
  }

  const citeLink = document.createElement('button');
  citeLink.className = 'ptx-info';
  citeLink.type = 'button';
  citeLink.textContent = 'Why these numbers? \u2022 Li et al., UC Riverside 2023-2025';
  inner.appendChild(citeLink);

  drawer.appendChild(inner);
  wrap.append(pill, drawer);
  body.appendChild(wrap);

  // Sanctioned E2E surface for instant-regret verification from outside
  // the closed shadow: how much roast text is visible on the COLLAPSED
  // pill, and which theme the stylesheet actually applied to it.
  const pillTextEl = pill.querySelector('.ptx-pill-text');
  const visibleText = (pillTextEl ?? pill).textContent ?? '';
  host.dataset['ptxPillChars'] = String(visibleText.trim().length);
  // Computed styles only resolve once the host is in the document, so
  // sample the applied theme on the next frame after attachment.
  requestAnimationFrame(() => {
    const borderColor = getComputedStyle(pill).borderColor;
    // Dark roast border is #F87171 (248,113,113); light roast is #EF4444
    // (239,68,68). Either means the high-contrast roast theme applied.
    const roast = borderColor.includes('248, 113, 113') || borderColor.includes('239, 68, 68');
    host.dataset['ptxPillTheme'] = roast ? 'red' : 'default';
  });

  let dismissEvents: AbortController | undefined;
  const setOpen = (open: boolean): void => {
    wrap.classList.toggle('ptx-open', open);
    pill.setAttribute('aria-expanded', String(open));
    host.dataset['ptxOpen'] = String(open);
    if (host.dataset['ptxPlatform'] === 'claude') {
      if (!open) {
        dismissEvents?.abort();
        if (drawer.matches(':popover-open')) drawer.hidePopover();
        delete host.dataset['ptxDrawerRect'];
        return;
      }
      const composer = document.querySelector<HTMLElement>('[contenteditable="true"]');
      const composerRect = (composer?.closest('form') ?? composer)?.getBoundingClientRect();
      const viewportBottom = window.visualViewport?.height ?? window.innerHeight;
      const bottom = Math.min(viewportBottom - 12, composerRect?.top ? composerRect.top - 16 : viewportBottom - 130);
      const anchor = pill.getBoundingClientRect();
      const width = Math.min(720, host.getBoundingClientRect().width, window.innerWidth - 24);
      drawer.setAttribute('popover', 'manual');
      drawer.style.width = `${width}px`;
      drawer.style.maxHeight = `${Math.max(80, bottom - 64)}px`;
      drawer.style.left = `${Math.max(12, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 12))}px`;
      drawer.showPopover();
      const height = drawer.getBoundingClientRect().height;
      const top = anchor.bottom + height + 8 <= bottom ? anchor.bottom + 8 : anchor.top - height - 8;
      drawer.style.top = `${Math.max(56, Math.min(top, bottom - height))}px`;
      const rect = drawer.getBoundingClientRect();
      host.dataset['ptxDrawerRect'] = [rect.x, rect.y, rect.width, rect.height].join(',');
      dismissEvents?.abort();
      dismissEvents = new AbortController();
      const { signal } = dismissEvents;
      document.addEventListener('pointerdown', dismissPopover, { signal });
      document.addEventListener('scroll', dismissPopover, { capture: true, signal });
      document.addEventListener('keydown', dismissPopover, { signal });
      window.addEventListener('resize', dismissPopover, { signal });
      return;
    }
    if (open) {
      requestAnimationFrame(() => {
        window.setTimeout(() => {
          const rect = drawer.getBoundingClientRect();
          if (rect.bottom > window.innerHeight - 130) {
            host.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 280);
      });
    }
  };

  const toggle = (event: Event): void => {
    // Interactions with controls inside the drawer must not toggle it shut.
    const path = event.composedPath();
    if (path.some((node) => node instanceof HTMLButtonElement)) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(!wrap.classList.contains('ptx-open'));
  };

  const dismissPopover = (event: Event): void => {
    if (event.type === 'keydown') {
      if ((event as KeyboardEvent).key === 'Escape') setOpen(false);
      return;
    }
    if (!event.composedPath().includes(host)) setOpen(false);
  };
  drawer.addEventListener('toggle', () => {
    if (!drawer.matches(':popover-open')) setOpen(false);
  });

  pill.addEventListener('click', toggle);
  // Clicks on the pill bubble out of the closed shadow root retargeted
  // to the host, which also lets automation dispatch a click straight on
  // the [data-prompt-tax] host to toggle the drawer.
  host.addEventListener('click', toggle);
  pill.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') toggle(event);
  });

  // Citation link lives inside the drawer: it must NOT bubble into the
  // pill's open/close handler, only request the modal.
  citeLink.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (drawer.matches(':popover-open')) setOpen(false);
    host.dispatchEvent(new CustomEvent(INFO_EVENT, { bubbles: true, composed: true }));
  });

  return host;
}
