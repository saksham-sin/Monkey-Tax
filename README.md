# MonkeyTax

"Stop using supercomputers like a monkey on a typewriter." Client-side, zero-backend
Manifest V3 Chrome extension that calculates and displays
the environmental footprint (cooling water + electrical energy) of individual queries
on Gemini, ChatGPT, and Claude. All math is local and deterministic — no models, no
network calls, sub-millisecond.

## Build & load

```
npm install
npm run build      # outputs dist/
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
and select the `dist/` folder.

Other scripts:

- `npm run typecheck` — strict TypeScript check
- `npm run test` — vitest unit tests for the engine (classifier / calculator / generator)
- `npm run generate:icons` — regenerate padded 16/32/48/128px icons from the root PNG

Builds regenerate the icons automatically and copy them from `public/icons/` to
`dist/icons/`, alongside the popup stylesheet. The header avatar is a local PNG;
no remote image request is made. The dark and light surfaces share terracotta
and peach accents, blue water telemetry, and red roast warnings.

## Architecture

- `src/content/engine/` — calculator, classifier, generator, research data (all local).
- `src/content/adapters/` — per-platform DOM adapters sharing a streaming-completion
  observer (response is final after >800ms of DOM quiet + platform streaming flag cleared).
- `src/content/ui/` — Closed Shadow DOM pill badge and scientific citation modal.
- `src/background/service-worker.ts` — rolling per-day aggregates in `chrome.storage.local`
  (`totalWaterMl`, `totalEnergyWh`, `totalPrompts`, `politeTaxCount`).
- `src/popup/` — daily summary / session receipts.

Research grounding: Li/Ren et al. (UC Riverside, arXiv:2304.03271, 2023–2025),
Luccioni et al. (Hugging Face, 2024), IEA Data Centres and Energy 2024.

## Licenses

*App icons based on Twemoji (Twitter/X), licensed under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).*
Icons are resized and padded for extension toolbar sizes. The popup avatar uses the supplied original PNG.
