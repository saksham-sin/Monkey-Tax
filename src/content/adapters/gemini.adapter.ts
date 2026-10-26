/**
 * Gemini (gemini.google.com) DOM adapter.
 *
 * Turn containers: <model-response> (fallback: <message-content>).
 * Streaming: class-based markers / a visible stop-generating control.
 * User input: matching <user-query> / .user-query-container within the
 * enclosing .conversation-container turn.
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

export class GeminiAdapter implements LLMAdapter {
  readonly name = 'gemini';

  isTargetPage(): boolean {
    return location.hostname === 'gemini.google.com' || location.hostname.endsWith('.gemini.google.com');
  }

  private probe(): ResponseProbe {
    const latestUser = (): HTMLElement | null => this.latestUserQuery();
    const getContainers = (): HTMLElement[] => {
      let containers = queryAll('model-response');
      if (containers.length === 0) {
        containers = queryAll('message-content, .conversation-container');
      }
      return outermostMatches(containers);
    };

    return {
      getContainers,
      isStreaming(el: HTMLElement): boolean {
        // Per-response streaming markers, or a global "stop generating" UI.
        if (el.querySelector('[class*="streaming" i], [data-test-id="response-streaming"], .blue-iteration-cursor, [class*="cursor" i][class*="blink" i]')) {
          return true;
        }
        return !!document.querySelector(
          'stop-generating-button, [class*="stop-generating" i], button[aria-label*="Stop response" i]',
        );
      },
      isReasoning(el: HTMLElement): boolean {
        return (
          detectThinking(el) ||
          !!el.closest('.conversation-container')?.querySelector('[data-test-id*="thinking" i], thinking-chip, .thoughts-container, [class*="thinking" i]')
        );
      },
      userPromptFor(el: HTMLElement): string | null {
        const turn = el.closest('.conversation-container');
        const query = (turn?.querySelector('user-query, .user-query-container') as HTMLElement | null) ??
          latestUser();
        const raw = query?.innerText ?? '';
        const sanitized = sanitizeText(raw);
        console.log(
          '[MonkeyTax] Raw user prompt element text:',
          JSON.stringify(raw),
          '=> sanitized:',
          JSON.stringify(sanitized),
        );
        return sanitized ? sanitized : null;
      },
    };
  }

  private latestUserQuery(): HTMLElement | null {
    const all = queryAll('user-query, .user-query-container');
    return all.length > 0 ? all[all.length - 1] : null;
  }

  getLatestUserPrompt(): string | null {
    const query = this.latestUserQuery();
    const text = query ? sanitizeText(query.innerText ?? '') : '';
    return text ? text : null;
  }

  getThreadTurns(): ThreadTurn[] {
    return this.getTurnPairs().map(({ inputChars, outputChars, isReasoning }) => ({
      inputChars,
      outputChars,
      isReasoning,
    }));
  }

  /** Turn containers already pair user + response natively. */
  getTurnPairs(): TurnPair[] {
    const out: TurnPair[] = [];
    for (const turn of queryAll('conversation-container, .conversation-container')) {
      const userElement = turn.querySelector<HTMLElement>('user-query, .user-query-container');
      const responseElement = turn.querySelector<HTMLElement>('model-response, message-content');
      if (!userElement || !responseElement) continue;
      const outputChars = cleanTextLength(responseElement);
      if (outputChars === 0) continue;
      out.push({
        userElement,
        responseElement,
        inputChars: cleanTextLength(userElement),
        outputChars,
        isReasoning: detectThinking(turn),
      });
    }
    return out;
  }

  observeResponses(onComplete: ResponseComplete): { reset(): void } {
    return createResponseObserver(this.probe(), () => this.getLatestUserPrompt(), onComplete);
  }

  injectBadge(targetNode: HTMLElement, badgeElement: HTMLElement): void {
    // Prefer anchoring inside the rendered message body when present.
    const body = targetNode.querySelector<HTMLElement>('message-content') ?? targetNode;
    appendBadge(body, badgeElement);
  }
}
