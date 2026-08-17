import { beforeEach, describe, expect, it, vi } from 'vitest';
import type browser from 'webextension-polyfill';

const mocks = vi.hoisted(() => {
  const browser = {
    tabs: {
      update: vi.fn(),
      sendMessage: vi.fn(),
      query: vi.fn(),
      get: vi.fn(),
      onUpdated: { addListener: vi.fn() },
      onActivated: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
    },
    runtime: {
      onMessage: { addListener: vi.fn() },
    },
    storage: {
      sync: {
        onChanged: { addListener: vi.fn() },
      },
    },
  };
  const autoMutedStore = {
    init: vi.fn(),
    snapshot: vi.fn(),
    touchEntry: vi.fn(),
  };
  const getUserMuteChoice = vi.fn();
  const rememberUserMuteChoice = vi.fn();
  const clearUserMuteChoices = vi.fn();
  return {
    browser,
    autoMutedStore,
    getUserMuteChoice,
    rememberUserMuteChoice,
    clearUserMuteChoices,
  };
});

vi.mock('webextension-polyfill', () => ({ default: mocks.browser }));
vi.mock('./storage/stores', () => ({ autoMutedStore: mocks.autoMutedStore }));
vi.mock('./storage/session', () => ({
  clearUserMuteChoices: mocks.clearUserMuteChoices,
  getUserMuteChoice: mocks.getUserMuteChoice,
  rememberUserMuteChoice: mocks.rememberUserMuteChoice,
}));

function makeTab(overrides: Partial<browser.Tabs.Tab>): browser.Tabs.Tab {
  return {
    index: 0,
    highlighted: true,
    active: true,
    pinned: false,
    incognito: false,
    ...overrides,
  };
}

