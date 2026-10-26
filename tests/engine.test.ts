import { describe, expect, it, vi } from 'vitest';
import { calculateFootprint, humanWaterVisual, phoneChargePercent } from '../src/content/engine/calculator';
import { classifyPrompt } from '../src/content/engine/classifier';
import { generateCopy, REDDIT_HARDWARE_ROASTS } from '../src/content/engine/generator';
import { sanitizeText } from '../src/content/adapters/base.adapter';

describe('sanitizeText (Gemini extraction shapes)', () => {
  it('collapses the "You said X\\n\\nX" accordion duplication', () => {
    expect(sanitizeText('You said Thanks\n\nThanks')).toBe('Thanks');
    expect(sanitizeText('You said 45 * 12\n\n45 * 12')).toBe('45 * 12');
  });

  it('strips zero-width chars and leaked action labels', () => {
    expect(sanitizeText('capital of france\u200B copy edit')).toBe('capital of france');
  });

  it('keeps genuine multi-paragraph prompts intact', () => {
    const prompt = 'Refactor this\n\nand add tests please';
    expect(sanitizeText(prompt)).toBe(prompt);
  });

  it('feeds trivial shapes straight into the classifier', () => {
    expect(classifyPrompt(sanitizeText('You said Thanks\n\nThanks'))).toBe('POLITE');
    expect(classifyPrompt(sanitizeText('You said 45 * 12\n\n45 * 12'))).toBe('SIMPLE_MATH');
  });
});

describe('classifyPrompt', () => {
  it('routes politeness filler to POLITE', () => {
    expect(classifyPrompt('thanks!')).toBe('POLITE');
    expect(classifyPrompt('  ok  ')).toBe('POLITE');
    expect(classifyPrompt('thank you')).toBe('POLITE');
  });

  it('routes trivial arithmetic to SIMPLE_MATH', () => {
    expect(classifyPrompt('2+2')).toBe('SIMPLE_MATH');
    expect(classifyPrompt('(12 * 3) - 7')).toBe('SIMPLE_MATH');
    expect(classifyPrompt('7777+998')).toBe('SIMPLE_MATH');
  });

  it('routes natural-language math to SIMPLE_MATH', () => {
    expect(classifyPrompt('what is 45 * 12')).toBe('SIMPLE_MATH');
    expect(classifyPrompt('calculate 120/4')).toBe('SIMPLE_MATH');
    expect(classifyPrompt('tell me how much is 7777+998')).toBe('SIMPLE_MATH');
    expect(classifyPrompt('solve 9*9')).toBe('SIMPLE_MATH');
    expect(classifyPrompt('compute 100 - 37')).toBe('SIMPLE_MATH');
  });

  it('routes ultra-short factual lookups to QUICK_SEARCH', () => {
    expect(classifyPrompt('who is Ada Lovelace')).toBe('QUICK_SEARCH');
    expect(classifyPrompt('capital of Japan?')).toBe('QUICK_SEARCH');
  });

  it('never roasts genuine work', () => {
    expect(
      classifyPrompt('Refactor this TypeScript service to use dependency injection and add unit tests'),
    ).toBe('INFORMATIVE');
    expect(classifyPrompt('x^2 + 3x = 12, solve for x step by step')).toBe('INFORMATIVE');
    expect(classifyPrompt('thanks, now also add error handling to the parser')).toBe('INFORMATIVE');
  });
});

describe('calculateFootprint', () => {
  it('weights input and output tokens separately (~5x prefill-to-decode)', () => {
    // 10 input tokens, 1000 output tokens:
    // energy = 0.5 + 10/1000*0.3 + 1000/1000*1.5 = 2.003 Wh
    const m = calculateFootprint(40, 4000, false);
    expect(m.inputTokens).toBe(10);
    expect(m.outputTokens).toBe(1000);
    expect(m.energyWh).toBeCloseTo(2.003, 6);
    expect(m.googleSearchEquiv).toBe(7); // Math.round(2.003 / 0.3)
  });

  it('splits water into Scope 1 (towers) and Scope 2 (grid)', () => {
    const m = calculateFootprint(40, 4000, false);
    expect(m.waterMlDirect).toBeCloseTo(2 + (1000 / 1000) * 2, 6); // 4 ml
    expect(m.waterMlGrid).toBeCloseTo(2.003 * 5, 6); // 10.015 ml
    expect(m.waterMl).toBeCloseTo(4 + 10.015, 6);
  });

  it('applies the 2.0x reasoning multiplier to both scopes', () => {
    const m = calculateFootprint(40, 4000, true);
    expect(m.isReasoning).toBe(true);
    expect(m.energyWh).toBeCloseTo(2.003 * 2, 6);
    expect(m.waterMlDirect).toBeCloseTo(4 * 2, 6);
    expect(m.waterMl).toBeCloseTo(8 + 2.003 * 2 * 5, 6);
    expect(m.googleSearchEquiv).toBe(13); // Math.round(4.006 / 0.3)
  });

  it('floors token counts at 1 for tiny exchanges', () => {
    const m = calculateFootprint(0, 0, false);
    expect(m.inputTokens).toBe(1);
    expect(m.outputTokens).toBe(1);
    expect(m.waterMl).toBeGreaterThan(4);
  });

  it('rounds water into everyday visuals', () => {
    expect(humanWaterVisual(12)).toBe('2 sips of water');
    expect(humanWaterVisual(15)).toBe('1 shot glass of water');
    expect(humanWaterVisual(45)).toBe('half a cup of water');
    expect(humanWaterVisual(120)).toBe('a cup of water');
    expect(humanWaterVisual(750)).toBe('1.5 water bottles');
    expect(phoneChargePercent(1.7)).toBe(34);
    expect(phoneChargePercent(0.001)).toBe(1);
  });
});

