const USER_MUTE_CHOICE_PREFIX = 'userMuteChoice:';

type UserMuteChoices = Record<string, boolean>;

// session holds the durable state; this map only serializes in-flight writes
// while the background context is alive.
const pendingWrites = new Map<number, Promise<void>>();

function userMuteChoiceKey(tabId: number): string {
  return `${USER_MUTE_CHOICE_PREFIX}${tabId}`;
}

function enqueueWrite(tabId: number, write: () => Promise<void>): Promise<void> {
  const previous = pendingWrites.get(tabId) ?? Promise.resolve();
  const next = previous.then(write);
  pendingWrites.set(tabId, next);
  void next.then(
    () => {
      if (pendingWrites.get(tabId) === next) pendingWrites.delete(tabId);
    },
    () => {
      if (pendingWrites.get(tabId) === next) pendingWrites.delete(tabId);
    },
  );
  return next;
}

export async function getUserMuteChoice(
  tabId: number,
  hostname: string,
): Promise<boolean | undefined> {
  await pendingWrites.get(tabId);
  const key = userMuteChoiceKey(tabId);
  const stored = await browser.storage.session.get(key);
  const choices = stored[key] as UserMuteChoices | undefined;
  return choices?.[hostname];
}

export async function rememberUserMuteChoice(
  tabId: number,
  hostname: string,
  muted: boolean,
): Promise<void> {
  await enqueueWrite(tabId, async () => {
    const key = userMuteChoiceKey(tabId);
    const stored = await browser.storage.session.get(key);
    const choices = (stored[key] as UserMuteChoices | undefined) ?? {};
    await browser.storage.session.set({
      [key]: { ...choices, [hostname]: muted },
    });
  });
}

export async function clearUserMuteChoices(tabId: number): Promise<void> {
  await enqueueWrite(tabId, async () => {
    await browser.storage.session.remove(userMuteChoiceKey(tabId));
  });
}
