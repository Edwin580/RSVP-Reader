import type { Settings } from './storage'

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
  syncThemeColor()
}

let probe: HTMLElement | null = null
let state = ''

/**
 * Colour the phone's status bar (and the browser's toolbar) like the top of
 * the page: the theme's page colour, dimmed while a sheet or panel dims the
 * page under it. Installed to the home screen, iOS colours its status bar
 * from the theme-color tag and doesn't always notice it being edited, so the
 * tag is replaced instead.
 */
export function syncThemeColor(): void {
  const phone = window.matchMedia?.('(max-width: 640px)').matches ?? false
  const dimmed =
    // Search and bookmarks dim the page everywhere; the settings and
    // "Read for" sheets only on phones (elsewhere they're small popovers).
    !!document.querySelector('.search-backdrop:not(.is-closing)') ||
    (phone && !!document.querySelector('.settings-menu:not(.is-closing), .session-menu:not(.is-closing)'))
  const root = document.documentElement
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  const key = `${root.dataset.theme ?? (dark ? 'system-dark' : 'system-light')} ${dimmed}`
  if (key === state) return
  state = key
  // The colours are CSS variables (with color-mix), so let the browser resolve them.
  if (!probe) {
    probe = document.createElement('div')
    probe.style.display = 'none'
    document.body.append(probe)
  }
  probe.style.color = dimmed ? 'var(--page-dimmed)' : 'var(--bg)'
  const color = toHex(getComputedStyle(probe).color)
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.remove()
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = color
  document.head.append(meta)
}

/** Keep the status bar in step as sheets open and close, and with the system's light or dark mode. */
export function watchThemeColor(): void {
  let frame = 0
  const later = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(syncThemeColor)
  }
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', later)
  window.matchMedia?.('(max-width: 640px)').addEventListener?.('change', later)
}

/**
 * A resolved CSS colour ("rgb(…)" or, from color-mix, "color(srgb …)") as
 * #rrggbb, the one form every browser's theme-color understands.
 */
export function toHex(css: string): string {
  const srgb = css.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  const rgb = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/)
  const channels = srgb ? srgb.slice(1, 4).map((v) => Number(v) * 255) : rgb ? rgb.slice(1, 4).map(Number) : null
  if (!channels) return css
  return '#' + channels.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
}
