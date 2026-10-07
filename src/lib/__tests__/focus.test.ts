import { describe, expect, it } from 'vitest'
import { FOCUS_SHORTCUTS, hasShortcuts, shortcutUrl } from '../focus'

describe('focus shortcuts', () => {
  it('are offered on iPhone and iPad only', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'
    expect(hasShortcuts({ userAgent: iphone, maxTouchPoints: 5 })).toBe(true)
    // An iPad asks for desktop sites, so it says it's a Mac, but one with a touch screen.
    expect(hasShortcuts({ userAgent: mac, maxTouchPoints: 5 })).toBe(true)
    expect(hasShortcuts({ userAgent: mac, maxTouchPoints: 0 })).toBe(false)
    expect(hasShortcuts({ userAgent: android, maxTouchPoints: 5 })).toBe(false)
  })

  it('run by name', () => {
    expect(shortcutUrl(FOCUS_SHORTCUTS.on)).toBe('shortcuts://run-shortcut?name=Reading%20Focus%20On')
  })
})
