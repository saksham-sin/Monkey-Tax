/**
 * Scientific Citation Modal — Scope 1 / Scope 2 breakdown plus full
 * research citations and methodology notes. Rendered in its own closed
 * shadow root overlay; dismiss via close button, backdrop, or Escape.
 */
import { CITATIONS, EQUIVALENCIES, SCOPE_NOTES } from '../engine/research-data';
import { createIsolatedRoot } from './shadow-root';
import {
  BASE_ENERGY_WH,
  BASE_WATER_ML,
  CHARS_PER_TOKEN,
  PER_1K_INPUT_TOKENS_WH,
  PER_1K_OUTPUT_TOKENS_WH,
  PER_1K_OUTPUT_TOKENS_WATER_ML,
  REASONING_MULTIPLIER,
  SCOPE2_WML_PER_WH,
} from '../engine/calculator';

const STYLES = `
  .ptx-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    background: rgba(18, 14, 13, 0.62);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    font: 13px/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .ptx-panel {
    width: min(560px, calc(100vw - 32px));
    max-height: min(80vh, 640px);
    overflow: auto;
    background: var(--ptx-surface-drawer);
    color: var(--ptx-text-primary);
    border: 1px solid var(--ptx-border-subtle);
    border-radius: 14px;
    padding: 20px 22px;
    box-shadow: var(--ptx-shadow);
  }
  .ptx-title { font-size: 16px; font-weight: 700; margin: 0 0 4px; }
  .ptx-tag { color: var(--ptx-text-secondary); font-size: 11px; margin: 0 0 14px; }
  .ptx-close {
    float: right;
    border: 1px solid var(--ptx-border-subtle);
    background: transparent;
    color: var(--ptx-text-secondary);
    border-radius: 8px;
    padding: 2px 9px;
    cursor: pointer;
    font: 600 13px sans-serif;
  }
  .ptx-close:hover { color: var(--ptx-text-primary); border-color: var(--ptx-chip-text); }
  .ptx-scope { border-left: 3px solid var(--ptx-meter-fill); padding: 2px 0 2px 12px; margin: 0 0 12px; }
  .ptx-scope h3 { margin: 0 0 2px; font-size: 13px; color: var(--ptx-chip-text); }
  .ptx-scope p { margin: 0; color: var(--ptx-text-primary); }
  .ptx-section { margin-top: 16px; }
  .ptx-section h3 { font-size: 13px; margin: 0 0 8px; color: var(--ptx-text-primary); }
  .ptx-cite { margin: 0 0 8px; color: var(--ptx-text-primary); }
  .ptx-cite em { color: var(--ptx-text-primary); }
  .ptx-cite span { display: block; color: var(--ptx-text-secondary); font-size: 11px; }
  .ptx-method { color: var(--ptx-text-secondary); font-size: 11px; margin-top: 14px; border-top: 1px solid var(--ptx-border-subtle); padding-top: 10px; }
  .ptx-method code { color: var(--ptx-text-primary); }
  .ptx-scale-explainer {
    background: var(--ptx-surface-card);
    border: 1px solid var(--ptx-chip-border);
    border-radius: 8px;
    padding: 12px 14px;
    margin-top: 14px;
  }
  .ptx-scale-explainer h4 {
    margin: 0 0 6px 0;
    font-size: 13px;
    color: var(--ptx-chip-text);
  }
  .ptx-scale-explainer p, .ptx-scale-explainer li {
    font-size: 11px;
    line-height: 1.5;
    color: var(--ptx-text-secondary);
  }
  .ptx-scale-explainer ul { margin: 6px 0 0 0; padding-left: 18px; }
  .ptx-scale-explainer li { margin: 0 0 5px; }
  .ptx-macro-explainer {
    background: var(--ptx-water-bg);
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-radius: 8px;
    padding: 12px 14px;
    margin-top: 12px;
  }
  .ptx-macro-explainer h4 {
    margin: 0 0 6px;
    font-size: 13px;
    color: var(--ptx-water-accent);
  }
  .ptx-macro-explainer p {
    font-size: 11px;
    line-height: 1.5;
    color: var(--ptx-text-secondary);
    margin: 0 0 6px;
  }
  .ptx-macro-explainer .ptx-macro-note { margin-bottom: 0; }
`;

let openOverlay: HTMLElement | null = null;

