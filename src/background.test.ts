import { beforeEach, describe, expect, it, vi } from 'vitest';
import type browser from 'webextension-polyfill';
import type { Settings, VolumeEntry } from './core/types';

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
  const storeFactory = () => ({
    init: vi.fn(),
    snapshot: vi.fn(),
    touchEntry: vi.fn(),
    onChange: vi.fn((_cb: () => void) => () => {}),
  });
  const autoMutedStore = storeFactory();
  const siteVolumesStore = storeFactory();
  const pageVolumesStore = storeFactory();
  const getSettings = vi.fn();
  const subscribeSettings = vi.fn((_cb: (s: Settings) => void) => () => {});
  const getUserMuteChoice = vi.fn();
  const rememberUserMuteChoice = vi.fn(async () => {});
  const clearUserMuteChoices = vi.fn(async () => {});
  return {
    browser,
    autoMutedStore,
    siteVolumesStore,
    pageVolumesStore,
    getSettings,
    subscribeSettings,
    getUserMuteChoice,
    rememberUserMuteChoice,
    clearUserMuteChoices,
  };
});

vi.mock('webextension-polyfill', () => ({ default: mocks.browser }));
vi.mock('./storage/stores', () => ({
  autoMutedStore: mocks.autoMutedStore,
  siteVolumesStore: mocks.siteVolumesStore,
  pageVolumesStore: mocks.pageVolumesStore,
}));
vi.mock('./storage/session', () => ({
  clearUserMuteChoices: mocks.clearUserMuteChoices,
  getUserMuteChoice: mocks.getUserMuteChoice,
  rememberUserMuteChoice: mocks.rememberUserMuteChoice,
}));
vi.mock('./storage/settings', () => ({
  getSettings: mocks.getSettings,
  subscribeSettings: mocks.subscribeSettings,
  updateSettings: vi.fn(),
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

function makeSender(tabId?: number, url?: string): browser.Runtime.MessageSender {
  return {
    tab: tabId === undefined ? undefined : { id: tabId, url },
  } as browser.Runtime.MessageSender;
}

function vol(multiplier: number): VolumeEntry {
  return { multiplier, created: 0, lastUsed: 0 };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function getMessageHandler(): (
  message: unknown,
  sender: browser.Runtime.MessageSender,
) => Promise<unknown> {
  return mocks.browser.runtime.onMessage.addListener.mock.calls[0]?.[0] as (
    message: unknown,
    sender: browser.Runtime.MessageSender,
  ) => Promise<unknown>;
}

function getOnUpdated(): (
  tabId: number,
  changeInfo: browser.Tabs.OnUpdatedChangeInfoType,
  tab: browser.Tabs.Tab,
) => void {
  return mocks.browser.tabs.onUpdated.addListener.mock.calls[0]?.[0] as (
    tabId: number,
    changeInfo: browser.Tabs.OnUpdatedChangeInfoType,
    tab: browser.Tabs.Tab,
  ) => void;
}

describe('background entry', () => {
  let applyMuteToTab: typeof import('./background/mute').applyMuteToTab;
  const defaultSettings: Settings = { lang: 'auto', theme: 'auto', maxMultiplier: 5 };

  beforeEach(async () => {
    vi.stubGlobal('__BUILD_TARGET__', 'firefox');
    vi.resetModules();
    vi.clearAllMocks();
    mocks.autoMutedStore.init.mockResolvedValue(undefined);
    mocks.autoMutedStore.snapshot.mockReturnValue({});
    mocks.siteVolumesStore.init.mockResolvedValue(undefined);
    mocks.siteVolumesStore.snapshot.mockReturnValue({});
    mocks.pageVolumesStore.init.mockResolvedValue(undefined);
    mocks.pageVolumesStore.snapshot.mockReturnValue({});
    mocks.getSettings.mockResolvedValue(defaultSettings);
    mocks.getUserMuteChoice.mockResolvedValue(undefined);
    mocks.browser.tabs.update.mockResolvedValue(undefined);
    mocks.browser.tabs.sendMessage.mockResolvedValue(undefined);
    mocks.browser.tabs.query.mockResolvedValue([]);
    await import('./background/index');
    ({ applyMuteToTab } = await import('./background/mute'));
  });

  describe('applyMuteToTab', () => {
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
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'example.com': { enabled: true },
      });

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
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'example.com': { enabled: true },
      });
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
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'example.com': { enabled: true },
      });

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
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'example.com': { enabled: true },
      });

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

    it('does not update a natively muted tab when its effective state is unchanged', async () => {
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'example.com': { enabled: true },
      });
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

    it('stops pushing mute messages when native tab muting is unsupported', async () => {
      mocks.browser.tabs.update.mockRejectedValue(new Error('unsupported'));
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'example.com': { enabled: true },
      });

      await applyMuteToTab(
        makeTab({
          id: 3,
          url: 'https://example.com/page',
          mutedInfo: { muted: false },
        }),
      );
      mocks.autoMutedStore.snapshot.mockReturnValue({});
      mocks.browser.tabs.sendMessage.mockClear();
      await applyMuteToTab(
        makeTab({
          id: 3,
          url: 'https://example.com/page',
          mutedInfo: { muted: false },
        }),
      );

      expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('does not touch when unmuting via a user choice in fallback mode', async () => {
      mocks.browser.tabs.update.mockRejectedValue(new Error('unsupported'));
      mocks.getUserMuteChoice.mockResolvedValue(false);
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'example.com': { enabled: true },
      });

      await applyMuteToTab(
        makeTab({
          id: 5,
          url: 'https://example.com/page',
          mutedInfo: { muted: true },
        }),
      );

      expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
      expect(mocks.autoMutedStore.touchEntry).not.toHaveBeenCalled();
    });
  });

  describe('vm:volume-query', () => {
    it('answers with the default volume while no entries exist', async () => {
      const handler = getMessageHandler();

      await expect(
        handler({ type: 'vm:volume-query' }, makeSender(1, 'https://example.com/page')),
      ).resolves.toEqual({ volume: 1 });
    });

    it('answers with the stored site multiplier', async () => {
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(0.5),
      });
      const handler = getMessageHandler();

      await expect(
        handler({ type: 'vm:volume-query' }, makeSender(1, 'https://example.com/page')),
      ).resolves.toEqual({ volume: 0.5 });
    });

    it('keeps the multiplier for a muted tab while native muting is available', async () => {
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'example.com': { enabled: true },
      });
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(0.5),
      });
      const handler = getMessageHandler();

      await expect(
        handler({ type: 'vm:volume-query' }, makeSender(1, 'https://example.com/page')),
      ).resolves.toEqual({ volume: 0.5 });
    });

    it('answers with gain 0 for a muted tab in fallback mode', async () => {
      mocks.browser.tabs.update.mockRejectedValue(new Error('unsupported'));
      await applyMuteToTab(
        makeTab({
          id: 99,
          url: 'https://example.com/probe',
          mutedInfo: { muted: false },
        }),
      );
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'example.com': { enabled: true },
      });
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(0.5),
      });
      const handler = getMessageHandler();

      await expect(
        handler({ type: 'vm:volume-query' }, makeSender(1, 'https://example.com/page')),
      ).resolves.toEqual({ volume: 0 });
    });

    it('falls back to the sender URL and answers the default volume without a tab', async () => {
      const handler = getMessageHandler();

      await expect(
        handler({ type: 'vm:volume-query' }, makeSender(undefined, 'https://frame.com/x')),
      ).resolves.toEqual({ volume: 1 });
      await expect(handler({ type: 'vm:volume-query' }, makeSender())).resolves.toEqual({
        volume: 1,
      });
    });

    it('clamps the answer to the configured maximum multiplier', async () => {
      const onSettings = mocks.subscribeSettings.mock.calls[0]?.[0] as unknown as (
        s: Settings,
      ) => void;
      onSettings({ ...defaultSettings, maxMultiplier: 3 });
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(9),
      });
      const handler = getMessageHandler();

      await expect(
        handler({ type: 'vm:volume-query' }, makeSender(1, 'https://example.com/page')),
      ).resolves.toEqual({ volume: 3 });
    });

    it('ignores unrelated message types', async () => {
      const handler = getMessageHandler();

      await expect(handler({ type: 'other' }, makeSender(1, 'https://example.com/'))).resolves.toBe(
        undefined,
      );
    });
  });

  describe('volume redistribution', () => {
    it('sweeps all tabs on startup', async () => {
      expect(mocks.browser.tabs.query).toHaveBeenCalledWith({});
    });

    it('pushes the default volume on a tab URL change without touching site entries', async () => {
      mocks.browser.tabs.sendMessage.mockClear();
      const onUpdated = getOnUpdated();

      onUpdated(1, { url: 'https://example.com/new' }, makeTab({ id: 1, url: 'https://example.com/new' }));

      await flush();

      expect(mocks.siteVolumesStore.touchEntry).not.toHaveBeenCalled();
      expect(mocks.pageVolumesStore.touchEntry).not.toHaveBeenCalled();
      expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: 'vm:volume',
        volume: 1,
      });
    });

    it('touches the page entry on a URL change when a page volume exists', async () => {
      mocks.pageVolumesStore.snapshot.mockReturnValue({
        'https://example.com/new': vol(0.4),
      });
      const onUpdated = getOnUpdated();

      onUpdated(1, { url: 'https://example.com/new' }, makeTab({ id: 1, url: 'https://example.com/new' }));

      await flush();

      expect(mocks.pageVolumesStore.touchEntry).toHaveBeenCalledWith('https://example.com/new');
      expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: 'vm:volume',
        volume: 0.4,
      });
    });

    it('touches the site entry on a URL change when only a site volume exists', async () => {
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(0.6),
      });
      const onUpdated = getOnUpdated();

      onUpdated(1, { url: 'https://example.com/new' }, makeTab({ id: 1, url: 'https://example.com/new' }));

      await flush();

      expect(mocks.siteVolumesStore.touchEntry).toHaveBeenCalledWith('example.com');
    });

    it('recomputes all tabs without touching when a volume entry changes', async () => {
      const onSiteVolumes = mocks.siteVolumesStore.onChange.mock.calls[0]?.[0] as unknown as () => void;
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(0.7),
      });
      mocks.browser.tabs.query.mockResolvedValue([
        makeTab({ id: 1, url: 'https://example.com/a', mutedInfo: { muted: false } }),
      ]);

      onSiteVolumes();
      await flush();

      expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: 'vm:volume',
        volume: 0.7,
      });
      expect(mocks.siteVolumesStore.touchEntry).not.toHaveBeenCalled();
    });

    it('recomputes on auto-mute changes', async () => {
      const onAutoMuted = mocks.autoMutedStore.onChange.mock.calls[0]?.[0] as unknown as () => void;
      mocks.browser.tabs.query.mockResolvedValue([
        makeTab({ id: 1, url: 'https://example.com/a', mutedInfo: { muted: false } }),
      ]);

      onAutoMuted();
      await flush();

      expect(mocks.browser.tabs.query).toHaveBeenCalled();
      expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: 'vm:volume',
        volume: 1,
      });
    });

    it('recomputes with the new maximum multiplier on settings changes', async () => {
      const onSettings = mocks.subscribeSettings.mock.calls[0]?.[0] as unknown as (s: Settings) => void;
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(9),
      });
      mocks.browser.tabs.query.mockResolvedValue([
        makeTab({ id: 1, url: 'https://example.com/a', mutedInfo: { muted: false } }),
      ]);

      onSettings({ ...defaultSettings, maxMultiplier: 3 });
      await flush();

      expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: 'vm:volume',
        volume: 3,
      });
    });

    it('merges store changes fired together into a single sweep', async () => {
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(0.4),
      });
      mocks.pageVolumesStore.snapshot.mockReturnValue({
        'https://example.com/a': vol(0.6),
      });
      mocks.browser.tabs.query.mockResolvedValue([
        makeTab({ id: 1, url: 'https://example.com/a', mutedInfo: { muted: false } }),
      ]);
      mocks.browser.tabs.query.mockClear();
      mocks.browser.tabs.sendMessage.mockClear();

      const onSiteVolumes = mocks.siteVolumesStore.onChange.mock.calls[0]?.[0] as unknown as () => void;
      const onPageVolumes = mocks.pageVolumesStore.onChange.mock.calls[0]?.[0] as unknown as () => void;
      onSiteVolumes();
      onPageVolumes();
      await flush();

      expect(mocks.browser.tabs.query).toHaveBeenCalledTimes(1);
      expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledTimes(1);
      expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: 'vm:volume',
        volume: 0.6,
      });
    });

    it('serializes sweeps and reruns once with the newest state when a change arrives mid-sweep', async () => {
      const tabs = [makeTab({ id: 1, url: 'https://example.com/a', mutedInfo: { muted: false } })];
      let releaseFirstQuery!: (value?: unknown) => void;
      mocks.browser.tabs.query
        .mockImplementationOnce(
          () => new Promise((resolve) => (releaseFirstQuery = resolve)),
        )
        .mockResolvedValue(tabs);
      mocks.browser.tabs.query.mockClear();
      mocks.browser.tabs.sendMessage.mockClear();

      const onAutoMuted = mocks.autoMutedStore.onChange.mock.calls[0]?.[0] as unknown as () => void;
      onAutoMuted();
      await flush();
      // The sweep is parked inside tabs.query; a change arriving here must not
      // start a concurrent sweep.
      expect(mocks.browser.tabs.query).toHaveBeenCalledTimes(1);
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'example.com': { enabled: true },
      });
      onAutoMuted();
      expect(mocks.browser.tabs.query).toHaveBeenCalledTimes(1);

      releaseFirstQuery(tabs);
      await flush();

      expect(mocks.browser.tabs.query).toHaveBeenCalledTimes(2);
      expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledTimes(2);
      expect(mocks.browser.tabs.sendMessage).toHaveBeenLastCalledWith(1, {
        type: 'vm:volume',
        volume: 1,
      });
    });

    it('pushes gain 0 in fallback mode when a site becomes auto-muted', async () => {
      mocks.browser.tabs.update.mockRejectedValue(new Error('unsupported'));
      await applyMuteToTab(
        makeTab({
          id: 99,
          url: 'https://example.com/probe',
          mutedInfo: { muted: false },
        }),
      );
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'example.com': { enabled: true },
      });
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(0.5),
      });
      mocks.browser.tabs.query.mockResolvedValue([
        makeTab({ id: 1, url: 'https://example.com/a', mutedInfo: { muted: false } }),
      ]);

      const onAutoMuted = mocks.autoMutedStore.onChange.mock.calls[0]?.[0] as unknown as () => void;
      onAutoMuted();
      await flush();

      expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: 'vm:volume',
        volume: 0,
      });
    });
  });

  describe('tab events', () => {
    it('remembers manual user mute choices from mutedInfo changes', async () => {
      const onUpdated = getOnUpdated();

      onUpdated(
        7,
        { mutedInfo: { muted: true, reason: 'user' } },
        makeTab({ id: 7, url: 'https://example.com/page', mutedInfo: { muted: true, reason: 'user' } }),
      );

      expect(mocks.rememberUserMuteChoice).toHaveBeenCalledWith(7, 'example.com', true);
    });

    it('clears user mute choices when a tab is removed', async () => {
      const onRemoved = mocks.browser.tabs.onRemoved.addListener.mock.calls[0]?.[0] as (
        tabId: number,
      ) => void;

      onRemoved(9);

      expect(mocks.clearUserMuteChoices).toHaveBeenCalledWith(9);
    });
  });
});