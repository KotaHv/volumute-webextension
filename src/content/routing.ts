import { pathKeyOf } from '../core/url';

export function setupUrlTracking(onChange: () => void, getUrl: () => string = () => location.href): void {
  let currentPath = pathKeyOf(getUrl());

  const check = () => {
    const p = pathKeyOf(getUrl());
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
