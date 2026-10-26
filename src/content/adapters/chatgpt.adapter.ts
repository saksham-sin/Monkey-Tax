/**
 * ChatGPT (chatgpt.com) DOM adapter.
 *
 * Turn containers: [data-message-author-role="assistant"], production
 * article wrappers (article[data-testid^="conversation-turn"]), or the
 * legacy .agent-turn class. Streaming: .result-streaming removed AND no
 * stop button. User prompt: the nearest preceding user article, paired
 * in document order (conversation DOM re-renders under React Router).
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

const USER_SELECTOR = '[data-message-author-role="user"], [data-chatgpt-search-unit-key$=":user"]';
const ASSISTANT_SELECTOR =
  '[data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"], article[data-testid^="conversation-turn-"] [data-message-author-role="assistant"], .agent-turn';

/** Text of a ChatGPT message block, preferring the rendered markdown body. */
function messageText(el: HTMLElement): string {
  const body = el.querySelector<HTMLElement>('.markdown, .prose, [data-testid*="message-content"]') ?? el;
  return (body.innerText ?? body.textContent ?? '').trim();
}

/** The user block that precedes `el` in document order, if any. */
function precedingUser(el: HTMLElement): HTMLElement | null {
  const users = queryAll(USER_SELECTOR);
  let best: HTMLElement | null = null;
  for (const user of users) {
    if (user === el || user.contains(el)) continue;
    if (user.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
      best = user; // still before el: keep walking to the closest one
    } else {
      break;
    }
  }
  return best;
}

/** Zip assistant blocks with their preceding user blocks, once each. */
function pairTurns(): TurnPair[] {
  const assistants = outermostMatches(queryAll(ASSISTANT_SELECTOR));
  const users = queryAll(USER_SELECTOR);
  const out: TurnPair[] = [];
  let ui = 0;
  for (const responseElement of assistants) {
    while (ui < users.length && !!(users[ui].compareDocumentPosition(responseElement) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      ui += 1; // this user (and everything before it) precedes the assistant
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

export class ChatGPTAdapter implements LLMAdapter {
  readonly name = 'chatgpt';

  isTargetPage(): boolean {
    return location.hostname === 'chatgpt.com' || location.hostname.endsWith('.chatgpt.com');
  }

  private probe(): ResponseProbe {
    return {
      getContainers: () => outermostMatches(queryAll(ASSISTANT_SELECTOR)),
      isStreaming(el: HTMLElement): boolean {
        const row = el.closest('article[data-testid^="conversation-turn"]') ?? el;
        const streaming =
          row.classList.contains('result-streaming') ||
          !!row.querySelector('.result-streaming, [class*="result-streaming" i], .cursor-blinking, [class*="cursor" i][class*="blink" i]');
        if (streaming) return true;
        // Global stop control means generation is still running.
        return !!document.querySelector('button[data-testid="stop-button"]');
      },
      isReasoning(el: HTMLElement): boolean {
        return (
          detectThinking(el) ||
          !!el.querySelector('[data-testid="attachment-chip-hypertext"]') ||
          !!el.closest('[data-testid*="thinking" i]')
        );
      },
      userPromptFor(el: HTMLElement): string | null {
        const user = precedingUser(el) ?? queryAll(USER_SELECTOR).slice(-1)[0] ?? null;
        const raw = user ? messageText(user) : '';
        const sanitized = sanitizeText(raw);
        return sanitized ? sanitized : null;
      },
    };
  }

  getLatestUserPrompt(): string | null {
    const users = queryAll(USER_SELECTOR);
    const text = users.length > 0 ? messageText(users[users.length - 1] as HTMLElement) : '';
    return text ? text : null;
  }

  getThreadTurns(): ThreadTurn[] {
    return pairTurns().map(({ inputChars, outputChars, isReasoning }) => ({
      inputChars,
      outputChars,
      isReasoning,
    }));
  }

  /** Document-ordered user/assistant pairs for the force-scan pass. */
  getTurnPairs(): TurnPair[] {
    return pairTurns();
  }

  /** Prefer extracting just the rendered prose for the live turn. */
  responseTextFor(el: HTMLElement): string {
    return messageText(el);
  }

  observeResponses(onComplete: ResponseComplete): { reset(): void } {
    return createResponseObserver(this.probe(), () => this.getLatestUserPrompt(), onComplete);
  }

  injectBadge(targetNode: HTMLElement, badgeElement: HTMLElement): void {
    const body = targetNode.querySelector<HTMLElement>('.markdown, .prose') ?? targetNode;
    appendBadge(body, badgeElement);
  }
}
