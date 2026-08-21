const KEY = 'userMuteChoice';

export type UserMuteChoices = Record<string, boolean>;
type TabChoices = Record<string, UserMuteChoices>;

// Every write rewrites the same blob, so all writers (any tab) serialize.
let writeChain: Promise<void> = Promise.resolve();

function enqueueWrite(write: () => Promise<void>): Promise<void> {
  const next = writeChain.then(write);
  writeChain = next.catch(() => {});
  return next;
}

export async function getAllUserMuteChoices(): Promise<TabChoices> {
  await writeChain;
  const stored = await browser.storage.session.get(KEY);
  return (stored[KEY] ?? {}) as TabChoices;
}

export async function rememberUserMuteChoice(
  tabId: number,
  hostname: string,
  muted: boolean,
): Promise<void> {
  await enqueueWrite(async () => {
    const stored = await browser.storage.session.get(KEY);
    const map = { ...((stored[KEY] ?? {}) as TabChoices) };
    const tabKey = String(tabId);
    await browser.storage.session.set({
      [KEY]: { ...map, [tabKey]: { ...(map[tabKey] ?? {}), [hostname]: muted } },
    });
  });
}

export async function clearUserMuteChoices(tabId: number): Promise<void> {
  await enqueueWrite(async () => {
    const stored = await browser.storage.session.get(KEY);
    const map = { ...((stored[KEY] ?? {}) as TabChoices) };
    delete map[String(tabId)];
    await browser.storage.session.set({ [KEY]: map });
  });
}