import type { Settings } from './storage'

/** Page colour of each theme, for the browser's toolbar (theme-color). */
const BACKGROUND = { light: '#fbfaf7', sepia: '#f4e8d0', dark: '#121211' }

/**
 * Apply the theme, reading font and colours to the page. Runs
 * synchronously when settings change, so components that measure text
 * (word size, page breaks) see the new font straight away. index.html sets
 * the theme too, before the first paint, so a dark theme never flashes light.
 */
export function applyAppearance({
  theme,
  font,
  accent,
  highlightColor,
  lineColor,
}: Pick<Settings, 'theme' | 'font' | 'accent' | 'highlightColor' | 'lineColor'>): void {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  root.dataset.font = font
  root.dataset.accent = accent
  // Unset, the CSS falls back to the focus colour.
  // A colour of your own is usually a highlighter shade, which needs more ink
  // than the focus colour's 18% to show.
  setColor(root, '--highlight-fill', highlightColor, (c) => `color-mix(in srgb, ${c} 38%, transparent)`)
  setColor(root, '--line', lineColor)
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const systemDark = meta.media.includes('dark')
    meta.content = BACKGROUND[theme === 'system' ? (systemDark ? 'dark' : 'light') : theme]
  }
}

function setColor(root: HTMLElement, name: string, color: string, value = (c: string) => c): void {
  if (color === 'auto') root.style.removeProperty(name)
  else root.style.setProperty(name, value(color))
}
