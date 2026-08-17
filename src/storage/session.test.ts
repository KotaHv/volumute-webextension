import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearUserMuteChoices, getUserMuteChoice, rememberUserMuteChoice } from './session';

type SessionData = Record<string, unknown>;
type SessionWrite = (items: Record<string, unknown>, data: SessionData) => Promise<void>;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeBrowser(write?: SessionWrite): { data: SessionData; browser: object } {
  const data: SessionData = {};
  const session = {
    get: async (key: string | string[] | null) => {
      const keys = key === null ? Object.keys(data) : Array.isArray(key) ? key : [key];
      const result: SessionData = {};
      for (const requestedKey of keys) {
        if (requestedKey in data) result[requestedKey] = data[requestedKey];
      }
      return result;
    },
    set: vi.fn(async (items: Record<string, unknown>) => {
      if (write) {
        await write(items, data);
      } else {
        Object.assign(data, items);
      }
    }),
    remove: vi.fn(async (key: string) => {
      delete data[key];
    }),
  };
  const browser = { storage: { session } };
  return { data, browser };
}

describe('session user mute choices', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores separate choices for each hostname in a tab', async () => {
    const { browser } = makeBrowser();
    vi.stubGlobal('browser', browser);

    await rememberUserMuteChoice(1, 'a.example', false);
    await rememberUserMuteChoice(1, 'b.example', true);

    await expect(getUserMuteChoice(1, 'a.example')).resolves.toBe(false);
    await expect(getUserMuteChoice(1, 'b.example')).resolves.toBe(true);
    await expect(getUserMuteChoice(1, 'c.example')).resolves.toBeUndefined();
  });

  it('serializes concurrent writes and preserves both hostnames', async () => {
    const firstSetStarted = deferred();
    const releaseFirstSet = deferred();
    let firstSet = true;
    const { browser, data } = makeBrowser(async (items, store) => {
      if (firstSet) {
        firstSet = false;
        firstSetStarted.resolve();
        await releaseFirstSet.promise;
      }
      Object.assign(store, items);
    });
    vi.stubGlobal('browser', browser);

    const firstWrite = rememberUserMuteChoice(2, 'a.example', false);
    await firstSetStarted.promise;
    const secondWrite = rememberUserMuteChoice(2, 'b.example', true);

    releaseFirstSet.resolve();
    await Promise.all([firstWrite, secondWrite]);

    expect(data['userMuteChoice:2']).toEqual({
      'a.example': false,
      'b.example': true,
    });
  });

  it('waits for an in-flight write before reading', async () => {
    const setStarted = deferred();
    const releaseSet = deferred();
    const { browser } = makeBrowser(async (items, data) => {
      setStarted.resolve();
      await releaseSet.promise;
      Object.assign(data, items);
    });
    vi.stubGlobal('browser', browser);

    const write = rememberUserMuteChoice(3, 'a.example', false);
    await setStarted.promise;
    const read = getUserMuteChoice(3, 'a.example');
    let readCompleted = false;
    void read.then(() => {
      readCompleted = true;
    });

    await Promise.resolve();
    expect(readCompleted).toBe(false);

    releaseSet.resolve();
    await write;
    await expect(read).resolves.toBe(false);
  });

  it('serializes cleanup after pending writes', async () => {
    const setStarted = deferred();
    const releaseSet = deferred();
    const { browser, data } = makeBrowser(async (items, store) => {
      setStarted.resolve();
      await releaseSet.promise;
      Object.assign(store, items);
    });
    vi.stubGlobal('browser', browser);

    const write = rememberUserMuteChoice(4, 'a.example', true);
    await setStarted.promise;
    const clear = clearUserMuteChoices(4);

    releaseSet.resolve();
    await Promise.all([write, clear]);

    expect(data['userMuteChoice:4']).toBeUndefined();
  });
});
