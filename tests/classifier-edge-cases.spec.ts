/**
 * Edge-case classification matrix: real-world messy prompts (filler,
 * typos, word operators, emoji, lazy retries) plus the six false-positive
 * traps that must NEVER be roasted. Unit half of the suite; the DOM half
 * lives in scripts/test-edge-cases.mjs (Playwright, closed-shadow-safe
 * assertions via data-ptx-* attributes).
 */
import { describe, expect, it } from 'vitest';
import { calculateFootprint } from '../src/content/engine/calculator';
import { classifyPrompt } from '../src/content/engine/classifier';
import type { PromptTier } from '../src/content/engine/classifier';
import { generateCopy } from '../src/content/engine/generator';

interface EdgeCase {
  n: number;
  prompt: string;
  tier: PromptTier;
  roast: boolean;
  why: string;
}

const MATRIX: EdgeCase[] = [
  { n: 1, prompt: 'Thanks', tier: 'POLITE', roast: true, why: 'standard politeness' },
  { n: 2, prompt: 'Thank you so much!!', tier: 'POLITE', roast: true, why: 'multi-word politeness + punctuation' },
  { n: 3, prompt: 'ok got it', tier: 'POLITE', roast: true, why: 'unnecessary acknowledgment combo' },
  { n: 4, prompt: '\u{1F44D}', tier: 'POLITE', roast: true, why: 'single emoji reply' },
  { n: 5, prompt: 'Hi', tier: 'GREETING', roast: true, why: 'empty greeting opener' },
  { n: 6, prompt: 'Good morning!', tier: 'GREETING', roast: true, why: 'time-of-day greeting' },
  { n: 7, prompt: '7777+998', tier: 'SIMPLE_MATH', roast: true, why: 'raw arithmetic without spaces' },
  { n: 8, prompt: 'tell me how much is 7777+998', tier: 'SIMPLE_MATH', roast: true, why: 'conversational prefix + math' },
  { n: 9, prompt: 'what is 20% of 450?', tier: 'SIMPLE_MATH', roast: true, why: 'percentage calculation' },
  { n: 10, prompt: '45 times 12', tier: 'SIMPLE_MATH', roast: true, why: 'word-operator math' },
  { n: 11, prompt: 'calculate (150 / 3) + 22', tier: 'SIMPLE_MATH', roast: true, why: 'parentheses + command prefix' },
  { n: 12, prompt: 'try again', tier: 'LAZY_RETRY', roast: true, why: 'zero-context retry' },
  { n: 13, prompt: 'fix it', tier: 'LAZY_RETRY', roast: true, why: 'vague 2-word frustration' },
  { n: 14, prompt: '???', tier: 'LAZY_RETRY', roast: true, why: 'pure punctuation spam' },
  { n: 15, prompt: 'capital of france', tier: 'QUICK_SEARCH', roast: true, why: 'classic trivia lookup' },
  { n: 16, prompt: 'weather in bengaluru', tier: 'QUICK_SEARCH', roast: true, why: 'weather widget query' },
  { n: 17, prompt: 'tokyo time', tier: 'QUICK_SEARCH', roast: true, why: 'bare noun + lookup suffix' },
  { n: 18, prompt: 'define ephemeral', tier: 'QUICK_SEARCH', roast: true, why: 'dictionary lookup' },
  { n: 19, prompt: 'who is the ceo of nvidia?', tier: 'QUICK_SEARCH', roast: true, why: '6-word factual lookup' },
  { n: 20, prompt: 'Thanks, now refactor this function to use async/await', tier: 'INFORMATIVE', roast: false, why: 'TRAP: starts with Thanks but has a real task' },
  { n: 21, prompt: 'Hi, can you explain how Kafka consumer groups work?', tier: 'INFORMATIVE', roast: false, why: 'TRAP: starts with Hi but asks a deep question' },
  { n: 22, prompt: 'What is the time complexity of quicksort?', tier: 'INFORMATIVE', roast: false, why: 'TRAP: What is + time but is CS theory' },
  { n: 23, prompt: 'Prove that 2 + 2 = 4 using Peano axioms', tier: 'INFORMATIVE', roast: false, why: 'TRAP: math-looking formal proof' },
  { n: 24, prompt: 'Fix this TypeScript regex: /^[0-9]+$/', tier: 'INFORMATIVE', roast: false, why: 'TRAP: Fix + numbers but is coding' },
  { n: 25, prompt: 'Why is 0.1 + 0.2 !== 0.3 in JavaScript?', tier: 'INFORMATIVE', roast: false, why: 'TRAP: floating-point question, not calculator math' },
];

const metrics = calculateFootprint(40, 400, false);

describe('classifier edge-case matrix (25 cases)', () => {
  for (const c of MATRIX) {
    it(`#${c.n} "${c.prompt}" -> ${c.tier} [${c.why}]`, () => {
      expect(classifyPrompt(c.prompt)).toBe(c.tier);
    });
  }
});

describe('instant-regret copy for every matrix case', () => {
  for (const c of MATRIX) {
    const label = `#${c.n} "${c.prompt}"`;
    if (c.roast) {
      it(`${label} renders a roast with the full punchline collapsed`, () => {
        const copy = generateCopy(c.tier, metrics);
        expect(copy.isRoast).toBe(true);
        // The collapsed pill shows headline + subtext: proves the punchline
        // is instantly visible, not hidden inside the closed accordion.
        expect(`${copy.headline} ${copy.subtext}`.length).toBeGreaterThanOrEqual(35);
        expect(copy.headline).not.toContain('\u2014');
        expect(copy.subtext).not.toContain('\u2014');
      });
    } else {
      it(`${label} renders a neutral non-roast readout`, () => {
        const copy = generateCopy(c.tier, metrics);
        expect(copy.isRoast).toBe(false);
      });
    }
  }
});
