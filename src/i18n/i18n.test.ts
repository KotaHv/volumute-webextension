import { describe, expect, it } from 'vitest';
import { detectBrowserLang, messages, resolveLang, t } from './index';
import zh from './zh';
import en from './en';

describe('message tables', () => {
  it('zh and en define exactly the same keys', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it('all message keys are covered by both tables', () => {
    const keys = Object.keys(messages.zh) as (keyof typeof messages.zh)[];
    for (const key of keys) {
      expect(messages.en[key]).toBeTypeOf('string');
      expect(messages.zh[key]).toBeTypeOf('string');
    }
  });
});

describe('resolveLang', () => {
  it('auto resolves to zh for Chinese browsers', () => {
    Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true });
    expect(resolveLang('auto')).toBe('zh');
  });

  it('auto resolves to en otherwise', () => {
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
    expect(resolveLang('auto')).toBe('en');
  });

  it('manual selection overrides auto', () => {
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
    expect(resolveLang('zh')).toBe('zh');
    expect(resolveLang('en')).toBe('en');
  });
});

describe('t', () => {
  it('returns the translation for the resolved language', () => {
    expect(t('zh', 'autoMute')).toBe('自动静音');
    expect(t('en', 'autoMute')).toBe('Auto mute');
  });

  it('detectBrowserLang matches resolveLang auto', () => {
    Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true });
    expect(detectBrowserLang()).toBe('zh');
  });
});
