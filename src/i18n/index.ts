import zh from './zh';
import en from './en';

export type MessageKey = keyof typeof en

type Messages = Record<MessageKey, string>

export const messages: Record<'zh' | 'en', Messages> = { zh, en };

export function detectBrowserLang(): 'zh' | 'en' {
  const lang = (navigator.language || browser.i18n.getUILanguage() || 'en').toLowerCase();
  return lang.startsWith('zh') ? 'zh' : 'en';
}

export function resolveLang(lang: 'auto' | 'zh' | 'en'): 'zh' | 'en' {
  return lang === 'auto' ? detectBrowserLang() : lang;
}

export function t(lang: 'auto' | 'zh' | 'en', key: MessageKey): string {
  const resolved = resolveLang(lang);
  return (messages[resolved][key] ?? key) as string;
}
