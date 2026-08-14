import { writable } from 'svelte/store'
import { t } from './index'
import type { MessageKey } from './index'
import type { Lang } from '../core/types'

export const currentLang = writable<Lang>('auto')

export function setCurrentLang(lang: Lang): void {
  currentLang.set(lang)
}

export function tr(key: MessageKey, lang: Lang): string {
  return t(lang, key)
}
