# Specification: MonkeyTax (Chrome Extension - Manifest V3)

## 1. Project Overview & Philosophy
"MonkeyTax" (formerly Prompt Tax) is a client-side, zero-backend Manifest V3 browser extension for Chrome. It intercepts conversational AI web interfaces (Gemini, ChatGPT, Claude) to calculate and display the environmental footprint (water consumption for cooling and electrical energy draw) of individual queries.

### Guiding Principles
* **Zero Additional Carbon/Compute:** The extension MUST NOT invoke any external or local neural network models. Calculations and copy generation are strictly local, deterministic, and execute in under 1ms.
* **Asymmetric Engagement:**
  * **Informative Tier (Default ~90%):** Complex queries, programming, reasoning, and long texts receive a sleek, scientific, non-judgmental telemetry readout.
  * **Witty/Roast Tier (Targeted Edge Cases):** Strictly triggered by high-confidence heuristic/regex patterns (politeness filler, trivial arithmetic, short 2-word lookups).
* **Research Grounding:** Every calculated number must map directly to established environmental research (UC Riverside 2023–2025; Luccioni et al., 2024; IEA Data Centre Reports).

---

## 2. Directory Structure & Tech Stack
* **Framework:** Vanilla TypeScript with Vite (or Webpack) bundling.
* **Manifest:** Manifest V3 (`permissions: ["storage"]`, `host_permissions: ["*://chatgpt.com/*", "*://gemini.google.com/*", "*://claude.ai/*"]`).
* **Styling:** CSS variables rendered strictly inside a **Closed Shadow DOM** to isolate extension styling from host page stylesheets.


```

prompt-tax/
├── manifest.json
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── background/
│   │   └── service-worker.ts       # Storage aggregation, session totals
│   ├── content/
│   │   ├── index.ts                # Entry point, URL dispatcher
│   │   ├── adapters/
│   │   │   ├── base.adapter.ts     # Platform interface
│   │   │   ├── gemini.adapter.ts   # Gemini DOM selector logic
│   │   │   ├── chatgpt.adapter.ts  # ChatGPT DOM selector logic
│   │   │   └── claude.adapter.ts   # Claude DOM selector logic
│   │   ├── engine/
│   │   │   ├── classifier.ts       # Regex intent routing
│   │   │   ├── calculator.ts       # Scientific formula implementation
│   │   │   ├── generator.ts        # Dynamic sentence engine
│   │   │   └── research-data.ts    # Citations & physical equivalencies
│   │   └── ui/
│   │       ├── shadow-root.ts      # Shadow DOM injector
│   │       ├── pill-component.ts   # Response badge component
│   │       └── modal-component.ts  # Scientific citation modal
│   └── popup/
│       ├── popup.html              # Daily summary / session receipts
│       └── popup.ts

```

---

## 3. Scientific Grounding & Calculation Engine

### Base Coefficients & Constants
Based on Shaolei Ren et al. (UC Riverside / arXiv:2304.03271) and Sasha Luccioni et al. (Hugging Face):
* **Token Estimation:** $1 \text{ token} \approx 4 \text{ characters}$ (or $0.75 \text{ words}$).
* **Direct + Indirect Water Footprint:** $\approx 0.50 \text{ ml}$ to $1.20 \text{ ml}$ of fresh water per combined input/output query block (scaling upward with token length and sequential generation depth).
  * `BASE_WATER_ML = 12.0` (fixed baseline cost per request invocation)
  * `PER_1K_OUTPUT_TOKENS_WATER_ML = 15.0`
* **Electrical Energy:** Standard web search $\approx 0.3 \text{ Wh}$; typical generative inference $\approx 2.5 \text{ to } 5.0 \text{ Wh}$.
  * `BASE_ENERGY_WH = 2.0`
  * `PER_1K_OUTPUT_TOKENS_WH = 3.5`
* **Reasoning / Extended Thinking Multiplier:** If "thinking" or extended reasoning DOM elements are detected, apply `REASONING_MULTIPLIER = 2.5`.

