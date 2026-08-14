import type BrowserNS from 'webextension-polyfill'

declare global {
  const browser: BrowserNS.Browser
}

export {}
