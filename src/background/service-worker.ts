/**
 * MV3 service worker: rolling per-day aggregation in chrome.storage.local.
 *
 * Storage schema:
 *   { days: { "YYYY-MM-DD": { totalWaterMl, totalEnergyWh, totalPrompts,
 *                             politeTaxCount } } }
 * Powers the popup's daily summary / session receipts.
 */

export interface DayStats {
  totalWaterMl: number;
  totalEnergyWh: number;
  totalPrompts: number;
  politeTaxCount: number;
  fillerCount?: number;
}

export interface AllTimeStats {
  waterMl: number;
  energyWh: number;
  prompts: number;
  fillerCount: number;
}

export interface RecordPayload {
  waterMl: number;
  energyWh: number;
  tier: string;
  isRoast: boolean;
  platform: string;
}

export interface ThreadScanPayload {
  platform: string;
  threadId: string;
  turns: number;
  waterMl: number;
  energyWh: number;
  fillerCount: number;
}

const STORAGE_KEYS = ['days', 'dailyHistory', 'allTime', 'scannedThreadFingerprints'] as const;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function emptyDay(): DayStats {
  return { totalWaterMl: 0, totalEnergyWh: 0, totalPrompts: 0, politeTaxCount: 0, fillerCount: 0 };
}

function emptyAllTime(): AllTimeStats {
  return { waterMl: 0, energyWh: 0, prompts: 0, fillerCount: 0 };
}

function migrateDays(days: Record<string, DayStats>): Record<string, DayStats> {
  return Object.fromEntries(Object.entries(days).map(([date, day]) => [date, {
    ...emptyDay(),
    ...day,
    fillerCount: day.fillerCount ?? day.politeTaxCount ?? 0,
  }]));
}

function sumAllTime(history: Record<string, DayStats>): AllTimeStats {
  return Object.values(history).reduce((total, day) => ({
    waterMl: round4(total.waterMl + day.totalWaterMl),
    energyWh: round4(total.energyWh + day.totalEnergyWh),
    prompts: total.prompts + day.totalPrompts,
    fillerCount: total.fillerCount + (day.fillerCount ?? day.politeTaxCount),
  }), emptyAllTime());
}

async function readState(): Promise<{
  dailyHistory: Record<string, DayStats>;
  allTime: AllTimeStats;
  fingerprints: string[];
}> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  const legacyDays = (stored['days'] as Record<string, DayStats> | undefined) ?? {};
  const dailyHistory = migrateDays(
    (stored['dailyHistory'] as Record<string, DayStats> | undefined) ?? legacyDays,
  );
  const allTime = (stored['allTime'] as AllTimeStats | undefined) ?? sumAllTime(dailyHistory);
  const fingerprints = (stored['scannedThreadFingerprints'] as string[] | undefined) ?? [];
  return { dailyHistory, allTime: { ...emptyAllTime(), ...allTime }, fingerprints };
}

async function writeState(
  dailyHistory: Record<string, DayStats>,
  allTime: AllTimeStats,
  fingerprints: string[],
): Promise<void> {
  const days = Object.fromEntries(Object.entries(dailyHistory).map(([date, stats]) => {
    const { fillerCount: _fillerCount, ...legacyStats } = stats;
    return [date, legacyStats];
  }));
  await chrome.storage.local.set({ days, dailyHistory, allTime, scannedThreadFingerprints: fingerprints });
}

function addTotals(
  day: DayStats,
  allTime: AllTimeStats,
  totals: { turns: number; waterMl: number; energyWh: number; fillerCount: number },
): void {
  day.totalWaterMl = round4(day.totalWaterMl + totals.waterMl);
  day.totalEnergyWh = round4(day.totalEnergyWh + totals.energyWh);
  day.totalPrompts += totals.turns;
  day.politeTaxCount += totals.fillerCount;
  day.fillerCount = (day.fillerCount ?? 0) + totals.fillerCount;
  allTime.waterMl = round4(allTime.waterMl + totals.waterMl);
  allTime.energyWh = round4(allTime.energyWh + totals.energyWh);
  allTime.prompts += totals.turns;
  allTime.fillerCount += totals.fillerCount;
}

async function record(payload: RecordPayload): Promise<void> {
  const { dailyHistory, allTime, fingerprints } = await readState();
  const key = todayKey();
  const day = { ...emptyDay(), ...dailyHistory[key] };
  const fillerCount = payload.tier === 'POLITE' || payload.tier === 'GREETING' || payload.tier === 'LAZY_RETRY' ? 1 : 0;
  addTotals(day, allTime, { turns: 1, waterMl: payload.waterMl, energyWh: payload.energyWh, fillerCount });
  dailyHistory[key] = day;
  await writeState(dailyHistory, allTime, fingerprints);
}

async function recordThreadScan(payload: ThreadScanPayload): Promise<{ duplicate: boolean }> {
  const { dailyHistory, allTime, fingerprints } = await readState();
  const fingerprint = `${payload.platform}:${payload.threadId}`;
  if (fingerprints.includes(fingerprint)) return { duplicate: true };
  if (payload.turns <= 0) return { duplicate: false };

  const key = todayKey();
  const day = { ...emptyDay(), ...dailyHistory[key] };
  addTotals(day, allTime, {
    turns: payload.turns,
    waterMl: payload.waterMl,
    energyWh: payload.energyWh,
    fillerCount: payload.fillerCount,
  });
  dailyHistory[key] = day;
  fingerprints.push(fingerprint);
  if (fingerprints.length > 5000) fingerprints.splice(0, fingerprints.length - 5000);
  await writeState(dailyHistory, allTime, fingerprints);
  return { duplicate: false };
}

let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

chrome.runtime.onInstalled.addListener(async () => {
  const { dailyHistory, allTime, fingerprints } = await readState();
  await writeState(dailyHistory, allTime, fingerprints);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'prompt-tax:record' && message.payload) {
    void enqueueWrite(() => record(message.payload as RecordPayload))
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === 'PTX_RECORD_THREAD_SCAN' && message.payload) {
    void enqueueWrite(() => recordThreadScan(message.payload as ThreadScanPayload))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch(() => sendResponse({ ok: false, duplicate: false }));
    return true; // keep the message channel open for the async reply
  }
  return false;
});