describe('applyMuteToTab', () => {
  let applyMuteToTab: typeof import('./background').applyMuteToTab;

  async function establishNativeMuteSupport(): Promise<void> {
    await applyMuteToTab(
      makeTab({
        id: 99,
        url: 'https://example.com/probe',
        mutedInfo: { muted: false },
      }),
    );
    mocks.browser.tabs.update.mockClear();
    mocks.browser.tabs.sendMessage.mockClear();
    mocks.autoMutedStore.touchEntry.mockClear();
  }

  beforeEach(async () => {
    vi.stubGlobal('__BUILD_TARGET__', 'firefox');
    vi.resetModules();
    vi.clearAllMocks();
    mocks.autoMutedStore.init.mockResolvedValue(undefined);
    mocks.autoMutedStore.snapshot.mockReturnValue({
      'example.com': { enabled: true },
    });
    mocks.getUserMuteChoice.mockResolvedValue(undefined);
    mocks.browser.tabs.update.mockResolvedValue(undefined);
    mocks.browser.tabs.sendMessage.mockResolvedValue(undefined);
    mocks.browser.tabs.query.mockResolvedValue([]);
    ({ applyMuteToTab } = await import('./background'));
  });

  it('returns without touching the tab when it has no id', async () => {
    await applyMuteToTab(makeTab({ url: 'https://example.com/page' }));

    expect(mocks.browser.tabs.update).not.toHaveBeenCalled();
    expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('returns without touching the tab when its URL has no hostname', async () => {
    await applyMuteToTab(makeTab({ id: 1, url: 'not a URL' }));

    expect(mocks.browser.tabs.update).not.toHaveBeenCalled();
    expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('mutes an unmuted tab when the site is configured for auto mute', async () => {
    await applyMuteToTab(
      makeTab({
        id: 1,
        url: 'https://example.com/page',
        mutedInfo: { muted: false, reason: 'user' },
      }),
    );

    expect(mocks.browser.tabs.update).toHaveBeenCalledWith(1, { muted: true });
    expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
    expect(mocks.autoMutedStore.touchEntry).toHaveBeenCalledWith('example.com');
  });

  it('uses a user choice instead of the site auto-mute setting', async () => {
    mocks.getUserMuteChoice.mockResolvedValue(false);

    await applyMuteToTab(
      makeTab({
        id: 2,
        url: 'https://example.com/page',
        mutedInfo: { muted: true, reason: 'extension' },
      }),
    );

    expect(mocks.browser.tabs.update).toHaveBeenCalledWith(2, { muted: false });
    expect(mocks.autoMutedStore.touchEntry).not.toHaveBeenCalled();
  });

  it('uses native tab muting after support has been detected', async () => {
    await establishNativeMuteSupport();

    await applyMuteToTab(
      makeTab({
        id: 2,
        url: 'https://example.com/page',
        mutedInfo: { muted: false },
      }),
    );

    expect(mocks.browser.tabs.update).toHaveBeenCalledWith(2, { muted: true });
  });

  it('uses native tab unmuting for a remembered user choice', async () => {
    await establishNativeMuteSupport();
    mocks.getUserMuteChoice.mockResolvedValue(false);

    await applyMuteToTab(
      makeTab({
        id: 2,
        url: 'https://example.com/page',
        mutedInfo: { muted: true, reason: 'extension' },
      }),
    );

    expect(mocks.browser.tabs.update).toHaveBeenCalledWith(2, { muted: false });
    expect(mocks.autoMutedStore.touchEntry).not.toHaveBeenCalled();
  });

  it('honors a remembered mute choice even when auto mute is disabled', async () => {
    mocks.autoMutedStore.snapshot.mockReturnValue({});
    mocks.getUserMuteChoice.mockResolvedValue(true);

    await applyMuteToTab(
      makeTab({
        id: 2,
        url: 'https://example.com/page',
        mutedInfo: { muted: false },
      }),
    );

    expect(mocks.browser.tabs.update).toHaveBeenCalledWith(2, { muted: true });
    expect(mocks.autoMutedStore.touchEntry).toHaveBeenCalledWith('example.com');
  });

  it('pushes both mute states when native tab muting is unsupported', async () => {
    mocks.browser.tabs.update.mockRejectedValue(new Error('unsupported'));

    await applyMuteToTab(
      makeTab({
        id: 3,
        url: 'https://example.com/page',
        mutedInfo: { muted: false },
      }),
    );
    mocks.autoMutedStore.snapshot.mockReturnValue({});
    await applyMuteToTab(
      makeTab({
        id: 3,
        url: 'https://example.com/page',
        mutedInfo: { muted: false },
      }),
    );

    expect(mocks.browser.tabs.sendMessage).toHaveBeenNthCalledWith(1, 3, {
      type: 'vm:mute-state',
      muted: true,
    });
    expect(mocks.browser.tabs.sendMessage).toHaveBeenNthCalledWith(2, 3, {
      type: 'vm:mute-state',
      muted: false,
    });
  });

  it('pushes an unmute state when the initial native capability probe fails', async () => {
    mocks.getUserMuteChoice.mockResolvedValue(false);
    mocks.browser.tabs.update.mockRejectedValue(new Error('unsupported'));

    await applyMuteToTab(
      makeTab({
        id: 5,
        url: 'https://example.com/page',
        mutedInfo: { muted: true },
      }),
    );

    expect(mocks.browser.tabs.update).toHaveBeenCalledWith(5, { muted: false });
    expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(5, {
      type: 'vm:mute-state',
      muted: false,
    });
  });

  it('does not update a natively muted tab when its effective state is unchanged', async () => {
    mocks.browser.tabs.update.mockResolvedValue(undefined);

    await applyMuteToTab(
      makeTab({
        id: 4,
        url: 'https://example.com/page',
        mutedInfo: { muted: false },
      }),
    );
    mocks.browser.tabs.update.mockClear();

    await applyMuteToTab(
      makeTab({
        id: 4,
        url: 'https://example.com/page',
        mutedInfo: { muted: true, reason: 'extension' },
      }),
    );

    expect(mocks.browser.tabs.update).not.toHaveBeenCalled();
    expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
