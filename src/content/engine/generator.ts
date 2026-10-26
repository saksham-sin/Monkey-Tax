/**
 * Dynamic combinatorial sentence engine: [Opener] + [Data Impact] +
 * [Contextual Reality]. Roast copy is only reachable from the three
 * high-confidence trivial tiers; genuine work always gets the
 * non-judgmental telemetry readout.
 */
import type { FootprintMetrics } from './calculator';
import { humanWaterVisual, phoneChargePercent } from './calculator';
import type { PromptTier } from './classifier';

/**
 * Current hardware/tech-economy memes (RAM shortages, GPU scalping,
 * wafer allocation to enterprise AI). Rotated into the closer slot of
 * every roast tier so the copy stays current instead of repetitive.
 */
export const REDDIT_HARDWARE_ROASTS = [
  "An infinite number of monkeys with typewriters wouldn't have hoarded global GDDR6 memory like this.",
  'TSMC paused consumer wafer production so your inner keyboard monkey could ask for weather.',
  '2 sticks of DDR5 RAM cost $900 right now because hyperscalers bought all fab capacity for prompts like this.',
  'TSMC paused consumer wafer production so this bot could count on its fingers for you.',
  'This is why a PS5 Pro and iPhone cost a kidney now: data centers hoarded all the GDDR6 and HBM memory.',
  "Somewhere in Taiwan, a cleanroom technician cried while etching silicon for a 2-word courtesy prompt.",
  "You're paying $1,500 for a flagship phone with 8GB RAM because AI clusters ate the rest of the global supply.",
  'That prompt drank more chilled coolant than an overclocked custom loop running Cyberpunk 2077 at 4K.',
  'NVIDIA just added another 0 to the enterprise H100 sticker price because of this query.',
];

export interface RenderedCopy {
  headline: string;
  subtext: string;
  isRoast: boolean;
  citationKey: string;
  /** Scope 1 water shown in the accordion's cooling breakdown, ml. */
  waterMlDirect: number;
  /** Scope 2 water shown in the accordion's cooling breakdown, ml. */
  waterMlGrid: number;
  /** Digestion-side token count surfaced in the expanded telemetry. */
  inputTokens: number;
  /** Standard-search equivalence powering the collapsed metric chip. */
  googleSearchEquiv: number;
  /** The rotating Reddit hardware reality check, ml… of memes. */
  redditRoast: string;
  /** Total energy Wh for the icon-meter widgets. */
  energyWh: number;
  /** Combined Scope 1 + Scope 2 water, ml, for meter widgets. */
  waterMl: number;
  /** Everyday water visual ("2 sips of water" etc.) for icon chips. */
  waterVisual: string;
  /** Minutes a 10 W desk lamp could run on this request's energy. */
  ledMinutes: number;
}

