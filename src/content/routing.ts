import { pathKeyOf } from '../core/url';

export function setupUrlTracking(onChange: () => void): void {
  let currentPath = pathKeyOf(location.href);

  const check = () => {
    const p = pathKeyOf(location.href);
    if (p !== currentPath) {
      currentPath = p;
      onChange();
    }
  };

  window.addEventListener('popstate', check);
  window.addEventListener('hashchange', check);

  let timer: ReturnType<typeof setInterval> | null = null;
  const start = () => {
    if (!timer) timer = setInterval(check, 1500);
  };
  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  start();
}
