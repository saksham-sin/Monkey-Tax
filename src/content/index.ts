/**
 * Content script entry point & URL dispatcher.
 *
 * Picks the adapter for the current host, watches for completed AI
 * responses, then runs the fully local pipeline:
 *   classify -> calculate -> generate copy -> inject Shadow DOM pill
 * and reports aggregate deltas to the service worker.
 *
 * Chat apps are SPAs: switching conversations in the sidebar is a
 * history.pushState without a reload, so the URL is polled every 800ms
 * and observer tracking + the thread dock rebuild after the new thread
 * DOM hydrates. The popup can also demand a full rescan immediately
 * via a PTX_FORCE_SCAN message.
 */
import { GeminiAdapter } from './adapters/gemini.adapter';
import { ChatGPTAdapter } from './adapters/chatgpt.adapter';
import { ClaudeAdapter } from './adapters/claude.adapter';
import { genericTurnPairs, sanitizeText } from './adapters/base.adapter';
import type { LLMAdapter, TurnPair } from './adapters/base.adapter';
import { calculateFootprint } from './engine/calculator';
import { classifyPrompt } from './engine/classifier';
import { generateCopy } from './engine/generator';
import { createPillElement, INFO_EVENT } from './ui/pill-component';
import { openCitationModal } from './ui/modal-component';
import { createThreadSummary } from './ui/thread-summary';

const ADAPTERS: LLMAdapter[] = [new GeminiAdapter(), new ChatGPTAdapter(), new ClaudeAdapter()];

