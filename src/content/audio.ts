const GAINS_KEY = '__volumute_gains__';
const ROUTED_KEY = '__volumute_routed__';

type ConnectFn = (...args: unknown[]) => unknown;
type AnyRecord = Record<string, unknown>;

// The gains registry lives on the window wrapper: Firefox reuses the same
// content-script global scope across extension reloads, so a new instance
// keeps controlling gains created by a previous one.
const win = window as unknown as AnyRecord;

// The page's real object (Firefox): the only place where a marker survives
// extension reloads, since Xray wrapper expandos do not pass through.
function pageMark(el: HTMLMediaElement): AnyRecord | undefined {
  return (el as unknown as { wrappedJSObject?: AnyRecord }).wrappedJSObject;
}

function isRouted(el: HTMLMediaElement): boolean {
  const real = pageMark(el);
  return real ? real[ROUTED_KEY] === true : false;
}

let currentVolume = 1;

function gainRegistry(): Set<GainNode> {
  let gains = win[GAINS_KEY] as Set<GainNode> | undefined;
  if (!gains) {
    gains = new Set<GainNode>();
    win[GAINS_KEY] = gains;
  }
  return gains;
}

// Content scripts cannot assign functions to page objects (Xray vision), so
// this is always the pristine native connect in every instance.
const ORIG_CONNECT = AudioNode.prototype.connect as unknown as ConnectFn;

// One shared gain per AudioContext: after an extension reload the new content
// script finds the existing node in the window registry instead of stacking
// another layer into the audio graph.
function buildRoute(ctx: AudioContext): GainNode {
  const gain = ctx.createGain();
  gain.gain.value = currentVolume;
  ORIG_CONNECT.call(gain, ctx.destination);
  gainRegistry().add(gain);
  ctx.addEventListener('statechange', () => {
    if (ctx.state === 'closed') gainRegistry().delete(gain);
  });
  return gain;
}

function routeFor(ctx: AudioContext): GainNode {
  const gains = gainRegistry();
  for (const gain of gains) {
    if (gain.context === ctx) {
      if (ctx.state === 'closed') {
        gains.delete(gain);
        break;
      }
      return gain;
    }
  }
  return buildRoute(ctx);
}

export function setAllVolume(volume: number): void {
  currentVolume = volume;
  const gains = gainRegistry();
  for (const gain of gains) {
    if (gain.context.state === 'closed') {
      gains.delete(gain);
      continue;
    }
    try {
      const ctxTime = gain.context.currentTime;
      const param = gain.gain;
      param.cancelScheduledValues(ctxTime);
      param.setTargetAtTime(volume, ctxTime, 0.03);
    } catch {
      /* ignore */
    }
  }
  console.log(`[VoluMute] gain -> ${volume} (gains: ${gains.size})`);
}

export class AudioController {
  private ctx: AudioContext | null = null;
  private wrapped = new WeakSet<HTMLMediaElement>();
  private suspended: boolean | null = null;
  private captured = 0;

  private ensure(): boolean {
    if (this.ctx) return true;
    const win = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = win.AudioContext ?? win.webkitAudioContext;
    if (!Ctor) return false;
    try {
      this.ctx = new Ctor();
      routeFor(this.ctx);
      return true;
    } catch {
      return false;
    }
  }

  setVolume(volume: number): void {
    if (volume === 0) {
      this.suspended = true;
      void this.ctx?.suspend();
    } else {
      this.suspended = false;
      if (this.captured > 0 && this.ensure()) {
        void this.ctx?.resume();
      }
    }
    setAllVolume(volume);
  }

  wrapMediaElement(el: HTMLMediaElement): void {
    if (this.wrapped.has(el)) return;
    this.wrapped.add(el);
    if (isRouted(el)) return;
    if (!this.ensure() || !this.ctx) return;
    try {
      const src = this.ctx.createMediaElementSource(el);
      const route = routeFor(this.ctx);
      ORIG_CONNECT.call(src as AudioNode, route as AudioNode);
      const real = pageMark(el);
      if (real) real[ROUTED_KEY] = true;
      this.captured++;
      console.log('[VoluMute] media element captured');
      const resume = () => {
        try {
          if (this.suspended !== true) void this.ctx?.resume();
        } catch {
          /* ignore */
        }
      };
      el.addEventListener('play', resume);
    } catch (err) {
      /* element already captured by the page itself */
      console.warn('[VoluMute] media element capture failed:', err);
      if (this.captured === 0 && this.ctx) {
        void this.ctx.close();
        this.ctx = null;
      }
    }
  }
}

export function hookMediaElements(controller: AudioController): void {
  const wrap = (el: Element) => {
    if (el instanceof HTMLMediaElement) controller.wrapMediaElement(el);
  };

  const scan = () => {
    for (const el of document.querySelectorAll('video, audio')) wrap(el);
  };

  if (document.documentElement) scan();

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLMediaElement) wrap(node);
        else if (node instanceof Element) {
          for (const el of node.querySelectorAll('video, audio')) wrap(el);
        }
      }
    }
  });
  try {
    observer.observe(document.documentElement ?? document, {
      childList: true,
      subtree: true,
    });
  } catch {
    /* ignore */
  }

  window.addEventListener('load', scan);
}