export function generateCopy(tier: PromptTier, metrics: FootprintMetrics): RenderedCopy {
  // Everyday visuals: nobody thinks in millilitres or watt-hours, so
  // every figure is rounded into sips, shots, cups, phone charges, or
  // how long a bright LED could run on the same power (10 W bulb).
  const waterVisual = humanWaterVisual(metrics.waterMl);
  const phoneChargePct = phoneChargePercent(metrics.energyWh);
  const ledMinutes = Math.max(1, Math.round(metrics.energyWh * 6));
  const base = {
    waterMlDirect: metrics.waterMlDirect,
    waterMlGrid: metrics.waterMlGrid,
    inputTokens: metrics.inputTokens,
    googleSearchEquiv: metrics.googleSearchEquiv,
    energyWh: metrics.energyWh,
    waterMl: metrics.waterMl,
    waterVisual,
    ledMinutes,
  };

  if (tier === 'POLITE') {
    const punchline = pick([
      {
        headline: "MonkeyTax Alert: Evaporated ~2 sips of water just saying 'Thank you' to a server rack.",
        subtext: 'The cluster is not sentient, bro.',
      },
      {
        headline: "Being polite to silicon: You just spent cooling water to say 'Thanks'.",
        subtext: 'A true monkey-on-a-typewriter moment.',
      },
      {
        headline: `You evaporated ~${waterVisual} saying 'Thank You' to a server rack.`,
        subtext: 'It has no feelings, and it is not inviting you to its wedding.',
      },
      {
        headline: `Manners noted. That 'Thank You' ran a bright LED for ${ledMinutes} minute${ledMinutes === 1 ? '' : 's'}.`,
        subtext: 'A thumbs-up emoji on your keyboard would have cost zero energy.',
      },
    ]);
    return {
      ...punchline,
      isRoast: true,
      citationKey: 'ucr_ren_2023',
      redditRoast: pick(REDDIT_HARDWARE_ROASTS),
      ...base,
    };
  }

  if (tier === 'GREETING') {
    const punchline = pick([
      {
        headline: "Woke up a billion-dollar GPU cluster just to say 'Good morning' with zero question attached.",
        subtext: 'Leading with the actual question is cheaper for everyone involved.',
      },
      {
        headline: 'Woke up a billion-dollar server cluster just to say hi with zero question attached.',
        subtext: 'The data center has no feelings and a very large electric bill.',
      },
      {
        headline: `Just ask the question, bro. You evaporated ~${waterVisual} on small talk with a bot.`,
        subtext: 'Leading with the actual question is cheaper for everyone involved.',
      },
    ]);
    return {
      ...punchline,
      isRoast: true,
      citationKey: 'ucr_ren_2023',
      redditRoast: pick(REDDIT_HARDWARE_ROASTS),
      ...base,
    };
  }

  if (tier === 'LAZY_RETRY') {
    return {
      headline: pick([
        `'Fix it' is not a prompt. Making the AI guess what broke burned ${ledMinutes} min of lamp power.`,
        'Zero context given, 100% power drawn. The GPU is guessing blind now.',
      ]),
      subtext: pick([
        'Give actual details instead of rage-typing at the text box.',
        'A retry with real details costs the same watts and actually works.',
      ]),
      isRoast: true,
      citationKey: 'iea_datacenter_2024',
      redditRoast: pick(REDDIT_HARDWARE_ROASTS),
      ...base,
    };
  }

  if (tier === 'SIMPLE_MATH') {
    const punchline = pick([
      {
        headline: 'Used a trillion-parameter AI as a pocket calculator.',
        subtext: 'An infinite number of monkeys on typewriters would have solved that faster for zero Watts.',
      },
      {
        headline: 'Burned enough electricity to charge your phone by 10% for elementary arithmetic.',
        subtext: 'Your keyboard monkey strikes again.',
      },
      {
        headline: `Burned enough power to charge ${phoneChargePct}% of your phone for grade-school math.`,
        subtext: 'Your phone literally has a calculator app sitting right there.',
      },
    ]);
    return {
      ...punchline,
      isRoast: true,
      citationKey: 'huggingface_luccioni_2024',
      redditRoast: pick(REDDIT_HARDWARE_ROASTS),
      ...base,
    };
  }

  if (tier === 'QUICK_SEARCH') {
    return {
      headline: pick([
        `A whole data center drank ~${waterVisual} just to Google something for you.`,
        'Used a massive AI cluster to fetch a public fact Google already had for free.',
      ]),
      subtext: pick([
        'A regular web search uses a fraction of the electricity.',
        "Could've typed that in the browser address bar, but here we are.",
      ]),
      isRoast: true,
      citationKey: 'iea_datacenter_2024',
      redditRoast: pick(REDDIT_HARDWARE_ROASTS),
      ...base,
    };
  }

  // Informative (Tier: INFORMATIVE): sleek, plain-language readout.
  return {
    headline:
      `\u26A1 ~${phoneChargePct}% phone charge (${metrics.energyWh.toFixed(1)} Wh)` +
      `  |  \uD83D\uDCA7 ~${waterVisual} cooling water`,
    subtext:
      `About ${metrics.inputTokens} tokens in / ${metrics.outputTokens} out. ` +
      `Worth ${metrics.googleSearchEquiv}x a regular web search.`,
    isRoast: false,
    citationKey: 'ucr_ren_2023',
    redditRoast: pick(REDDIT_HARDWARE_ROASTS),
    ...base,
  };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