### Formula Implementation (`src/content/engine/calculator.ts`)
```typescript
export interface FootprintMetrics {
  inputTokens: number;
  outputTokens: number;
  isReasoning: boolean;
  waterMl: number;
  energyWh: number;
  googleSearchEquiv: number;
}

export function calculateFootprint(
  inputChars: number,
  outputChars: number,
  isReasoning: boolean
): FootprintMetrics {
  const inputTokens = Math.max(1, Math.round(inputChars / 4));
  const outputTokens = Math.max(1, Math.round(outputChars / 4));
  const multiplier = isReasoning ? 2.5 : 1.0;

  const waterMl = (12.0 + (outputTokens / 1000) * 15.0) * multiplier;
  const energyWh = (2.0 + (outputTokens / 1000) * 3.5) * multiplier;
  const googleSearchEquiv = Math.round(energyWh / 0.3);

  return {
    inputTokens,
    outputTokens,
    isReasoning,
    waterMl,
    energyWh,
    googleSearchEquiv,
  };
}

```

---

## 4. Intent Classification Engine (`src/content/engine/classifier.ts`)

Prompts must be classified locally into distinct categories to ensure zero false-positive roasts on legitimate work.

```typescript
export type PromptTier = 'POLITE' | 'SIMPLE_MATH' | 'QUICK_SEARCH' | 'INFORMATIVE';

export function classifyPrompt(rawText: string): PromptTier {
  const text = rawText.trim().toLowerCase();

  // 1. Politeness / Zero-Entropy Conversational Filler
  const politeRegex = /^(\b(thanks|thank you|ok|okay|got it|cool|nice|thumbs up|great|awesome|ty|cheers)\b[\s!.?]*)$/i;
  if (politeRegex.test(text) && text.length <= 30) {
    return 'POLITE';
  }

  // 2. Pure Trivial Arithmetic (No variables, just basic arithmetic)
  const mathRegex = /^[\d\s+\-*/%^().=]+$/;
  if (mathRegex.test(text) && text.length <= 25 && /\d/.test(text)) {
    return 'SIMPLE_MATH';
  }

  // 3. Ultra-short Factual Lookup
  const searchRegex = /^(who is|what is|when was|capital of|population of)\s+[\w\s]{2,20}\??$/i;
  if (searchRegex.test(text) && text.split(/\s+/).length <= 5) {
    return 'QUICK_SEARCH';
  }

  // Default: Genuine reasoning, coding, writing, debugging
  return 'INFORMATIVE';
}

```

---

## 5. Dynamic Combinatorial Sentence Engine (`src/content/engine/generator.ts`)

Avoid repetitive static text by assembling statements dynamically using combinatorial components: `[Opener] + [Data Impact] + [Contextual Reality]`.

```typescript
import { FootprintMetrics } from './calculator';
import { PromptTier } from './classifier';

export interface RenderedCopy {
  headline: string;
  subtext: string;
  isRoast: boolean;
  citationKey: string;
}

export function generateCopy(tier: PromptTier, metrics: FootprintMetrics): RenderedCopy {
  const waterDesc = `${metrics.waterMl.toFixed(0)}ml of water (~${(metrics.waterMl / 15).toFixed(1)} espresso shots)`;
  const energyDesc = `${metrics.energyWh.toFixed(1)} Wh (~${metrics.googleSearchEquiv}x a Google Search)`;

  if (tier === 'POLITE') {
    const openers = ["Well, that was polite.", "Diplomatic courtesy noted.", "Good manners, but..."];
    const bodies = [
      `Saying thank you just evaporated ${waterDesc}.`,
      `That 2-word courtesy drew ${energyDesc} from the grid.`
    ];
    const closers = [
      "The server rack still has zero feelings.",
      "Cooling towers drank potable water so a cluster could nod at you.",
      "A thumbs-up emoji on your screen costs 0 Joules."
    ];
    return {
      headline: `${pick(openers)} ${pick(bodies)}`,
      subtext: pick(closers),
      isRoast: true,
      citationKey: "ucr_ren_2023"
    };
  }

  if (tier === 'SIMPLE_MATH') {
    return {
      headline: `Supercomputer deployed. You consumed ${energyDesc} for elementary arithmetic.`,
      subtext: "Your built-in operating system calculator was right there.",
      isRoast: true,
      citationKey: "huggingface_luccioni_2024"
    };
  }

  if (tier === 'QUICK_SEARCH') {
    return {
      headline: `Classic index lookup turned heavy compute. Consumed ${waterDesc}.`,
      subtext: `A standard search index uses 1/${metrics.googleSearchEquiv}th of the electricity.`,
      isRoast: true,
      citationKey: "iea_datacenter_2024"
    };
  }

  // Informative (Tier: INFORMATIVE)
  return {
    headline: `⚡ ${metrics.energyWh.toFixed(1)} Wh  |  💧 ~${metrics.waterMl.toFixed(0)}ml cooling footprint`,
    subtext: `Telemetry: ~${metrics.outputTokens} tokens. Equivalent to ${metrics.googleSearchEquiv}x standard web searches.`,
    isRoast: false,
    citationKey: "ucr_ren_2023"
  };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

```

