import { schemaVersionKey } from "../core/constants";
import { migrateMap } from "../core/migrate";

const DEBOUNCE_MS = 300;
const WRITE_RETRY_DELAY_MS = 1000;
const MAX_WRITE_ATTEMPTS = 20;

export interface TimedEntry {
  lastUsed?: number;
}

export type EntryMap<T> = Record<string, T>;

function lastUsed<T extends TimedEntry>(e: T): number {
  return e.lastUsed ?? 0;
}

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /quota|QUOTA/i.test(msg);
}

function isWriteRateError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /max_writes|too many write|MAX_WRITE|write operation/i.test(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class KVStore<T extends TimedEntry> {
  private cache: EntryMap<T> = {};
  private loaded = false;
  private initPromise: Promise<void> | null = null;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private writePromise: Promise<void> = Promise.resolve();
  private subscribers = new Set<(value: EntryMap<T>) => void>();

  constructor(
    private readonly area: "sync" | "local",
    private readonly key: string,
    private readonly merge: (
      cache: EntryMap<T>,
      fresh: EntryMap<T> | undefined,
    ) => EntryMap<T> = (c, f) => ({ ...f, ...c }),
    private readonly migrations?: Record<
      number,
      (map: EntryMap<T>) => EntryMap<T>
    >,
    private readonly schemaVersion = 2,
  ) {}

  init(): Promise<void> {
    this.initPromise ??= this.doInit().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    if (this.loaded) return;
    const area = browser.storage[this.area];
    const versionKey = schemaVersionKey(this.key);
    const stored = await area.get([this.key, versionKey]);
    let data = mergeFresh(
      {},
      (stored[this.key] ?? {}) as EntryMap<T> | undefined,
    );
    const storedVersion =
      (stored[versionKey] as number | undefined) ?? 1;
    if (storedVersion < this.schemaVersion) {
      const migrated = migrateMap(
        this.migrations ?? {},
        data,
        storedVersion,
        this.schemaVersion,
      );
      if (migrated !== null) {
        data = migrated;
        try {
          await area.set({
            [this.key]: data,
            [versionKey]: this.schemaVersion,
          });
        } catch (err) {
          console.warn(
            `[KVStore] migration write failed for ${this.area}:${this.key}`,
            err,
          );
        }
      } else {
        console.warn(
          `[KVStore] no migration path from v${storedVersion} to v${this.schemaVersion} for ${this.area}:${this.key}`,
        );
      }
    }
    this.cache = data;
    this.loaded = true;
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== this.area || !(this.key in changes)) return;
      const change = changes[this.key];
      if (!change) return;
      const fresh = (change.newValue ?? {}) as EntryMap<T> | undefined;
      this.cache = mergeFresh(this.cache, fresh);
      this.emit();
    });
  }

  snapshot(): EntryMap<T> {
    return { ...this.cache };
  }

  async reload(): Promise<void> {
    if (!this.loaded) return this.init();
    const fresh = ((await browser.storage[this.area].get(this.key))[this.key] ??
      {}) as EntryMap<T> | undefined;
    this.cache = mergeFresh(this.cache, fresh);
    this.emit();
  }

  onChange(cb: (value: EntryMap<T>) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const cb of this.subscribers) cb(snap);
  }

  async update(
    fn: (cache: EntryMap<T>) => EntryMap<T>,
    opts: { immediate?: boolean } = {},
  ): Promise<void> {
    if (!this.loaded) await this.init();
    const fresh = ((await browser.storage[this.area].get(this.key))[this.key] ??
      {}) as EntryMap<T> | undefined;
    this.cache = this.merge(this.cache, fresh);
    this.cache = fn(this.cache);
    this.emit();
    if (opts.immediate) {
      if (this.writeTimer) {
        clearTimeout(this.writeTimer);
        this.writeTimer = null;
      }
      return this.doWrite();
    }
    this.scheduleWrite();
  }

  flushPending(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
      return this.doWrite();
    }
    return this.writePromise;
  }

  async touchEntry(entryKey: string): Promise<void> {
    if (!this.loaded) await this.init();
    const area = browser.storage[this.area];
    this.writePromise = this.writePromise.then(async () => {
      try {
        const stored = await area.get(this.key);
        const map = (stored[this.key] ?? {}) as EntryMap<T> | undefined;
        const entry = map?.[entryKey];
        if (!entry) return;
        const now = Date.now();
        entry.lastUsed = now;
        await area.set({ [this.key]: map });
        this.cache = mergeFresh(this.cache, map);
        this.emit();
      } catch (err) {
        console.warn(
          `[KVStore] touchEntry failed for ${this.area}:${this.key}`,
          err,
        );
      }
    });
    return this.writePromise;
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      void this.doWrite();
    }, DEBOUNCE_MS);
  }

  private async doWrite(): Promise<void> {
    this.writePromise = this.writePromise.then(async () => {
      let value = this.snapshot();
      let attempts = 0;
      for (;;) {
        attempts++;
        if (attempts > MAX_WRITE_ATTEMPTS) {
          console.warn(
            `[KVStore] write to ${this.area}:${this.key} failed after ${attempts} attempts`,
          );
          return;
        }
        try {
          if (Object.keys(value).length === 0) {
            await browser.storage[this.area].remove(this.key);
          } else {
            await browser.storage[this.area].set({ [this.key]: value });
          }
          return;
        } catch (err) {
          if (isQuotaError(err)) {
            const evicted = evictOldest(value);
            if (!evicted) {
              console.error(
                `[KVStore] quota exceeded and nothing left to evict in ${this.key}`,
              );
              return;
            }
            value = evicted;
          } else if (isWriteRateError(err)) {
            await sleep(WRITE_RETRY_DELAY_MS);
          } else {
            console.error(
              `[KVStore] write failed for ${this.area}:${this.key}`,
              err,
            );
            return;
          }
        }
      }
    });
    return this.writePromise;
  }
}

export function evictOldest<T extends TimedEntry>(
  value: EntryMap<T>,
): EntryMap<T> | null {
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [k, v] of Object.entries(value)) {
    const ts = lastUsed(v);
    if (ts < oldestTs) {
      oldestTs = ts;
      oldestKey = k;
    }
  }
  if (oldestKey === null) return null;
  const next = { ...value };
  delete next[oldestKey];
  return next;
}

export function mergeByLastWrite<T extends TimedEntry>(
  cache: EntryMap<T>,
  fresh: EntryMap<T> | undefined,
): EntryMap<T> {
  const out: EntryMap<T> = { ...cache };
  if (!fresh) return out;
  for (const [k, v] of Object.entries(fresh)) {
    const cur = out[k];
    if (!cur || lastUsed(v) > lastUsed(cur)) out[k] = v;
  }
  return out;
}

export function mergeUnion<T extends TimedEntry>(
  cache: EntryMap<T>,
  fresh: EntryMap<T> | undefined,
): EntryMap<T> {
  if (!fresh) return { ...cache };
  return { ...fresh, ...cache };
}

export function mergeFresh<T extends TimedEntry>(
  cache: EntryMap<T>,
  fresh: EntryMap<T> | undefined,
): EntryMap<T> {
  if (!fresh) return {};
  const out: EntryMap<T> = {};
  for (const [k, v] of Object.entries(fresh)) {
    const cur = cache[k];
    if (cur && lastUsed(cur) > lastUsed(v)) out[k] = cur;
    else out[k] = v;
  }
  return out;
}