function main(): void {
  const adapter = ADAPTERS.find((candidate) => candidate.isTargetPage());
  if (!adapter) return;

  // The popup's chrome.scripting fallback can inject onto a tab where
  // the manifest content script already ran: one pipeline per page.
  const w = window as Window & { __promptTaxLoaded?: boolean };
  if (w.__promptTaxLoaded) return;
  w.__promptTaxLoaded = true;

  document.addEventListener(INFO_EVENT, () => openCitationModal());

  // Strict adapter pairs first; the generic cross-platform scanner only
  // when the strict one sees nothing (live markup drift).
  const adapterPairs = (): TurnPair[] => {
    const strict = adapter.getTurnPairs ? adapter.getTurnPairs() : [];
    return strict.length > 0 ? strict : genericTurnPairs();
  };

  // Lifetime thread damage: aggregate any history already in the DOM
  // (existing conversation URLs), then fold in turns completed live.
  const responseIds = new WeakMap<HTMLElement, string>();
  let nextResponseId = 0;
  const responseId = (element: HTMLElement): string => {
    const stable = element.dataset['turnKey'] ??
      element.dataset['chatgptSearchMessageIds'] ??
      element.dataset['chatgptSearchUnitKey'];
    if (stable) return stable;
    let id = responseIds.get(element);
    if (!id) {
      id = `response-${++nextResponseId}`;
      responseIds.set(element, id);
    }
    return id;
  };
  const thread = createThreadSummary(() =>
    adapterPairs().map(({ responseElement, inputChars, outputChars, isReasoning }) => ({
      id: responseId(responseElement),
      inputChars,
      outputChars,
      isReasoning,
    })),
  );
  const refreshDock = (): void => { forceScan(); };
  // Mount as soon as >= 1 assistant turn exists: a retry ladder covers
  // the very different hydration timings of the three apps.
  [300, 800, 1500, 3000, 6000].forEach((delay) => window.setTimeout(refreshDock, delay));

  const observer = adapter.observeResponses((userPrompt, outputElement, responseText, isReasoning, wasStreaming) => {
    const sanitizedPrompt = sanitizeText(userPrompt);
    const tier = classifyPrompt(sanitizedPrompt);
    const metrics = calculateFootprint(sanitizedPrompt.length, responseText.length, isReasoning);
    const copy = generateCopy(tier, metrics);

    console.log(
      '[MonkeyTax] Raw prompt:',
      JSON.stringify(sanitizedPrompt),
      '| Tier:',
      tier,
      '| isRoast:',
      copy.isRoast,
      '| reasoning:',
      isReasoning,
    );

    if (!outputElement.querySelector('[data-prompt-tax="true"]')) {
      adapter.injectBadge(outputElement, createPillElement(copy, tier));
    }
    // Recompute the thread dock from the DOM after a beat, so the just-
    // finished turn (and its streaming flags settling) are reflected.
    window.setTimeout(refreshDock, 150);
    if (!wasStreaming) return;

    void chrome.runtime
      .sendMessage({
        type: 'prompt-tax:record',
        payload: {
          waterMl: metrics.waterMl,
          energyWh: metrics.energyWh,
          tier,
          isRoast: copy.isRoast,
          platform: adapter.name,
        },
      })
      .catch(() => {
        /* Service worker asleep or extension reloaded — aggregation is best-effort. */
      });
  });

  // --- SPA sidebar navigation (all three platforms) ------------------------
  // React Router swaps threads via history.pushState without a reload:
  // re-seed turn tracking (everything on screen in the new thread is
  // fresh history) and re-scan the dock after the SPA hydrates.
  let href = location.href;
  window.setInterval(() => {
    if (location.href === href) return;
    href = location.href;
    window.setTimeout(() => {
      observer.reset();
      refreshDock();
    }, 800);
  }, 800);

  // --- Manual "Scan Active Chat Now" from the toolbar popup --------------
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse): boolean | void => {
    if ((message as { type?: string } | undefined)?.type !== 'PTX_FORCE_SCAN') return undefined;
    const result = forceScan();
    void chrome.runtime.sendMessage({
      type: 'PTX_RECORD_THREAD_SCAN',
      payload: {
        platform: adapter.name,
        threadId: getThreadIdFromUrl(adapter.name),
        turns: result.turns,
        waterMl: result.waterMl,
        energyWh: result.energyWh,
        fillerCount: result.fillerCount,
      },
    }).then((recordResult: { ok?: boolean; duplicate?: boolean }) => {
      sendResponse({ ...result, ok: recordResult?.ok === true, duplicate: recordResult?.duplicate === true });
    }).catch(() => {
      sendResponse({ ...result, ok: false, duplicate: false });
    });
    return true;
  });

  function forceScan(): { turns: number; waterMl: number; energyWh: number; fillerCount: number } {
    const platform = adapter as LLMAdapter;
    const pairs = adapterPairs();

    let waterMl = 0;
    let energyWh = 0;
    let turns = 0;
    let fillerCount = 0;
    for (const pair of pairs) {
      const metrics = calculateFootprint(pair.inputChars, pair.outputChars, pair.isReasoning);
      waterMl += metrics.waterMl;
      energyWh += metrics.energyWh;
      turns += 1;
      const promptText = sanitizeText(pair.userElement?.innerText ?? '');
      const tier = classifyPrompt(promptText);
      if (tier === 'POLITE' || tier === 'GREETING' || tier === 'LAZY_RETRY') fillerCount += 1;

      // Badge history turns the live observer never saw (page opened
      // mid-thread, route switches, pre-observer markup), deriving the
      // tier from the paired user prompt.
      const streamingSelector = '[data-is-streaming="true"], .result-streaming, .cursor-blinking';
      const streaming = pair.responseElement.matches(streamingSelector) ||
        !!pair.responseElement.querySelector(streamingSelector) ||
        !!document.querySelector('button[data-testid="stop-button"]');
      if (!streaming && !pair.responseElement.querySelector('[data-prompt-tax="true"]')) {
        const copy = generateCopy(tier, metrics);
        platform.injectBadge(pair.responseElement, createPillElement(copy, tier));
      }
    }
    thread.refresh();
    return {
      turns,
      waterMl: Math.round(waterMl * 100) / 100,
      energyWh: Math.round(energyWh * 100) / 100,
      fillerCount,
    };
  }
}

function getThreadIdFromUrl(platform: string): string {
  const segments = location.pathname.split('/').filter(Boolean);
  const routeSegments: Record<string, string> = { chatgpt: 'c', claude: 'chat', gemini: 'app' };
  const routeSegment = routeSegments[platform] ?? 'app';
  const routeIndex = segments.lastIndexOf(routeSegment);
  return routeIndex >= 0 ? segments[routeIndex + 1] ?? segments[routeIndex] : location.pathname;
}

main();
