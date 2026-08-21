const ROUTED_KEY = '__volumute_routed__';
const GAIN_KEY = '__volumute_gain__';

type ConnectFn = (...args: unknown[]) => unknown;
type AnyRecord = Record<string, unknown>;

// The page's real object (Firefox): the only place where markers survive
// extension reloads, since Xray wrapper expandos do not pass through. On
// Chrome the audio script runs in the MAIN world, where the element is
// already the page object.
function pageObject(el: HTMLMediaElement): AnyRecord {
  return toPageObject(el) as unknown as AnyRecord;
}

function isCaptured(el: HTMLMediaElement): boolean {
  return pageObject(el)[ROUTED_KEY] === true;
}

// Unwrap to the underlying page object so identity checks work across realms
// (an Xray wrapper and the raw object are not ===).
function toPageObject<T>(obj: T): T {
  const real = (obj as unknown as { wrappedJSObject?: T }).wrappedJSObject;
  return (real ?? obj) as T;
}

let targetVolume = 1;

// Gain nodes of every AudioContext this realm controls; media elements feed
// into destination through them. After an extension reload the previous
// instance's gains are taken over (their contexts are still alive), hence a
// set rather than a single variable.
const controlledGains = new Set<GainNode>();

// Content scripts cannot assign functions to page objects (Xray vision), so
// connect is always the pristine native implementation.
const NATIVE_CONNECT = AudioNode.prototype.connect as unknown as ConnectFn;

// One volume control point per AudioContext, reused once created.
function createGainNode(ctx: AudioContext): GainNode {
  const gain = ctx.createGain();
  gain.gain.value = targetVolume;
  NATIVE_CONNECT.call(gain, ctx.destination);
  controlledGains.add(gain);
  ctx.addEventListener('statechange', () => {
    if (ctx.state === 'closed') controlledGains.delete(gain);
  });
  return gain;
}

function gainNodeFor(ctx: AudioContext): GainNode {
  const rawCtx = toPageObject(ctx);
  for (const gain of controlledGains) {
    if (toPageObject(gain.context) === rawCtx) {
      if (ctx.state === 'closed') {
        controlledGains.delete(gain);
        break;
      }
      return gain;
    }
  }
  return createGainNode(ctx);
}

function setAllGains(volume: number): void {
  targetVolume = volume;
  for (const gain of controlledGains) {
    if (gain.context.state === 'closed') {
      controlledGains.delete(gain);
      continue;
    }
    try {
      const ctxTime = gain.context.currentTime;
      gain.gain.cancelScheduledValues(ctxTime);
      gain.gain.setTargetAtTime(volume, ctxTime, 0.03);
    } catch (error) {
      console.warn('[VoluMute] gain update failed:', error);
    }
  }
  console.log(`[VoluMute] gain -> ${volume} (gains: ${controlledGains.size})`);
}

export class AudioController {
  private ctx: AudioContext | null = null;
  private knownElements = new WeakSet<HTMLMediaElement>();
  private capturedCount = 0;

  private ensureContext(): boolean {
    if (this.ctx) return true;
    const win = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = win.AudioContext ?? win.webkitAudioContext;
    if (!Ctor) return false;
    try {
      this.ctx = new Ctor();
      gainNodeFor(this.ctx);
      return true;
    } catch (error) {
      console.warn('[VoluMute] AudioContext creation failed:', error);
      return false;
    }
  }

  private resumeContext(): void {
    try {
      // Rejections here are expected while autoplay is still blocked, so they
      // stay silently ignored; the resume is retried on the next gesture.
      void this.ctx?.resume().catch(() => {});
    } catch {
      /* ignore */
    }
  }

  setVolume(volume: number): void {
    if (volume > 0) this.resumeContext();
    setAllGains(volume);
  }

  captureMediaElement(el: HTMLMediaElement): void {
    if (this.knownElements.has(el)) return;
    this.knownElements.add(el);
    if (isCaptured(el)) {
      // Routed by a previous extension instance: adopt its gain so volume
      // changes keep reaching the existing audio path.
      const stored = pageObject(el)[GAIN_KEY];
      if (stored && typeof stored === 'object' && 'gain' in stored) {
        controlledGains.add(stored as GainNode);
      }
      return;
    }
    if (!this.ensureContext() || !this.ctx) return;
    try {
      const src = this.ctx.createMediaElementSource(el);
      const gain = gainNodeFor(this.ctx);
      NATIVE_CONNECT.call(src as AudioNode, gain as AudioNode);
      const real = pageObject(el);
      real[ROUTED_KEY] = true;
      real[GAIN_KEY] = toPageObject(gain);
      this.capturedCount++;
      console.log('[VoluMute] media element captured');
      // These fire inside the user gesture that starts playback or unmutes the
      // element, which is when resuming a suspended context is allowed.
      el.addEventListener('play', () => this.resumeContext());
      el.addEventListener('volumechange', () => {
        if (!el.muted && targetVolume > 0) this.resumeContext();
      });
    } catch (err) {
      /* element already captured by the page itself */
      console.warn('[VoluMute] media element capture failed:', err);
      pageObject(el)[ROUTED_KEY] = true;
      if (this.capturedCount === 0 && this.ctx) {
        void this.ctx.close();
        this.ctx = null;
      }
    }
  }
}

export function hookMediaElements(controller: AudioController): void {
  const capture = (el: Element) => {
    if (el instanceof HTMLMediaElement) controller.captureMediaElement(el);
  };

  const scan = () => {
    for (const el of document.querySelectorAll('video, audio')) capture(el);
  };

  if (document.documentElement) scan();

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLMediaElement) capture(node);
        else if (node instanceof Element) {
          for (const el of node.querySelectorAll('video, audio')) capture(el);
        }
      }
    }
  });
  try {
    observer.observe(document.documentElement ?? document, {
      childList: true,
      subtree: true,
    });
  } catch (error) {
    console.warn('[VoluMute] MutationObserver setup failed:', error);
  }

  window.addEventListener('load', scan);
}