export function openCitationModal(): void {
  if (openOverlay) return;

  const { host, body, addStyle } = createIsolatedRoot('div', 'ptx-modal-host');
  host.dataset['ptxMacroPerspective'] = 'true';
  addStyle(STYLES);

  const overlay = document.createElement('div');
  overlay.className = 'ptx-overlay';

  const panel = document.createElement('div');
  panel.className = 'ptx-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'MonkeyTax | how these numbers are calculated');

  const close = document.createElement('button');
  close.className = 'ptx-close';
  close.type = 'button';
  close.textContent = '\u00D7';
  close.setAttribute('aria-label', 'Close');

  const title = document.createElement('h2');
  title.className = 'ptx-title';
  title.textContent = 'MonkeyTax: Where these numbers come from';

  const tag = document.createElement('p');
  tag.className = 'ptx-tag';
  tag.textContent =
    'All figures are deterministic, on-device estimates grounded in peer-reviewed research. No models, no network calls.';

  panel.appendChild(close);
  panel.appendChild(title);
  panel.appendChild(tag);

  for (const scope of SCOPE_NOTES) {
    const block = document.createElement('div');
    block.className = 'ptx-scope';
    const heading = document.createElement('h3');
    heading.textContent = scope.label;
    const para = document.createElement('p');
    para.textContent = scope.body;
    block.append(heading, para);
    panel.appendChild(block);
  }

  const citeSection = document.createElement('div');
  citeSection.className = 'ptx-section';
  const citeTitle = document.createElement('h3');
  citeTitle.textContent = 'Full citations';
  citeSection.appendChild(citeTitle);
  for (const citation of Object.values(CITATIONS)) {
    const line = document.createElement('p');
    line.className = 'ptx-cite';
    const em = document.createElement('em');
    em.textContent = `"${citation.title}"`;
    const meta = document.createElement('span');
    meta.textContent = `${citation.venue} \u00B7 ${citation.year}`;
    line.append(em, meta);
    citeSection.appendChild(line);
  }
  panel.appendChild(citeSection);

  const method = document.createElement('div');
  method.className = 'ptx-method';
  method.innerHTML =
    `<strong>Methodology.</strong> Token estimation: 1 token \u2248 ${CHARS_PER_TOKEN} characters. ` +
    `Energy: ${BASE_ENERGY_WH}Wh base + ${PER_1K_INPUT_TOKENS_WH}Wh per 1k input tokens + ` +
    `${PER_1K_OUTPUT_TOKENS_WH}Wh per 1k output tokens (~5\u00D7 prefill-to-decode ratio: answering token-by-token is far slower than reading the prompt); ` +
    `extended reasoning \u00D7${REASONING_MULTIPLIER}. ` +
    `Water Scope 1: ${BASE_WATER_ML}ml base + ${PER_1K_OUTPUT_TOKENS_WATER_ML}ml per 1k output tokens. ` +
    `Scope 2: ${SCOPE2_WML_PER_WH}ml per Wh of off-site thermoelectric generation. ` +
    `A Google search \u2248 ${EQUIVALENCIES.GOOGLE_SEARCH_WH}Wh; a phone charge \u2248 ${EQUIVALENCIES.PHONE_CHARGE_WH}Wh; an espresso shot of water \u2248 ${EQUIVALENCIES.ESPRESSO_SHOT_ML}ml.`;
  panel.appendChild(method);

  // "Plastic Straw Dilemma" — why per-prompt figures look small and why
  // that is exactly the point at accumulation scale.
  const scale = document.createElement('div');
  scale.className = 'ptx-scale-explainer';
  scale.innerHTML =
    '<h4>\uD83D\uDCA1 The Single Plastic Straw Effect</h4>' +
    '<p>MonkeyTax isn\u2019t here to judge genuine coding, writing, or deep research. Its sole mission: ' +
    'stop users from treating multi-billion dollar supercomputers like a monkey on a typewriter for basic math, empty pleasantries, and lazy retries.</p>' +
    '<ul>' +
    '<li><b>Daily Accumulation:</b> A normal 50-prompt coding or writing session ' +
    'evaporates <b>~750ml to 1 liter of fresh cooling water</b> and pulls enough ' +
    'electricity to recharge a smartphone 8 to 10 times over.</li>' +
    '<li><b>The Zero-Entropy Target:</b> MonkeyTax doesn\u2019t judge legitimate deep ' +
    'work. It targets mechanical waste, like running an 80GB GPU cluster just to say ' +
    '<i>"Thanks"</i>, or calculating arithmetic your OS calculator solves in 0 Joules.</li>' +
    '<li><b>Fleet Scale:</b> When multiplied across hundreds of millions of daily ' +
    'queries globally, those "two sips" become millions of gallons of potable water ' +
    'evaporated daily from regional watersheds.</li>' +
    '</ul>';
  panel.appendChild(scale);

  const macro = document.createElement('div');
  macro.className = 'ptx-macro-explainer';
  macro.innerHTML =
    '<h4>\uD83C\uDF10 The Global Macro Perspective</h4>' +
    '<p>An individual prompt draws modest power. There is no audited global counter covering every AI provider and query type. ' +
    'At a hypothetical scale of <b>1 billion queries per day</b>, even modest per-query estimates would accumulate substantially; ' +
    'this is an illustrative scenario, not a measured daily total.</p>' +
    '<p class="ptx-macro-note">MonkeyTax is designed to preserve compute for synthesis, code architecture, and complex inquiry, ' +
    'while encouraging native OS tools and standard search for everyday queries.</p>';
  panel.appendChild(macro);

  overlay.appendChild(panel);
  body.appendChild(overlay);

  const dismiss = (): void => {
    host.remove();
    document.removeEventListener('keydown', onKey);
    openOverlay = null;
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') dismiss();
  };

  close.addEventListener('click', dismiss);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) dismiss();
  });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(host);
  openOverlay = host;
}
