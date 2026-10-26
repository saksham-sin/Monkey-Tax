/**
 * Platform adapter contract plus the shared streaming-completion engine.
 *
 * Completion rule (per spec): a response is final once its DOM has
 * stopped mutating for > 800ms and the platform's own streaming flag
 * (class / attribute) is cleared. Responses already present when the
 * observer attaches are treated as history and never badged.
 */

export type ResponseComplete = (
  userPrompt: string,
  outputElement: HTMLElement,
  responseText: string,
  isReasoning: boolean,
  wasStreaming: boolean,
) => void;

export interface LLMAdapter {
  readonly name: string;
  isTargetPage(): boolean;
  getLatestUserPrompt(): string | null;
  /** Returns a controller so SPA route changes can re-seed tracking. */
  observeResponses(onComplete: ResponseComplete): { reset(): void };
  injectBadge(targetNode: HTMLElement, badgeElement: HTMLElement): void;
  /**
   * All completed turns currently present in the DOM — used to compute the
   * lifetime thread total for existing conversation URLs.
   */
  getThreadTurns(): ThreadTurn[];
  /**
   * Optional: document-ordered user/assistant element pairs, used by the
   * popup's manual force-scan to place badges on untracked history.
   */
  getTurnPairs?(): TurnPair[];
}

/** Quiet window (ms) after the last DOM mutation before a response is final. */
export const STREAM_QUIET_MS = 800;
/** How often the stability scanner re-checks candidate containers. */
const SCAN_INTERVAL_MS = 400;
/** Hard cap so gigantic documents can never stall the innerText read. */
const MAX_TEXT_CHARS = 400_000;

/** What each platform must be able to answer about a response container. */
export interface ResponseProbe {
  /** All assistant-response containers currently in the DOM. */
  getContainers(): HTMLElement[];
  /** True while the platform reports this container still streaming. */
  isStreaming(container: HTMLElement): boolean;
  /** True when extended-thinking / reasoning UI is present in the turn. */
  isReasoning(container: HTMLElement): boolean;
  /** The user prompt that produced this specific turn, if locatable. */
  userPromptFor(container: HTMLElement): string | null;
}

/** One already-completed turn discovered in an existing chat thread. */
export interface ThreadTurn {
  id?: string;
  inputChars: number;
  outputChars: number;
  isReasoning: boolean;
}

/** A history pair with the live elements, so badges can be injected. */
export interface TurnPair extends ThreadTurn {
  userElement: HTMLElement | null;
  responseElement: HTMLElement;
}

const GENERIC_RESPONSE_SELECTOR =
  '[data-message-author-role="assistant"], .agent-turn, [data-is-streaming], .font-claude-message, model-response, message-content, .conversation-container .markdown, .conversation-container .prose';
const GENERIC_USER_SELECTOR =
  '[data-message-author-role="user"], [data-testid="user-message"], .font-user-message, [data-message-role="user"], user-query, .user-query-container';

/**
 * Platform-agnostic history scan across every selector the three
 * supported apps are known to use (plus generic .markdown/.prose
 * message bodies). Used by the popup's manual "Scan Active Chat Now"
 * whenever a strict adapter scan finds nothing.
 */
export function genericTurnPairs(): TurnPair[] {
  const responses = outermostMatches(
    Array.from(document.querySelectorAll<HTMLElement>(GENERIC_RESPONSE_SELECTOR)),
  ).filter((el) => !el.matches(GENERIC_USER_SELECTOR) && !el.querySelector(GENERIC_USER_SELECTOR));
  const users = Array.from(document.querySelectorAll<HTMLElement>(GENERIC_USER_SELECTOR));

  // Zip in document order: each assistant block pairs with the most
  // recent user block preceding it (each user consumed once).
  const out: TurnPair[] = [];
  let ui = 0;
  for (const responseElement of responses) {
    while (ui < users.length && !!(users[ui].compareDocumentPosition(responseElement) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      ui += 1;
    }
    const userElement = ui > 0 ? users[ui - 1] : null;
    const outputChars = cleanTextLength(responseElement);
    if (outputChars === 0 || !userElement || out.some((p) => p.userElement === userElement)) continue;
    out.push({
      userElement,
      responseElement,
      inputChars: cleanTextLength(userElement),
      outputChars,
      isReasoning: detectThinking(responseElement),
    });
  }
  return outermostPairs(out);
}

/** History-only ThreadTurn view of the generic scan. */
export function genericThreadTurns(): ThreadTurn[] {
  return genericTurnPairs().map(({ inputChars, outputChars, isReasoning }) => ({
    inputChars,
    outputChars,
    isReasoning,
  }));
}

/** Drop pairs whose response element nests inside an earlier pair's. */
function outermostPairs(pairs: TurnPair[]): TurnPair[] {
  return pairs.filter(
    (p) => !pairs.some((other) => other !== p && other.responseElement !== p.responseElement && other.responseElement.contains(p.responseElement)),
  );
}

/** Per-block character cap so gigantic threads can never stall a scan. */
const MAX_THREAD_BLOCK_CHARS = 100_000;

/**
 * Text length of a history block, excluding text inside any Prompt Tax
 * element that was injected into it (badges would inflate the count).
 */
export function cleanTextLength(el: HTMLElement): number {
  let total = (el.textContent ?? '').length;
  for (const injected of el.querySelectorAll('[data-prompt-tax]')) {
    total -= (injected.textContent ?? '').length;
  }
  return Math.min(Math.max(total, 0), MAX_THREAD_BLOCK_CHARS);
}

/** Generic extended-thinking sniff used by every adapter. */
export function detectThinking(container: HTMLElement): boolean {
  return (
    !!container.querySelector(
      '[data-testid*="thinking" i], [class*="thinking" i], thinking, thinking-block',
    ) || !!container.closest('[data-testid*="thinking" i]')
  );
}

/** Drops nested duplicates, keeping only the outmost matching elements. */
export function outermostMatches(list: HTMLElement[]): HTMLElement[] {
  return list.filter((el) => !list.some((other) => other !== el && other.contains(el)));
}

/** Default badge placement: append at the end of the response container. */
export function appendBadge(targetNode: HTMLElement, badgeElement: HTMLElement): void {
  targetNode.appendChild(badgeElement);
}

/**
 * Cleans raw prompt text extracted from host-page DOM: strips zero-width
 * characters and Gemini action-button labels ("copy", "edit", …) that
 * leak into the user-query element's text, which would otherwise push
 * trivial prompts past the classifier's length/pattern gates.
 */
const LEAKED_ACTION_LABELS = /\s+\b(copy|edit|regenerate|share|like|dislike|publish|saved|voice|prompt actions|more options)\b\s*$/i;
const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF\u2060\u00A0]/g;
const PUA_ICON_GLYPHS = /[\uE000-\uF8FF]/g;
const YOU_SAID_PREFIX = /^you\s+said\s+/i;

