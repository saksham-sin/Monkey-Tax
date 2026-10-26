/**
 * Scientific formula implementation.
 *
 * Sequential output generation is memory-bandwidth bound and roughly
 * five times more expensive than prompt digestion (prefill-to-decode),
 * so input and output tokens are weighted separately. Water is split
 * into Scope 1 (on-site cooling towers) and Scope 2 (off-site
 * thermoelectric grid consumption).
 *
 * Coefficients calibrated against 2025/2026 fleet-efficiency findings
 * (modern TPU / H100 / H200 clusters).
 *
 * Grounded in: Shaolei Ren et al. (UC Riverside, arXiv:2304.03271),
 * Sasha Luccioni et al. (Hugging Face), IEA data centre reports.
 * Deterministic, side-effect free, executes in well under 1ms — no
 * models are ever invoked.
 */

/** Scope 1 base cooling water (ml) per request invocation. */
export const BASE_WATER_ML = 2.0;
/** Scope 1 marginal water (ml) per 1k generated output tokens. */
export const PER_1K_OUTPUT_TOKENS_WATER_ML = 2.0;
/** Scope 2 grid water multiplier (ml per Wh drawn off-site). */
export const SCOPE2_WML_PER_WH = 5.0;
/** Fixed baseline energy (Wh) per request invocation. */
export const BASE_ENERGY_WH = 0.5;
/** Energy (Wh) per 1k input (digestion/prefill) tokens. */
export const PER_1K_INPUT_TOKENS_WH = 0.3;
/** Energy (Wh) per 1k output (sequential decode) tokens — ~5x prefill. */
export const PER_1K_OUTPUT_TOKENS_WH = 1.5;
/** Multiplier applied when extended-thinking / reasoning UI is detected. */
export const REASONING_MULTIPLIER = 2.0;
/** Approximate characters per token. */
export const CHARS_PER_TOKEN = 4;
/** Energy of one standard web search, in Wh. */
export const GOOGLE_SEARCH_WH = 0.3;
/** Energy of one full smartphone charge, in Wh. */
export const PHONE_CHARGE_WH = 5.0;

export interface FootprintMetrics {
  inputTokens: number;
  outputTokens: number;
  isReasoning: boolean;
  /** Scope 1: on-site cooling-tower evaporation, ml. */
  waterMlDirect: number;
  /** Scope 2: off-site thermoelectric grid consumption, ml. */
  waterMlGrid: number;
  /** Scope 1 + Scope 2 combined, ml. */
  waterMl: number;
  energyWh: number;
  googleSearchEquiv: number;
}

export function calculateFootprint(
  inputChars: number,
  outputChars: number,
  isReasoning: boolean,
): FootprintMetrics {
  const inputTokens = Math.max(1, Math.round(inputChars / CHARS_PER_TOKEN));
  const outputTokens = Math.max(1, Math.round(outputChars / CHARS_PER_TOKEN));
  const multiplier = isReasoning ? REASONING_MULTIPLIER : 1.0;

  const energyWh =
    (BASE_ENERGY_WH +
      (inputTokens / 1000) * PER_1K_INPUT_TOKENS_WH +
      (outputTokens / 1000) * PER_1K_OUTPUT_TOKENS_WH) *
    multiplier;

  const waterMlDirect =
    (BASE_WATER_ML + (outputTokens / 1000) * PER_1K_OUTPUT_TOKENS_WATER_ML) * multiplier;
  const waterMlGrid = energyWh * SCOPE2_WML_PER_WH;
  const waterMl = waterMlDirect + waterMlGrid;
  const googleSearchEquiv = Math.round(energyWh / GOOGLE_SEARCH_WH);

  return {
    inputTokens,
    outputTokens,
    isReasoning,
    waterMlDirect,
    waterMlGrid,
    waterMl,
    energyWh,
    googleSearchEquiv,
  };
}

/**
 * Round a water figure into a tangible everyday visual so non-technical
 * readers never have to mentally convert millilitres.
 */
export function humanWaterVisual(waterMl: number): string {
  if (waterMl < 15) return '2 sips of water';
  if (waterMl < 45) return '1 shot glass of water';
  if (waterMl < 120) return 'half a cup of water';
  if (waterMl <= 250) return 'a cup of water';
  return `${(waterMl / 500).toFixed(1)} water bottles`;
}

/**
 * Fraction of a full smartphone charge (5 Wh) consumed by one request,
 * as a whole percentage — clamped to at least 1 %.
 */
export function phoneChargePercent(energyWh: number): number {
  return Math.max(1, Math.round((energyWh / PHONE_CHARGE_WH) * 100));
}
