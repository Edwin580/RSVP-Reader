import type { Settings } from './storage'

/** Page colour of each theme, for the browser's toolbar (theme-color). */
const BACKGROUND = { light: '#fbfaf7', sepia: '#f4e8d0', dark: '#121211' }

/**
 * Apply the theme, reading font and focus colour to the page. Runs
 * synchronously when settings change, so components that measure text
 * (word size, page breaks) see the new font straight away. index.html sets
 * the theme too, before the first paint, so a dark theme never flashes light.
 */
export function applyAppearance({
  theme,
  font,
  accent,
  customColor,
}: Pick<Settings, 'theme' | 'font' | 'accent' | 'customColor'>): void {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  root.dataset.font = font
  root.dataset.accent = accent
  // A custom colour is used as it is, on light and dark pages alike.
  for (const shade of ['--accent-l', '--accent-d']) {
    if (accent === 'custom') root.style.setProperty(shade, customColor)
    else root.style.removeProperty(shade)
  }
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const systemDark = meta.media.includes('dark')
    meta.content = BACKGROUND[theme === 'system' ? (systemDark ? 'dark' : 'light') : theme]
  }
}