export function sanitizeText(raw: string): string {
  let text = raw.replace(PUA_ICON_GLYPHS, ' ').replace(INVISIBLE_CHARS, ' ');

  // Action labels can stack (e.g. "…copy edit") — peel repeatedly.
  let previous: string;
  do {
    previous = text;
    text = text.replace(LEAKED_ACTION_LABELS, '').trim();
  } while (text !== previous);

  // Gemini shape: "You said <prompt>" label block, then the expanded
  // prompt repeated below it. Collapse only when the halves provably
  // match — genuine multi-paragraph prompts stay untouched.
  const blocks = text
    .split(/\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length >= 2) {
    const norm = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();
    const head = blocks[0].replace(YOU_SAID_PREFIX, '').trim();
    const tail = blocks.slice(1).join('\n\n');
    if (norm(head) === norm(tail)) {
      text = tail;
    }
  } else if (blocks.length === 1 && YOU_SAID_PREFIX.test(blocks[0])) {
    // Collapsed variant: only the "You said …" label is rendered.
    text = blocks[0].replace(YOU_SAID_PREFIX, '').trim() || blocks[0];
  }

  return text;
}

/**
 * Generic observer engine shared by all adapters: tracks DOM mutations,
 * stamps the last-touch time per container, and fires onComplete once per
 * container after it has been quiet, non-streaming, and non-empty.
 */
export function createResponseObserver(
  probe: ResponseProbe,
  fallbackPrompt: () => string | null,
  onComplete: ResponseComplete,
): { reset(): void } {
  // Re-created on reset(): handles SPA sidebar navigation between
  // conversations without a page reload (history.pushState). After a
  // switch, every container currently on screen is fresh history.
  let seen = new WeakSet<HTMLElement>();
  let lastTouched = new WeakMap<HTMLElement, number>();
  let streamed = new WeakSet<HTMLElement>();

  const seedHistory = (): void => {
    for (const el of probe.getContainers()) {
      seen.add(el);
    }
  };
  seedHistory();

  const overlaps = (container: HTMLElement, node: Node): boolean => {
    const elem = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    if (!elem) return false;
    return container.contains(elem) || elem.contains(container);
  };

  const observer = new MutationObserver((records) => {
    const now = Date.now();
    const containers = probe.getContainers();
    for (const el of containers) {
      if (el === containers.at(-1) && probe.isStreaming(el)) streamed.add(el);
      if (seen.has(el) && !lastTouched.has(el)) continue;
      let touched = false;
      for (const record of records) {
        if (overlaps(el, record.target)) {
          touched = true;
          break;
        }
        for (const added of record.addedNodes) {
          if (overlaps(el, added)) {
            touched = true;
            break;
          }
        }
        if (touched) break;
      }
      if (touched || !lastTouched.has(el)) {
        lastTouched.set(el, now);
      }
    }
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });

  window.setInterval(() => {
    const now = Date.now();
    const containers = probe.getContainers();
    for (const el of containers) {
      if (seen.has(el)) continue;
      if (el === containers.at(-1) && probe.isStreaming(el)) streamed.add(el);
      if (!lastTouched.has(el)) {
        lastTouched.set(el, now); // newly discovered container
        continue;
      }
      if (probe.isStreaming(el)) continue;
      const text = (el.innerText ?? el.textContent ?? '').slice(0, MAX_TEXT_CHARS);
      if (!text.trim()) continue;
      if (now - (lastTouched.get(el) as number) < STREAM_QUIET_MS) continue;

      seen.add(el);
      const prompt = probe.userPromptFor(el) ?? fallbackPrompt() ?? '';
      onComplete(prompt, el, text, probe.isReasoning(el), streamed.has(el));
    }
  }, SCAN_INTERVAL_MS);

  return {
    /** Re-seed history after an SPA route change (conversation switch). */
    reset(): void {
      seen = new WeakSet<HTMLElement>();
      lastTouched = new WeakMap<HTMLElement, number>();
      streamed = new WeakSet<HTMLElement>();
      seedHistory();
    },
  };
}
