/**
 * Regex intent routing. Guarantees zero false-positive roasts on
 * legitimate work: guardrails (multi-line, long, wordy, or technical
 * prompts) bail to INFORMATIVE before any roast pattern is even tried;
 * everything else that is not a high-confidence trivial pattern falls
 * through to the INFORMATIVE tier.
 */

export type PromptTier =
  | 'POLITE'
  | 'GREETING'
  | 'SIMPLE_MATH'
  | 'LAZY_RETRY'
  | 'QUICK_SEARCH'
  | 'INFORMATIVE';

export function classifyPrompt(rawText: string | null | undefined): PromptTier {
  if (!rawText) return 'INFORMATIVE';

  // Normalize: strip zero-width chars, leaked UI labels ("copy", "edit"),
  // and extra whitespace before any pattern runs.
  const text = rawText
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/(\s+\b(?:copy|edit)\b)+\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'INFORMATIVE';

  const lower = text.toLowerCase();
  const wordCount = lower.split(' ').filter(Boolean).length;

  // --- GUARDRAIL: never roast multi-line prompts, code, or long queries ---
  if (rawText.includes('\n') || text.length > 65 || wordCount > 10) {
    return 'INFORMATIVE';
  }
  // Never roast technical/programming language even in a short prompt.
  const techGuard =
    /\b(function|const|let|var|class|import|export|def|return|sql|select|insert|update|regex|docker|kubernetes|gradle|maven|git|npm|error|bug|exception|traceback|stacktrace|typescript|python|java|javascript|kotlin|react|vue|angular|api|endpoint|json|yaml|xml|css|html|complexity|algorithm|big-?o|refactor|debug|unit\s+test|prove|theorem|proof|lemma| axioms?|kafka|database|query|async|await|promise|null|undefined)\b/i;
  if (techGuard.test(lower)) {
    return 'INFORMATIVE';
  }

  // 1. GREETING: empty openers with no actual question attached.
  const greetingPattern =
    /^(hi+|hello+|hey+|hiya|yo+|hola|bonjour|good\s+(morning|afternoon|evening|night)|are\s+you\s+there|you\s+there|test|testing|anyone\s+there)[\s!.,?~]*$/i;
  if (greetingPattern.test(lower)) {
    return 'GREETING';
  }

  // 2. POLITENESS: closers and zero-entropy acknowledgments, including
  //    two-word combos like "ok got it" and single emoji replies.
  const ackWord = 'ok|okay|kk|k|cool|nice|great|awesome|perfect|sweet|sure|alright|wow|\u{1F44D}|\u{1F64F}|\u2764\uFE0F|\u{1F44C}|\u{1F602}|\u{1F642}';
  const closer =
    'thanks(\\s+a\\s+lot|\\s+so\\s+much|\\s+bro|\\s+man|\\s+mate)?|thank\\s+you(\\s+so\\s+much|\\s+very\\s+much)?|thx|tysm|ty|got\\s+it|got\\s+that|understood|makes\\s+sense|appreciate\\s+(it|that)|good\\s+job|well\\s+done|nice\\s+one|cheers';
  const fillerToken = `${ackWord}|${closer}`;
  const politePattern = new RegExp(
    `^(${fillerToken})(\\s+,?\\s*(${fillerToken}))?[\\s!.,?~]*$`,
    'i',
  );
  if (politePattern.test(lower)) {
    return 'POLITE';
  }

  // 3. LAZY RETRY: zero-context commands that make the model guess.
  const lazyRetryPattern =
    /^(retry|try\s+again|again|redo|redo\s+it|regenerate|wrong|wrong\s+answer|no+|nope|nah|bad|bad\s+answer|bad\s+bot|fix|fix\s+it|fix\s+this|this|not\s+working|doesn'?t\s+work|broken|continue|go\s+on|keep\s+going|more|same|repeat|\?+|!+|\*+)[\s!.,?~]*$/i;
  if (lazyRetryPattern.test(lower)) {
    return 'LAZY_RETRY';
  }

  // 4. SIMPLE MATH: bare arithmetic, conversational prefixes, spoken
  //    word operators, and percentages. What remains after stripping
  //    must be pure digit/operator soup with a real operation.
  const strippedMath = lower
    .replace(
      /^(hey\s+|please\s+|can\s+you\s+|could\s+you\s+|tell\s+me\s+(how\s+much\s+)?|what\s+is\s+|whats\s+|what's\s+|how\s+much\s+is\s+|how\s+much\s+|calculate\s+|compute\s+|solve\s+|evaluate\s+)+/i,
      '',
    )
    .replace(/^(is|equals?|equal\s+to)\s+/i, '')
    .replace(/\b(plus|add|added\s+to)\b/g, '+')
    .replace(/\b(minus|subtract|less)\b/g, '-')
    .replace(/\b(times|multiplied\s+by|multiply\s+by|x)\b/g, '*')
    .replace(/\b(divided\s+by|divide\s+by|over)\b/g, '/')
    .replace(/\b(percent|pct)\s+of\b/g, '* 0.01 *')
    .replace(/\b%\s*of\b/g, '* 0.01 *')
    .replace(/[?=]/g, '')
    .trim();
  const mathPattern = /^[\d\s+\-*/%^().]+$/;
  if (
    mathPattern.test(strippedMath) &&
    /\d/.test(strippedMath) &&
    /[+\-*/%^]/.test(strippedMath)
  ) {
    return 'SIMPLE_MATH';
  }

  // 5. QUICK SEARCH: trivial 1-6 word Google/Wikipedia/weather/time
  //    lookups, either prefixed ("who is…", "define…") or bare suffix
  //    lookups ("tokyo time", "tesla stock price").
  const searchPrefixPattern =
    /^(who\s+is|who\s+was|who's|what\s+is|whats|what's|when\s+was|when\s+is|where\s+is|where's|capital\s+of|population\s+of|weather\s+(in|for|today)?|time\s+in|temperature\s+in|define|meaning\s+of|definition\s+of|spell|how\s+old\s+is|how\s+tall\s+is|height\s+of|weight\s+of|ceo\s+of|founder\s+of|born\s+in)\s+/i;
  const bareLookupPattern =
    /^[\w\s']+\s+(weather|time|temperature|stock\s+price|score|meaning|definition|net\s+worth|age|height|weight|capital|population)[\s?!.]*$/i;
  if (
    searchPrefixPattern.test(lower) ||
    (bareLookupPattern.test(lower) && wordCount <= 4)
  ) {
    if (wordCount <= 6) return 'QUICK_SEARCH';
  }

  // Default: genuine reasoning, coding, writing, debugging, proofs.
  return 'INFORMATIVE';
}
