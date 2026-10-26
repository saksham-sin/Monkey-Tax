/**
 * Closed Shadow DOM injector. Every piece of extension UI is mounted on
 * a host element whose shadow root is CLOSED, guaranteeing zero CSS
 * leakage in either direction between host page and extension.
 *
 * Theming: every host carries data-ptx-theme (detected from the real
 * host page, not just the OS media query) and all component stylesheets
 * consume the CSS custom properties below, so pills, drawers, dock, and
 * modal flip together the moment the site changes theme.
 */
import { detectHostTheme, observeThemeChanges } from './theme-detector';

export interface IsolatedRoot {
  /** The element that gets appended to the host page. */
  host: HTMLElement;
  /** The internal container the component renders into. */
  body: HTMLElement;
  /** Appends a <style> block scoped strictly inside the shadow root. */
  addStyle(css: string): void;
}

/**
 * Adaptive design tokens, bound to the host-detected theme on the
 * :host element of every isolated root (see data-ptx-theme wiring).
 * Note: the `all: initial` inline reset on hosts never touches custom
 * properties, so these cascade into the closed shadow content.
 */
const THEME_VARS_CSS = `
  :host, :host([data-ptx-theme="dark"]) {
    --mtx-bg-canvas: #120E0D;
    --mtx-bg-pill: rgba(30, 21, 18, 0.88);
    --mtx-border-pill: rgba(193, 105, 79, 0.45);
    --mtx-surface-drawer: rgba(24, 17, 15, 0.96);
    --mtx-surface-card: rgba(223, 155, 132, 0.06);
    --mtx-border-subtle: rgba(223, 155, 132, 0.12);
    --mtx-text-primary: #FDF4F0;
    --mtx-text-secondary: #DF9B84;
    --mtx-text-muted: #A36B5C;
    --mtx-chip-bg: rgba(193, 105, 79, 0.22);
    --mtx-chip-border: rgba(193, 105, 79, 0.5);
    --mtx-chip-text: #F4A28C;
    --mtx-water-accent: #38BDF8;
    --mtx-water-bg: rgba(56, 189, 248, 0.18);
    --mtx-roast-bg: rgba(138, 28, 28, 0.75);
    --mtx-roast-border: #F87171;
    --mtx-roast-text: #FFF1F2;
    --mtx-roast-chip-bg: rgba(239, 68, 68, 0.4);
    --mtx-roast-chip-text: #FECACA;
    --mtx-meter-fill: #C1694F;
    --mtx-meter-empty: rgba(255, 255, 255, 0.12);
    --mtx-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  }
  :host([data-ptx-theme="light"]) {
    --mtx-bg-canvas: #FFF9F6;
    --mtx-bg-pill: rgba(255, 244, 238, 0.96);
    --mtx-border-pill: rgba(193, 105, 79, 0.6);
    --mtx-surface-drawer: #FFFBF9;
    --mtx-surface-card: #FDF1EB;
    --mtx-border-subtle: #EED7CE;
    --mtx-text-primary: #3E160E;
    --mtx-text-secondary: #7A3928;
    --mtx-text-muted: #A36B5C;
    --mtx-chip-bg: #FBE6DD;
    --mtx-chip-border: #C1694F;
    --mtx-chip-text: #963D25;
    --mtx-water-accent: #0284C7;
    --mtx-water-bg: #E0F2FE;
    --mtx-roast-bg: #FEF2F2;
    --mtx-roast-border: #EF4444;
    --mtx-roast-text: #7F1D1D;
    --mtx-roast-chip-bg: #FEE2E2;
    --mtx-roast-chip-text: #991B1B;
    --mtx-meter-fill: #C1694F;
    --mtx-meter-empty: #E5D5CE;
    --mtx-shadow: 0 6px 20px rgba(62, 22, 14, 0.08);
  }
  :host {
    --ptx-bg-canvas: var(--mtx-bg-canvas);
    --ptx-bg-pill: var(--mtx-bg-pill);
    --ptx-border-pill: var(--mtx-border-pill);
    --ptx-surface-drawer: var(--mtx-surface-drawer);
    --ptx-surface-card: var(--mtx-surface-card);
    --ptx-border-subtle: var(--mtx-border-subtle);
    --ptx-text-primary: var(--mtx-text-primary);
    --ptx-text-secondary: var(--mtx-text-secondary);
    --ptx-text-muted: var(--mtx-text-muted);
    --ptx-chip-bg: var(--mtx-chip-bg);
    --ptx-chip-border: var(--mtx-chip-border);
    --ptx-chip-text: var(--mtx-chip-text);
    --ptx-water-accent: var(--mtx-water-accent);
    --ptx-water-bg: var(--mtx-water-bg);
    --ptx-roast-bg: var(--mtx-roast-bg);
    --ptx-roast-border: var(--mtx-roast-border);
    --ptx-roast-text: var(--mtx-roast-text);
    --ptx-roast-chip-bg: var(--mtx-roast-chip-bg);
    --ptx-roast-chip-text: var(--mtx-roast-chip-text);
    --ptx-meter-fill: var(--mtx-meter-fill);
    --ptx-segment-empty: var(--mtx-meter-empty);
    --ptx-shadow: var(--mtx-shadow);
  }
`;

