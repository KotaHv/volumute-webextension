import { KEYS } from '../core/constants';

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const stored = await browser.storage.local.get(KEYS.deviceId);
  if (typeof stored[KEYS.deviceId] === 'string') {
    cached = stored[KEYS.deviceId] as string;
    return cached;
  }
  const id = crypto.randomUUID();
  cached = id;
  await browser.storage.local.set({ [KEYS.deviceId]: id });
  return id;
}
