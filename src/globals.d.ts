import type BrowserNS from 'webextension-polyfill';

declare global {
  const browser: BrowserNS.Browser;
  const __BUILD_STAMP__: string;
  const __BUILD_TARGET__: string;
}

export {};
