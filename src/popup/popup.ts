/**
 * Popup controller: renders daily summary and all-time session receipts
 * from chrome.storage.local aggregates written by the service worker.
 */
import type { AllTimeStats, DayStats } from '../background/service-worker';
import { humanWaterVisual } from '../content/engine/calculator';

const STORAGE_KEYS = ['days', 'dailyHistory', 'allTime'] as const;
const GOOGLE_SEARCH_WH = 0.3;
const PHONE_CHARGE_WH = 5.0;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function totalAllTime(days: Record<string, DayStats>): AllTimeStats {
  return Object.values(days).reduce((total, day) => ({
    prompts: total.prompts + day.totalPrompts,
    waterMl: total.waterMl + day.totalWaterMl,
    energyWh: total.energyWh + day.totalEnergyWh,
    fillerCount: total.fillerCount + (day.fillerCount ?? day.politeTaxCount),
  }), { prompts: 0, waterMl: 0, energyWh: 0, fillerCount: 0 });
}

function renderAnnualPace(allTime: AllTimeStats, daysActive: number): void {
  const paceCard = document.getElementById('ptx-annual-pace');
  const paceText = document.getElementById('ptx-pace-text');
  if (!paceCard || !paceText) return;
  if (allTime.prompts < 15) {
    paceCard.style.display = 'none';
    return;
  }

  const days = Math.max(1, daysActive);
  const avgPromptsPerDay = allTime.prompts / days;
  const projectedWaterLiters = ((allTime.waterMl / days) * 365) / 1000;
  const projectedEnergyKwh = ((allTime.energyWh / days) * 365) / 1000;
  paceText.innerHTML =
    `Based on your daily average of <b>${avgPromptsPerDay.toFixed(0)} prompts</b>, your yearly footprint projects to ` +
    `<b>${projectedWaterLiters.toFixed(1)} liters</b> of cooling water and ` +
    `<b>${projectedEnergyKwh.toFixed(1)} kWh</b> of electricity.`;
  paceCard.style.display = 'block';
}

function render(days: Record<string, DayStats>, allTime: AllTimeStats): void {
  const today = days[todayKey()] ?? {
    totalWaterMl: 0,
    totalEnergyWh: 0,
    totalPrompts: 0,
    politeTaxCount: 0,
  };

  setText('today-prompts', String(today.totalPrompts));
  setText('today-water', `${today.totalWaterMl.toFixed(0)} ml`);
  setText('today-energy', `${today.totalEnergyWh.toFixed(1)} Wh`);
  setText('today-polite', String(today.politeTaxCount));

  setText('all-prompts', String(allTime.prompts));
  setText('all-water', `${allTime.waterMl.toFixed(0)} ml`);
  setText('all-energy', `${allTime.energyWh.toFixed(1)} Wh`);
  setText('all-searches', `${Math.round(allTime.energyWh / GOOGLE_SEARCH_WH)}\u00D7`);
  renderAnnualPace(allTime, Object.values(days).filter((day) => day.totalPrompts > 0).length);

  // Contextual "Scale Reality Check" under the daily grid — the per-prompt
  // numbers look tiny, so escalate the framing as the day's volume grows.
  if (today.totalPrompts < 10) {
    setText(
      'scale-check',
      '\uD83C\uDF31 Just getting started today. Keep prompts intentional to save sips.',
    );
  } else if (today.totalPrompts < 30) {
    const phoneCharges = (today.totalEnergyWh / PHONE_CHARGE_WH).toFixed(1);
    setText(
      'scale-check',
      `\u26A1 Scale check: Today's prompts equal ~${phoneCharges} full phone charges. Those small numbers add up.`,
    );
  } else {
    setText(
      'scale-check',
      `\uD83D\u6B0E Straw Effect in action: You've evaporated over ${(today.totalWaterMl / 500).toFixed(1)} water bottles today. That's a real data center drink.`,
    );
  }

  if (today.totalPrompts > 0) {
    setText(
      'receipt-line',
      `Today\u2019s receipt: ${today.totalPrompts} prompt${today.totalPrompts === 1 ? '' : 's'} drank ` +
        `${today.totalWaterMl.toFixed(0)}ml of cooling water (\u2248 ${humanWaterVisual(today.totalWaterMl)}) ` +
        `and drew ${today.totalEnergyWh.toFixed(1)} Wh. Numbers grounded in UC Riverside, Hugging Face & IEA research.`,
    );
  } else {
    // Guard: storage may have been cleared after a populated render, so
    // always restore the zero-state copy instead of leaving stale text.
    setText(
      'receipt-line',
      'No receipts yet. Type something intentional or let your keyboard monkey run wild.',
    );
  }
}

interface ForceScanReply {
  ok: boolean;
  duplicate: boolean;
  turns: number;
  waterMl: number;
  energyWh: number;
}

function setFeedback(text: string, kind: 'ok' | 'err' | ''): void {
  const el = document.getElementById('ptx-scan-feedback');
  if (!el) return;
  el.textContent = text;
  el.className = 'ptx-scan-feedback';
  if (kind) el.classList.add(kind);
}

async function renderPopupMetrics(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  const days = (stored['dailyHistory'] as Record<string, DayStats> | undefined) ??
    (stored['days'] as Record<string, DayStats> | undefined) ?? {};
  const allTime = (stored['allTime'] as AllTimeStats | undefined) ?? totalAllTime(days);
  render(days, allTime);
}

async function handleScanReply(reply: ForceScanReply | undefined): Promise<boolean> {
  if (!reply || !reply.ok || typeof reply.turns !== 'number') return false;
  const note = reply.duplicate ? ' (already counted)' : '';
  setFeedback(
    `\u2713 Scanned ${reply.turns} turns (${reply.waterMl}ml water, ${reply.energyWh} Wh)${note}`,
    'ok',
  );
  await renderPopupMetrics();
  return true;
}

/** Manual force-scan of the active chat tab (part 6 of the spec). */
async function forceScanActiveTab(): Promise<void> {
  const button = document.getElementById('ptx-force-scan') as HTMLButtonElement | null;
  if (button) button.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setFeedback('No active tab to scan.', 'err');
      return;
    }
    try {
      const reply = (await chrome.tabs.sendMessage(tab.id, { type: 'PTX_FORCE_SCAN' })) as
        | ForceScanReply
        | undefined;
      if (await handleScanReply(reply)) return;
      setFeedback('Scan returned no conversation data. Is a chat open in that tab?', 'err');
    } catch {
      // Content script absent (tab predates install/reload): inject and retry.
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        const reply = (await chrome.tabs.sendMessage(tab.id, { type: 'PTX_FORCE_SCAN' })) as
          | ForceScanReply
          | undefined;
        if (await handleScanReply(reply)) return;
      } catch {
        /* injection blocked (store pages, web store, etc.) */
      }
      setFeedback('Please refresh this tab once to activate MonkeyTax.', 'err');
    }
  } finally {
    if (button) button.disabled = false;
  }
}

const main = async (): Promise<void> => {
  await renderPopupMetrics();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes['allTime'] || changes['dailyHistory'] || changes['days'])) {
      void renderPopupMetrics();
    }
  });

  document.getElementById('ptx-force-scan')?.addEventListener('click', () => void forceScanActiveTab());
};

void main().catch((error: unknown) => {
  console.error('[MonkeyTax] Popup initialization failed:', error);
  setFeedback('Could not load saved receipts.', 'err');
});
