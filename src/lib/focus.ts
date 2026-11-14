/**
 * Focus mode's Do Not Disturb. A web page can't silence other apps'
 * notifications, but on iPhone and iPad it can open the Shortcuts app to run
 * a shortcut the person made once, which turns Do Not Disturb on or off.
 */

/** The names of the shortcuts Focus runs. */
export const FOCUS_SHORTCUTS = { on: 'Reading Focus On', off: 'Reading Focus Off' }

/** iPhone or iPad, where Shortcuts can turn on Do Not Disturb (an iPad reports itself as a Mac with touch). */
export function hasShortcuts(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'>): boolean {
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)
}

/** The address that opens the Shortcuts app and runs one; the system's back link at the top returns to Chapter. */
export function shortcutUrl(name: string): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`
}
