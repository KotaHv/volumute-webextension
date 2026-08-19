import { mount } from 'svelte';
import browser from 'webextension-polyfill';
import '../theme/theme.css';
import Options from './Options.svelte'

;(globalThis as unknown as { browser: typeof browser }).browser = browser;

mount(Options, { target: document.getElementById('app')! });
