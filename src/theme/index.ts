import type { ThemeMode } from '../core/types'

const mql = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'auto') return mode
  return mql?.matches ? 'dark' : 'light'
}

export function applyTheme(mode: ThemeMode): void {
  const theme = resolveTheme(mode)
  document.documentElement.dataset.theme = theme
}

export function watchTheme(mode: ThemeMode, onChange: (theme: 'light' | 'dark') => void): () => void {
  if (mode !== 'auto' || !mql) return () => {}
  const handler = () => onChange(mql.matches ? 'dark' : 'light')
  mql.addEventListener('change', handler)
  return () => mql.removeEventListener('change', handler)
}