---

## 6. DOM Adapter Pattern (`src/content/adapters/`)

Each target platform must implement a standard contract:

```typescript
export interface LLMAdapter {
  isTargetPage(): boolean;
  getLatestUserPrompt(): string | null;
  observeResponses(onComplete: (userPrompt: string, outputElement: HTMLElement, responseText: string, isReasoning: boolean) => void): void;
  injectBadge(targetNode: HTMLElement, badgeElement: HTMLElement): void;
}

```

### Critical DOM Selectors & Streaming Rules

* **Gemini (`gemini.google.com`):**
* Turn containers: `model-response`, `message-content`, or `.conversation-container`.
* Streaming detection: Listen for class changes (e.g., presence of `.streaming` or cursor blinking tags). Trigger completion only when DOM stop mutating for $>800\text{ms}$.
* User input: Check the matching `.user-query-container` preceding the response.


* **ChatGPT (`chatgpt.com`):**
* Turn containers: `[data-message-author-role="assistant"]`.
* Streaming detection: Check for `.result-streaming` class removal.
* Reasoning detection: Check for existence of `[data-testid="extended-thinking-container"]` or collapsible thinking wrappers.


* **Claude (`claude.ai`):**
* Turn containers: `[data-is-streaming="false"]` on assistant message row blocks.



---

## 7. Shadow DOM Component & Citation Modal

To guarantee zero CSS leakage:

1. Every injected badge must be inside a custom element with `#shadow-root (closed)`.
2. Badge contains:
* Status Pill: Mini leaf/water droplet icon + dynamic text.
* "Learn Why" Info Icon: Opens the Scientific Citation Modal.


3. The Citation Modal renders:
* **Scope 1 (On-Site Cooling):** Direct evaporation in data center cooling towers.
* **Scope 2 (Off-Site Power Grid):** Thermoelectric water withdrawal/consumption during energy generation.
* **Full Citations:**
* *Li et al. (UC Riverside, 2023–2025): "Making AI Less 'Thirsty'"*
* *Luccioni et al. (Hugging Face, 2024): "Power Hungry Processing"*
* *International Energy Agency (IEA): Data Centres and Energy 2024*





---

## 8. Implementation Steps for Agent

1. **Scaffold Manifest V3 Project:** Initialize Vite + TypeScript with `manifest.json`.
2. **Build Math & Engine Modules:** Implement `calculator.ts`, `classifier.ts`, and `generator.ts` with unit test fixtures.
3. **Build Base & Gemini Adapters:** Implement `MutationObserver` on Gemini first. Debounce streaming mutations to detect final response completion.
4. **Implement Isolated Shadow DOM Component:** Create the pill badge with clean CSS and modal triggers.
5. **Add Local Storage Aggregation:** In `service-worker.ts`, update `chrome.storage.local` with rolling daily stats (`totalWaterMl`, `totalEnergyWh`, `totalPrompts`, `politeTaxCount`) to power the extension popup summary.

```

```