import type { Settings } from './storage'

/** Page colour of each theme, for the browser's toolbar (theme-color). */
const BACKGROUND = { light: '#f3efe6', sepia: '#f4e8d0', dark: '#141311' }

/**
 * Apply the theme, reading font and focus colour to the page. Runs
 * synchronously when settings change, so components that measure text
 * (word size, page breaks) see the new font straight away. index.html sets
 * the theme too, before the first paint, so a dark theme never flashes light.
 */
export function applyAppearance({ theme, font, accent }: Pick<Settings, 'theme' | 'font' | 'accent'>): void {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  root.dataset.font = font
  root.dataset.accent = accent
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const systemDark = meta.media.includes('dark')
    meta.content = BACKGROUND[theme === 'system' ? (systemDark ? 'dark' : 'light') : theme]
  }
}
