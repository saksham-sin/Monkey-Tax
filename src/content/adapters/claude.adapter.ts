/**
 * Claude (claude.ai) DOM adapter.
 *
 * Turn containers: assistant message row blocks carrying
 * [data-is-streaming]; completion is data-is-streaming="false" plus the
 * shared 800ms quiet window.
 */
import {
  appendBadge,
  cleanTextLength,
  createResponseObserver,
  detectThinking,
  outermostMatches,
  sanitizeText,
} from './base.adapter';
import type { LLMAdapter, ResponseComplete, ResponseProbe, ThreadTurn, TurnPair } from './base.adapter';

function queryAll(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(selector));
}

const USER_SELECTOR =
  '[data-testid="user-message"], .font-user-message, [data-message-role="user"]';

/** All Claude user blocks, deduped, in document order. */
function userBlocks(): HTMLElement[] {
  return outermostMatches(queryAll(USER_SELECTOR));
}

/** The closest user block preceding `el`, walking the tree backwards. */
function precedingUser(el: HTMLElement): HTMLElement | null {
  let cursor: HTMLElement | null = el;
  while (cursor) {
    const prior = cursor.previousElementSibling as HTMLElement | null;
    let sibling = prior;
    while (sibling) {
      if (sibling.matches(USER_SELECTOR)) return sibling;
      const nested = sibling.querySelector<HTMLElement>(USER_SELECTOR);
      const nestedAll = nested ? Array.from(sibling.querySelectorAll<HTMLElement>(USER_SELECTOR)) : [];
      if (nestedAll.length > 0) return nestedAll[nestedAll.length - 1] as HTMLElement;
      sibling = sibling.previousElementSibling as HTMLElement | null;
    }
    cursor = cursor.parentElement;
  }
  return null;
}

export class ClaudeAdapter implements LLMAdapter {
  readonly name = 'claude';

  isTargetPage(): boolean {
    return location.hostname === 'claude.ai' || location.hostname.endsWith('.claude.ai');
  }

  /** Keeps only assistant-side streaming rows, not nested duplicates. */
  private responseRows(): HTMLElement[] {
    const rows = outermostMatches(queryAll('[data-is-streaming]')).filter(
      (row) => !row.matches(USER_SELECTOR) && !row.querySelector(USER_SELECTOR),
    );
    return rows;
  }

  private probe(): ResponseProbe {
    return {
      getContainers: () => this.responseRows(),
      isStreaming(el: HTMLElement): boolean {
        return el.getAttribute('data-is-streaming') !== 'false';
      },
      isReasoning(el: HTMLElement): boolean {
        return (
          detectThinking(el) ||
          !!el.querySelector('[data-testid*="thinking" i], thinking-block, [data-is-delimited-off-stream="true"]')
        );
      },
      userPromptFor(el: HTMLElement): string | null {
        const users = userBlocks();
        const user = precedingUser(el) ?? (users.length > 0 ? users[users.length - 1] : null);
        const raw = user?.innerText ?? '';
        const sanitized = sanitizeText(raw);
        return sanitized ? sanitized : null;
      },
    };
  }

  getLatestUserPrompt(): string | null {
    const users = userBlocks();
    const text = users.length > 0 ? (users[users.length - 1] as HTMLElement).innerText?.trim() : null;
    return text ? text : null;
  }

  getThreadTurns(): ThreadTurn[] {
    return this.getTurnPairs().map(({ inputChars, outputChars, isReasoning }) => ({
      inputChars,
      outputChars,
      isReasoning,
    }));
  }

  /**
   * Pair each assistant response row with the nearest preceding user
   * block (walk-based, resilient to Claude re-wrapping rows in extra
   * divs), consuming each user block at most once.
   */
  getTurnPairs(): TurnPair[] {
    const rows = this.responseRows();
    const users = userBlocks();
    const out: TurnPair[] = [];
    let ui = 0;
    for (const responseElement of rows) {
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
    return out;
  }

  observeResponses(onComplete: ResponseComplete): { reset(): void } {
    return createResponseObserver(this.probe(), () => this.getLatestUserPrompt(), onComplete);
  }

  injectBadge(targetNode: HTMLElement, badgeElement: HTMLElement): void {
    badgeElement.dataset['ptxPlatform'] = 'claude';
    const actions = targetNode.querySelector('[data-testid="message-actions"]');
    if (actions) actions.before(badgeElement);
    else appendBadge(targetNode, badgeElement);
  }
}
