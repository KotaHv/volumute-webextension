import { mount } from 'svelte';
import browser from 'webextension-polyfill';
import '../theme/theme.css';
import Popup from './Popup.svelte'

;(globalThis as unknown as { browser: typeof browser }).browser = browser;

void browser.runtime.getPlatformInfo().then((info) => {
  if (info.os === 'android') document.documentElement.classList.add('android');
});

mount(Popup, { target: document.getElementById('app')! });
