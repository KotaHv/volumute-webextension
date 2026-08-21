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
      onChanged: { addListener: vi.fn() },
      session: { get: vi.fn() },
    },
  };
  const storeFactory = () => ({
    init: vi.fn(),
    snapshot: vi.fn(),
    touchEntry: vi.fn(),
    update: vi.fn(async (_fn: unknown) => {}),
    onChange: vi.fn(() => () => {}),
  });
  const autoMutedStore = storeFactory();
  const siteVolumesStore = storeFactory();
  const pageVolumesStore = storeFactory();
  const getSettings = vi.fn();
  const getAllUserMuteChoices = vi.fn();
  const rememberUserMuteChoice = vi.fn(async () => {});
  const clearUserMuteChoices = vi.fn(async () => {});
  return {
    browser,
    autoMutedStore,
    siteVolumesStore,
    pageVolumesStore,
    getSettings,
    getAllUserMuteChoices,
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
  getAllUserMuteChoices: mocks.getAllUserMuteChoices,
  rememberUserMuteChoice: mocks.rememberUserMuteChoice,
}));
vi.mock('./storage/settings', () => ({
  getSettings: mocks.getSettings,
  subscribeSettings: vi.fn(() => () => {}),
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

function fireStorage(
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: 'sync' | 'local',
): void {
  const cb = mocks.browser.storage.onChanged.addListener.mock.calls[0]?.[0] as (
    changes: Record<string, unknown>,
    area: string,
  ) => void;
  cb(changes, areaName);
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
    mocks.getAllUserMuteChoices.mockResolvedValue({});
    mocks.browser.storage.session.get.mockResolvedValue({});
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
      mocks.getAllUserMuteChoices.mockResolvedValue({ '2': { 'example.com': false } });

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
      mocks.getAllUserMuteChoices.mockResolvedValue({ '2': { 'example.com': false } });
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
      mocks.getAllUserMuteChoices.mockResolvedValue({ '2': { 'example.com': true } });

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

    it('delivers fallback mute through a gain 0 push when the probe fails', async () => {
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

      expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(3, {
        type: 'vm:volume',
        volume: 0,
      });
    });

    it('does not touch when unmuting via a user choice in fallback mode', async () => {
      mocks.browser.tabs.update.mockRejectedValue(new Error('unsupported'));
      mocks.getAllUserMuteChoices.mockResolvedValue({ '5': { 'example.com': false } });
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

    it('does not unmute a tab muted by the browser or the user', async () => {
      await applyMuteToTab(
        makeTab({
          id: 6,
          url: 'https://example.com/page',
          mutedInfo: { muted: true, reason: 'user' },
        }),
      );

      expect(mocks.browser.tabs.update).not.toHaveBeenCalled();
    });

    it('does not unmute a tab muted for capture', async () => {
      await applyMuteToTab(
        makeTab({
          id: 7,
          url: 'https://example.com/page',
          mutedInfo: { muted: true, reason: 'capture' },
        }),
      );

      expect(mocks.browser.tabs.update).not.toHaveBeenCalled();
    });

    it('unmutes a tab the extension muted when its rule no longer applies', async () => {
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'example.com': { enabled: true },
      });
      await applyMuteToTab(
        makeTab({
          id: 8,
          url: 'https://example.com/page',
          mutedInfo: { muted: false },
        }),
      );
      mocks.browser.tabs.update.mockClear();
      mocks.autoMutedStore.snapshot.mockReturnValue({});

      await applyMuteToTab(
        makeTab({
          id: 8,
          url: 'https://example.com/page',
          mutedInfo: { muted: true, reason: 'extension' },
        }),
      );

      expect(mocks.browser.tabs.update).toHaveBeenCalledWith(8, { muted: false });
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
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'probe.test': { enabled: true },
      });
      await applyMuteToTab(
        makeTab({
          id: 99,
          url: 'https://probe.test/x',
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
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(9),
      });
      fireStorage(
        { settings: { oldValue: { maxMultiplier: 5 }, newValue: { maxMultiplier: 3 } } },
        'sync',
      );
      await flush();
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

  describe('storage.onChanged dispatch', () => {
    it('sweeps all tabs on startup', async () => {
      expect(mocks.browser.tabs.query).toHaveBeenCalledWith({});
    });

    it('recomputes only tabs matching a changed site volume', async () => {
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(0.7),
      });
      mocks.browser.tabs.query.mockResolvedValue([
        makeTab({ id: 1, url: 'https://example.com/a', mutedInfo: { muted: false } }),
        makeTab({ id: 2, url: 'https://other.test/b', mutedInfo: { muted: false } }),
      ]);

      fireStorage(
        {
          siteVolumes: {
            oldValue: {},
            newValue: { 'example.com': vol(0.7) },
          },
        },
        'local',
      );
      await flush();

      expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: 'vm:volume',
        volume: 0.7,
      });
      expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalledWith(2, expect.anything());
      expect(mocks.siteVolumesStore.touchEntry).not.toHaveBeenCalled();
    });

    it('recomputes only tabs matching a changed page volume', async () => {
      mocks.pageVolumesStore.snapshot.mockReturnValue({
        'https://example.com/a': vol(0.4),
      });
      mocks.browser.tabs.query.mockResolvedValue([
        makeTab({ id: 1, url: 'https://example.com/a', mutedInfo: { muted: false } }),
        makeTab({ id: 2, url: 'https://example.com/b', mutedInfo: { muted: false } }),
      ]);

      fireStorage(
        {
          pageVolumes: {
            oldValue: {},
            newValue: { 'https://example.com/a': vol(0.4) },
          },
        },
        'local',
      );
      await flush();

      expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: 'vm:volume',
        volume: 0.4,
      });
      expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalledWith(2, expect.anything());
    });

    it('applies mute only to an affected tab on auto-mute changes', async () => {
      mocks.browser.tabs.query.mockResolvedValue([
        makeTab({ id: 1, url: 'https://example.com/a', mutedInfo: { muted: false } }),
        makeTab({ id: 2, url: 'https://other.test/b', mutedInfo: { muted: false } }),
      ]);

      fireStorage(
        {
          autoMuted: {
            oldValue: {},
            newValue: { 'example.com': { enabled: true, created: 1, lastUsed: 1, deviceId: 'd' } },
          },
        },
        'sync',
      );
      await flush();

      expect(mocks.browser.tabs.update).toHaveBeenCalledWith(1, { muted: true });
      expect(mocks.browser.tabs.update).not.toHaveBeenCalledWith(2, expect.anything());
    });

    it('mutes from the diff value without re-reading the mute store', async () => {
      mocks.browser.tabs.query.mockResolvedValue([
        makeTab({ id: 1, url: 'https://example.com/a', mutedInfo: { muted: false } }),
      ]);

      fireStorage(
        {
          autoMuted: {
            oldValue: {},
            newValue: { 'example.com': { enabled: true, created: 1, lastUsed: 1, deviceId: 'd' } },
          },
        },
        'sync',
      );
      await flush();

      expect(mocks.browser.tabs.update).toHaveBeenCalledWith(1, { muted: true });
    });

    it('reads session once and touches a hostname once for many tabs on it', async () => {
      mocks.browser.tabs.query.mockResolvedValue([
        makeTab({ id: 1, url: 'https://example.com/a', mutedInfo: { muted: false } }),
        makeTab({ id: 2, url: 'https://example.com/b', mutedInfo: { muted: false } }),
        makeTab({ id: 3, url: 'https://other.test/c', mutedInfo: { muted: false } }),
      ]);
      mocks.getAllUserMuteChoices.mockClear();

      fireStorage(
        {
          autoMuted: {
            oldValue: {},
            newValue: { 'example.com': { enabled: true, created: 1, lastUsed: 1, deviceId: 'd' } },
          },
        },
        'sync',
      );
      await flush();

      expect(mocks.getAllUserMuteChoices).toHaveBeenCalledTimes(1);
      expect(mocks.browser.tabs.update).toHaveBeenCalledTimes(2);
      expect(mocks.autoMutedStore.touchEntry).toHaveBeenCalledTimes(1);
      expect(mocks.autoMutedStore.touchEntry).toHaveBeenCalledWith('example.com');
    });

    it('pushes gain 0 in fallback mode when a site is auto-muted', async () => {
      mocks.browser.tabs.update.mockRejectedValue(new Error('unsupported'));
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'probe.test': { enabled: true },
      });
      await applyMuteToTab(
        makeTab({ id: 99, url: 'https://probe.test/x', mutedInfo: { muted: false } }),
      );
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'example.com': { enabled: true },
      });
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(0.5),
      });
      mocks.browser.tabs.query.mockResolvedValue([
        makeTab({ id: 1, url: 'https://example.com/a', mutedInfo: { muted: false } }),
        makeTab({ id: 2, url: 'https://example.com/b', mutedInfo: { muted: false } }),
      ]);
      mocks.getAllUserMuteChoices.mockClear();
      mocks.browser.tabs.sendMessage.mockClear();

      fireStorage(
        {
          autoMuted: {
            oldValue: {},
            newValue: { 'example.com': { enabled: true, created: 1, lastUsed: 1, deviceId: 'd' } },
          },
        },
        'sync',
      );
      await flush();

      expect(mocks.getAllUserMuteChoices).toHaveBeenCalledTimes(1);
      expect(mocks.browser.tabs.sendMessage).toHaveBeenNthCalledWith(1, 1, {
        type: 'vm:volume',
        volume: 0,
      });
      expect(mocks.browser.tabs.sendMessage).toHaveBeenNthCalledWith(2, 2, {
        type: 'vm:volume',
        volume: 0,
      });
    });

    it('restores the gain after a fallback mute when the site auto-mute is disabled', async () => {
      mocks.browser.tabs.update.mockRejectedValue(new Error('unsupported'));
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'probe.test': { enabled: true },
      });
      await applyMuteToTab(
        makeTab({ id: 99, url: 'https://probe.test/x', mutedInfo: { muted: false } }),
      );
      mocks.autoMutedStore.snapshot.mockReturnValue({});
      mocks.browser.tabs.query.mockResolvedValue([
        makeTab({ id: 1, url: 'https://example.com/a', mutedInfo: { muted: false } }),
      ]);
      mocks.getAllUserMuteChoices.mockClear();

      fireStorage(
        {
          autoMuted: {
            oldValue: { 'example.com': { enabled: true, created: 1, lastUsed: 1, deviceId: 'd' } },
            newValue: {},
          },
        },
        'sync',
      );
      await flush();

      expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: 'vm:volume',
        volume: 1,
      });
    });

    it('skips volume pushes for tabs muted in fallback mode', async () => {
      mocks.browser.tabs.update.mockRejectedValue(new Error('unsupported'));
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'probe.test': { enabled: true },
      });
      await applyMuteToTab(
        makeTab({ id: 99, url: 'https://probe.test/x', mutedInfo: { muted: false } }),
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
      mocks.getAllUserMuteChoices.mockClear();
      mocks.browser.tabs.sendMessage.mockClear();

      fireStorage(
        { siteVolumes: { oldValue: {}, newValue: { 'example.com': vol(0.5) } } },
        'local',
      );
      await flush();

      expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('pushes volume for an unmuted tab in fallback mode', async () => {
      mocks.browser.tabs.update.mockRejectedValue(new Error('unsupported'));
      mocks.autoMutedStore.snapshot.mockReturnValue({
        'probe.test': { enabled: true },
      });
      await applyMuteToTab(
        makeTab({ id: 99, url: 'https://probe.test/x', mutedInfo: { muted: false } }),
      );
      mocks.autoMutedStore.snapshot.mockReturnValue({});
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(0.5),
      });
      mocks.browser.tabs.query.mockResolvedValue([
        makeTab({ id: 1, url: 'https://example.com/a', mutedInfo: { muted: false } }),
      ]);
      mocks.getAllUserMuteChoices.mockClear();

      fireStorage(
        { siteVolumes: { oldValue: {}, newValue: { 'example.com': vol(0.5) } } },
        'local',
      );
      await flush();

      expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: 'vm:volume',
        volume: 0.5,
      });
    });

    it('writes back over-limit entries when maxMultiplier is lowered', async () => {
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(9),
        'other.test': vol(2),
      });
      mocks.pageVolumesStore.snapshot.mockReturnValue({});
      mocks.browser.tabs.query.mockResolvedValue([]);

      fireStorage(
        { settings: { oldValue: { maxMultiplier: 5 }, newValue: { maxMultiplier: 3 } } },
        'sync',
      );
      await flush();

      expect(mocks.siteVolumesStore.update).toHaveBeenCalledTimes(1);
      const fn = mocks.siteVolumesStore.update.mock.calls[0]?.[0] as unknown as (
        m: Record<string, VolumeEntry>,
      ) => Record<string, VolumeEntry>;
      const next = fn({ 'example.com': vol(9), 'other.test': vol(2) });
      expect(next['example.com']?.multiplier).toBe(3);
      expect(next['other.test']?.multiplier).toBe(2);
      expect(mocks.pageVolumesStore.update).not.toHaveBeenCalled();
    });

    it('pushes the corrected value via the volume event after the write-back', async () => {
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(3),
      });
      mocks.browser.tabs.query.mockResolvedValue([
        makeTab({ id: 1, url: 'https://example.com/a', mutedInfo: { muted: false } }),
      ]);

      // This is the storage.onChanged fired by applyMaxClamp's own write-back;
      // the volume module handles the push on its own.
      fireStorage(
        {
          siteVolumes: {
            oldValue: { 'example.com': vol(9) },
            newValue: { 'example.com': vol(3) },
          },
        },
        'local',
      );
      await flush();

      expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: 'vm:volume',
        volume: 3,
      });
    });

    it('writes nothing when lowering maxMultiplier with no over-limit entries', async () => {
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(2),
      });
      mocks.pageVolumesStore.snapshot.mockReturnValue({});
      mocks.browser.tabs.query.mockResolvedValue([]);

      fireStorage(
        { settings: { oldValue: { maxMultiplier: 5 }, newValue: { maxMultiplier: 3 } } },
        'sync',
      );
      await flush();

      expect(mocks.siteVolumesStore.update).not.toHaveBeenCalled();
      expect(mocks.pageVolumesStore.update).not.toHaveBeenCalled();
      expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('does nothing when maxMultiplier is raised (values already legal)', async () => {
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(3),
      });
      fireStorage(
        { settings: { oldValue: { maxMultiplier: 3 }, newValue: { maxMultiplier: 5 } } },
        'sync',
      );
      await flush();

      expect(mocks.siteVolumesStore.update).not.toHaveBeenCalled();
      expect(mocks.pageVolumesStore.update).not.toHaveBeenCalled();
      expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('clamps existing entries when settings are first created with a lower max', async () => {
      mocks.siteVolumesStore.snapshot.mockReturnValue({
        'example.com': vol(9),
        'other.test': vol(2),
      });
      mocks.pageVolumesStore.snapshot.mockReturnValue({});
      mocks.browser.tabs.query.mockResolvedValue([]);

      fireStorage(
        { settings: { oldValue: undefined, newValue: { maxMultiplier: 3 } } },
        'sync',
      );
      await flush();

      expect(mocks.siteVolumesStore.update).toHaveBeenCalledTimes(1);
      const fn = mocks.siteVolumesStore.update.mock.calls[0]?.[0] as unknown as (
        m: Record<string, VolumeEntry>,
      ) => Record<string, VolumeEntry>;
      const next = fn({ 'example.com': vol(9), 'other.test': vol(2) });
      expect(next['example.com']?.multiplier).toBe(3);
      expect(next['other.test']?.multiplier).toBe(2);
      expect(mocks.pageVolumesStore.update).not.toHaveBeenCalled();
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