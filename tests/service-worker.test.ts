import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Message = { type?: string; payload?: unknown };
type Response = Record<string, unknown>;
type Listener = (message: Message, sender: unknown, sendResponse: (response: Response) => void) => boolean | void;

describe('service worker storage', () => {
  let storage: Record<string, unknown>;
  let listener: Listener | undefined;
  let originalChrome: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.resetModules();
    storage = {};
    listener = undefined;
    originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (keys: readonly string[]) =>
            Object.fromEntries(keys.filter((key) => key in storage).map((key) => [key, storage[key]])),
          ),
          set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(storage, values); }),
        },
      },
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn((callback: Listener) => { listener = callback; }) },
      },
    } as unknown as typeof chrome);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
    else Reflect.deleteProperty(globalThis, 'chrome');
  });

  async function loadWorker(): Promise<void> {
    await import('../src/background/service-worker');
    if (!listener) throw new Error('Service worker did not register its message listener');
  }

  async function send(message: Message): Promise<Response> {
    if (!listener) throw new Error('Service worker listener is unavailable');
    return new Promise((resolve) => {
      listener?.(message, {}, resolve);
    });
  }

  it('migrates legacy totals and records a thread scan only once', async () => {
    storage['days'] = {
      '2026-10-25': { totalWaterMl: 20, totalEnergyWh: 4, totalPrompts: 2, politeTaxCount: 1 },
    };
    await loadWorker();

    const payload = {
      platform: 'gemini',
      threadId: 'thread-123',
      turns: 3,
      waterMl: 30,
      energyWh: 6,
      fillerCount: 2,
    };
    expect(await send({ type: 'PTX_RECORD_THREAD_SCAN', payload })).toMatchObject({ ok: true, duplicate: false });
    expect(await send({ type: 'PTX_RECORD_THREAD_SCAN', payload })).toMatchObject({ ok: true, duplicate: true });

    const dailyHistory = storage['dailyHistory'] as Record<string, { totalPrompts: number }>;
    const allTime = storage['allTime'] as { prompts: number; waterMl: number; energyWh: number; fillerCount: number };
    const fingerprints = storage['scannedThreadFingerprints'] as string[];
    expect(Object.values(dailyHistory).reduce((sum, day) => sum + day.totalPrompts, 0)).toBe(5);
    expect(allTime).toMatchObject({ prompts: 5, waterMl: 50, energyWh: 10, fillerCount: 3 });
    expect(fingerprints).toEqual(['gemini:thread-123']);
  });

  it('updates daily history and all-time totals for a live prompt', async () => {
    await loadWorker();
    expect(await send({
      type: 'prompt-tax:record',
      payload: { waterMl: 8, energyWh: 1.5, tier: 'GREETING', isRoast: true, platform: 'claude' },
    })).toMatchObject({ ok: true });

    const allTime = storage['allTime'] as { prompts: number; waterMl: number; energyWh: number; fillerCount: number };
    expect(allTime).toMatchObject({ prompts: 1, waterMl: 8, energyWh: 1.5, fillerCount: 1 });
  });
});