describe('generateCopy', () => {
  const metrics = calculateFootprint(40, 4000, false);

  it('marks trivial tiers as roasts with grounded citations', () => {
    expect(generateCopy('POLITE', metrics).isRoast).toBe(true);
    expect(generateCopy('POLITE', metrics).citationKey).toBe('ucr_ren_2023');
    expect(generateCopy('SIMPLE_MATH', metrics).citationKey).toBe('huggingface_luccioni_2024');
    expect(generateCopy('QUICK_SEARCH', metrics).citationKey).toBe('iea_datacenter_2024');
  });

  it('keeps the INFORMATIVE tier a plain-language readout', () => {
    const copy = generateCopy('INFORMATIVE', metrics);
    expect(copy.isRoast).toBe(false);
    expect(copy.headline).toContain('phone charge');
    expect(copy.headline).toContain('Wh');
    expect(copy.headline).toContain('cooling water');
    expect(copy.subtext).toContain('tokens');
    expect(copy.subtext).toContain('in /');
    for (const banned of ['lookup', 'elementary', 'telemetry', 'supercomputer']) {
      expect(copy.headline.toLowerCase()).not.toContain(banned);
      expect(copy.subtext.toLowerCase()).not.toContain(banned);
    }
  });

  it('exposes drawer fields for every tier (accordion payload)', () => {
    for (const tier of [
      'POLITE',
      'GREETING',
      'SIMPLE_MATH',
      'LAZY_RETRY',
      'QUICK_SEARCH',
      'INFORMATIVE',
    ] as const) {
      const copy = generateCopy(tier, metrics);
      expect(copy.waterMlDirect).toBeGreaterThan(0);
      expect(copy.waterMlGrid).toBeGreaterThan(0);
      expect(copy.inputTokens).toBeGreaterThan(0);
      expect(copy.googleSearchEquiv).toBeGreaterThan(0);
      expect(copy.energyWh).toBeGreaterThan(0);
      expect(copy.waterVisual.length).toBeGreaterThan(0);
      expect(copy.ledMinutes).toBeGreaterThanOrEqual(1);
      expect(REDDIT_HARDWARE_ROASTS).toContain(copy.redditRoast);
      // Global copy rule: zero em/en dashes in user-facing strings.
      for (const field of [copy.headline, copy.subtext, copy.redditRoast]) {
        expect(field).not.toContain('\u2014');
        expect(field).not.toContain('\u2013');
      }
      // Instant-regret contract: the collapsed roast pill shows headline
      // AND subtext, so both must stay conversational-length.
      if (copy.isRoast) {
        expect(copy.headline.length).toBeLessThanOrEqual(110);
        expect(copy.subtext.length).toBeLessThanOrEqual(110);
      }
    }
  });

  it('includes the MonkeyTax infinite-monkey copy rotations', () => {
    const cases = [
      {
        tier: 'SIMPLE_MATH',
        random: 0,
        headline: 'Used a trillion-parameter AI as a pocket calculator.',
        subtext: 'An infinite number of monkeys on typewriters would have solved that faster for zero Watts.',
      },
      {
        tier: 'SIMPLE_MATH',
        random: 0.34,
        headline: 'Burned enough electricity to charge your phone by 10% for elementary arithmetic.',
        subtext: 'Your keyboard monkey strikes again.',
      },
      {
        tier: 'POLITE',
        random: 0,
        headline: "MonkeyTax Alert: Evaporated ~2 sips of water just saying 'Thank you' to a server rack.",
        subtext: 'The cluster is not sentient, bro.',
      },
      {
        tier: 'POLITE',
        random: 0.26,
        headline: "Being polite to silicon: You just spent cooling water to say 'Thanks'.",
        subtext: 'A true monkey-on-a-typewriter moment.',
      },
      {
        tier: 'GREETING',
        random: 0,
        headline: "Woke up a billion-dollar GPU cluster just to say 'Good morning' with zero question attached.",
        subtext: 'Leading with the actual question is cheaper for everyone involved.',
      },
    ] as const;

    for (const testCase of cases) {
      vi.spyOn(Math, 'random').mockReturnValueOnce(testCase.random).mockReturnValueOnce(0);
      const copy = generateCopy(testCase.tier, metrics);
      expect(copy.headline).toBe(testCase.headline);
      expect(copy.subtext).toBe(testCase.subtext);
      vi.restoreAllMocks();
    }

    expect(REDDIT_HARDWARE_ROASTS).toContain(
      "An infinite number of monkeys with typewriters wouldn't have hoarded global GDDR6 memory like this.",
    );
    expect(REDDIT_HARDWARE_ROASTS).toContain(
      'TSMC paused consumer wafer production so your inner keyboard monkey could ask for weather.',
    );
  });
});
