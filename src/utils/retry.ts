import { setTimeout as delay } from 'node:timers/promises';
export function retryDelay(attempt: number, base: number, random = Math.random): number {
  return Math.min(3_600_000, Math.round(base * 2 ** Math.max(0,attempt - 1) * (1 + random() * 0.25)));
}
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  try { await delay(ms, undefined, signal ? {signal} : {}); }
  catch (error) { if (!signal?.aborted) throw error; }
}