/**
 * Baseline layout every Prompt Tax surface shares: block-level, full
 * width, horizontally centered pill area. Components add their own CSS
 * afterwards, so a surface (e.g. the thread dock) can still override via
 * its own !important rules appended later in the same style slot.
 */
const BASE_HOST_CSS = `
  :host {
    display: flex !important;
    justify-content: center !important;
    width: 100% !important;
    margin: 12px 0 16px 0 !important;
  }
`;

/**
 * Shared icon-meter widget vocabulary (stat dashboards, mini bars and
 * primary action buttons) injected into every isolated root so badge
 * drawers and the thread dock render identical cards and buttons.
 */
const WIDGET_CSS = `
  .ptx-stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 10px 0;
  }
  .ptx-stat-card {
    background: var(--ptx-surface-card);
    border: 1px solid var(--ptx-border-subtle);
    border-radius: 8px;
    padding: 8px 10px;
  }
  .ptx-stat-value {
    font-size: 14px;
    font-weight: 700;
    color: var(--ptx-chip-text);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ptx-stat-label {
    font-size: 10px;
    color: var(--ptx-text-secondary);
    margin-top: 2px;
  }
  .ptx-stat-card:first-child .ptx-stat-value { color: var(--ptx-water-accent); }
  .ptx-btn-primary {
    background: linear-gradient(135deg, #C1694F 0%, #A8543C 100%);
    color: #FFF9F6;
    font-weight: 700;
    font-size: 11px;
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid #DF9B84;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .ptx-btn-primary:hover {
    background: linear-gradient(135deg, #CF765B 0%, #B85F46 100%);
  }
  .ptx-meter {
    display: inline-flex;
    gap: 2px;
    align-items: center;
  }
  .ptx-meter i {
    display: inline-block;
    width: 8px;
    height: 10px;
    border-radius: 2px;
    background: var(--ptx-segment-empty);
  }
  .ptx-meter i.on {
    background: var(--ptx-meter-fill);
  }
  .ptx-meter.water i.on {
    background: var(--ptx-water-accent);
  }
`;

/**
 * Roast pill override: warning-red styling so a roast visibly screams
 * "you did something silly" from across the room. Injected after each
 * component's own CSS via addStyle ordering is per-root, so these rules
 * ride in the shared style slot ahead of component styles and use
 * !important where they must win.
 */
const ROAST_PILL_CSS = `
  .ptx-pill.ptx-roast {
    background: var(--ptx-roast-bg) !important;
    border: 1px solid var(--ptx-roast-border) !important;
    color: var(--ptx-roast-text) !important;
    max-width: 720px !important;
    padding: 8px 16px !important;
  }
  .ptx-roast .ptx-pill-text {
    font-weight: 500;
    font-size: 12px;
    color: var(--ptx-roast-text);
  }
  .ptx-roast .ptx-pill-text b,
  .ptx-roast .ptx-fullline,
  .ptx-roast .ptx-fullline b { color: var(--ptx-roast-text); }
  .ptx-roast .ptx-metric-chip {
    background: var(--ptx-roast-chip-bg) !important;
    color: var(--ptx-roast-chip-text) !important;
    border: 1px solid var(--ptx-roast-border) !important;
  }
`;

/** Hosts currently mounted that need live theme attribute updates. */
const themedHosts = new Set<HTMLElement>();
let themeWatcherWired = false;

function applyThemeToHosts(): void {
  const theme = detectHostTheme();
  for (const host of themedHosts) {
    if (!host.isConnected) {
      themedHosts.delete(host); // dropped from the page: stop tracking
      continue;
    }
    host.setAttribute('data-ptx-theme', theme);
  }
}

function wireTheme(host: HTMLElement): void {
  host.setAttribute('data-ptx-theme', detectHostTheme());
  themedHosts.add(host);
  if (!themeWatcherWired && document.body) {
    themeWatcherWired = true;
    observeThemeChanges(() => applyThemeToHosts());
  }
}

export function createIsolatedRoot(hostTagName = 'div', cssClass = 'ptx-host'): IsolatedRoot {
  const host = document.createElement(hostTagName) as HTMLElement;
  host.classList.add(cssClass);
  host.setAttribute('data-prompt-tax', 'true');
  // Neutralise host-page cascade inheritance as far as possible.
  Object.assign(host.style, {
    all: 'initial',
    display: 'flex',
    position: 'relative',
    zIndex: '2147483000',
  } as CSSStyleDeclaration);

  const shadow = host.attachShadow({ mode: 'closed' });

  const styleSlot = document.createElement('style');
  styleSlot.textContent = THEME_VARS_CSS + BASE_HOST_CSS + WIDGET_CSS + ROAST_PILL_CSS;
  shadow.appendChild(styleSlot);

  const body = document.createElement('div');
  shadow.appendChild(body);

  wireTheme(host);

  return {
    host,
    body,
    addStyle(css: string): void {
      styleSlot.textContent += `\n${css}`;
    },
  };
}
