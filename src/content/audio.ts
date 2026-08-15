const ORIG_CONNECT = AudioNode.prototype.connect as unknown as (...args: unknown[]) => unknown;

let currentVolume = 1;
const routes = new Map<AudioContext, GainNode>();

function buildRoute(ctx: AudioContext): GainNode {
  const gain = ctx.createGain();
  gain.gain.value = currentVolume;
  ORIG_CONNECT.call(gain, ctx.destination);
  ctx.addEventListener('statechange', () => {
    if (ctx.state === 'closed') routes.delete(ctx);
  });
  return gain;
}

function routeFor(ctx: AudioContext): GainNode {
  let gain = routes.get(ctx);
  if (!gain) {
    gain = buildRoute(ctx);
    routes.set(ctx, gain);
  }
  return gain;
}

export function setAllVolume(volume: number): void {
  currentVolume = volume;
  for (const [ctx, gain] of routes) {
    if (ctx.state === 'closed') {
      routes.delete(ctx);
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
  console.log(`[VoluMute] gain -> ${volume} (routes: ${routes.size})`);
}

function installConnectPatch(): void {
  if ((installConnectPatch as unknown as { done?: boolean }).done) return
  ;(installConnectPatch as unknown as { done: boolean }).done = true
  ;(AudioNode.prototype as unknown as { connect: unknown }).connect = function (
    this: AudioNode,
    destination: AudioNode | AudioParam,
    ...args: unknown[]
  ): AudioNode | void {
    const target = destination === this.context.destination ? routeFor(this.context as AudioContext) : destination;
    return ORIG_CONNECT.call(this, target, ...(args as [number?, number?])) as AudioNode | void;
  };
}

installConnectPatch();

export class AudioController {
  private ctx: AudioContext | null = null;
  private wrapped = new WeakSet<HTMLMediaElement>();
  private suspended: boolean | null = null;

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
    if (!this.ensure()) return;
    if (volume === 0) {
      this.suspended = true;
      void this.ctx?.suspend();
    } else {
      this.suspended = false;
      void this.ctx?.resume();
    }
    setAllVolume(volume);
  }

  wrapMediaElement(el: HTMLMediaElement): void {
    if (this.wrapped.has(el)) return;
    this.wrapped.add(el);
    if (!this.ensure() || !this.ctx) return;
    try {
      const src = this.ctx.createMediaElementSource(el);
      const route = routeFor(this.ctx);
      ORIG_CONNECT.call(src as AudioNode, route as AudioNode);
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

  const observer = new MutationObserver(() => scan());
  try {
    observer.observe(document.documentElement ?? document, {
      childList: true,
      subtree: true,
    });
  } catch {
    /* ignore */
  }

  document.addEventListener('play', (e) => wrap(e.target as Element), true);
  window.addEventListener('load', scan);
}
