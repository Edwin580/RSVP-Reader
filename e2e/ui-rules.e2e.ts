import { expect, test, type Page } from '@playwright/test'
import { STORY, upload } from './helpers.ts'

/*
 * The UI rules in docs/ui-rules.md that can only be seen in the running app:
 * nothing wider than a phone, thumb-sized targets, text fields iOS won't zoom
 * into, pop-ups that fit and drag away, and one shadow for all of them.
 * Every screen and every pop-up is checked, at 320px (the smallest iPhone SE)
 * and at the phone project's size.
 */

/** Every pop-up: how to open it from the reader, and the element that is it. A new pop-up goes here. */
const POPUPS: { name: string; open: (page: Page) => Promise<unknown>; dialog: string }[] = [
  {
    name: 'Settings',
    open: async (page) => {
      await page.getByRole('button', { name: 'Reading settings', exact: true }).click()
      const more = page.getByRole('button', { name: 'More settings' })
      if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click()
    },
    dialog: '.settings-menu',
  },
  { name: 'Bookmarks', open: (page) => page.getByRole('button', { name: 'Bookmarks', exact: true }).click(), dialog: '[role=dialog][aria-label="Bookmarks"]' },
  { name: 'Search', open: (page) => page.getByRole('button', { name: 'Search', exact: true }).click(), dialog: '[role=dialog][aria-label="Search in book"]' },
  { name: 'Read for', open: (page) => page.locator('.session-open').click(), dialog: '.session-menu' },
]

/** Problems with the screen as it is now: anything wider than it, small targets, zooming fields. */
const problems = (page: Page, touch: boolean) =>
  page.evaluate(`(() => {
    const found = []
    const width = document.documentElement.clientWidth
    if (document.documentElement.scrollWidth > width + 1) found.push('the page is ' + document.documentElement.scrollWidth + 'px wide')
    const shown = (el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false
      // Out of sight behind something that clips it (a library row's swipe actions).
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflow === 'visible') continue
        const c = a.getBoundingClientRect()
        if (c.width === 0 || c.height === 0 || r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom) return false
      }
      return true
    }
    const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40)
    for (const el of document.querySelectorAll('[role=dialog]')) {
      if (!shown(el)) continue
      if (el.scrollWidth > el.clientWidth + 1) found.push(label(el) + ': its content is wider than it (' + el.scrollWidth + ' > ' + el.clientWidth + ')')
      const r = el.getBoundingClientRect()
      if (r.left < -1 || r.right > width + 1 || r.top < -1 || r.bottom > innerHeight + 1) found.push(label(el) + ': not all on screen')
    }
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role=slider], [role=radio], [role=tab]')) {
      const field = el.matches('input:not([type=file]):not([type=color]):not([type=range]), select, textarea')
      if (field && parseFloat(getComputedStyle(el).fontSize) < 16) found.push(label(el) + ': text under 16px, iOS would zoom in')
      if (!shown(el)) continue
      const r = el.getBoundingClientRect()
      if (r.right > width + 1 || r.left < -1) found.push(label(el) + ': off the side of the screen')
      // The one exception, marked where it's made: the reading calendar's day squares.
      if (${touch} && !el.hasAttribute('data-small-target') && (r.width < 44 || r.height < 44)) found.push(label(el) + ': ' + Math.round(r.width) + ' × ' + Math.round(r.height) + 'px, under 44px')
    }
    return [...new Set(found)]
  })()`) as Promise<string[]>

const closeSettings = (page: Page) => page.locator('.popover-backdrop').click({ position: { x: 5, y: 5 } })
const settled = (page: Page) => page.waitForFunction(`document.getAnimations().every((a) => a.playState !== 'running')`)

for (const width of [320, null]) {
  test(`Phones${width ? `, ${width}px wide` : ''}: every screen and pop-up fits, with thumb-sized targets (rules 5–8)`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'Phone sizes')
    if (width) await page.setViewportSize({ width, height: 640 })
    const check = async (where: string) => {
      await settled(page)
      expect(await problems(page, true), where).toEqual([])
    }
    await page.goto('./')
    await check('the library, empty')
    await upload(page, 'story.txt', STORY)
    await check('reading, word mode')
    for (const popup of POPUPS) {
      await popup.open(page)
      await expect(page.locator(popup.dialog)).toBeVisible()
      await check(popup.name)
      await page.keyboard.press('Escape')
      await expect(page.locator(popup.dialog)).toBeHidden()
    }
    await page.getByRole('button', { name: 'Reading settings', exact: true }).click()
    await page.getByRole('radio', { name: 'Page' }).click()
    await closeSettings(page)
    await check('reading, page mode')
    await page.locator('.nav-button').click()
    // Some reading history, so the stats show.
    await page.evaluate(`new Promise((done) => {
      const pad = (n) => String(n).padStart(2, '0')
      const d = new Date()
      const key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      const req = indexedDB.open('rsvp-reader')
      req.onsuccess = () => {
        const tx = req.result.transaction('kv', 'readwrite')
        tx.objectStore('kv').put({ days: { [key]: { ms: 20 * 60000, words: 5000 } } }, 'stats')
        tx.oncomplete = () => done()
      }
    })`)
    await page.reload()
    await page.locator('.stats-toggle').click()
    await check('the library, with a book and stats')
  })
}

for (const popup of POPUPS) {
  test(`${popup.name}: on a phone it's a sheet with a handle, and dragging it down puts it away (rule 4)`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'Dragging sheets is for phones')
    await page.goto('./')
    await upload(page, 'story.txt', STORY)
    await popup.open(page)
    const dialog = page.locator(popup.dialog)
    await expect(dialog).toBeVisible()
    await settled(page)
    const handle = dialog.locator('.sheet-handle')
    await expect(handle).toBeVisible()
    // A sheet: across the bottom of the screen.
    const box = (await dialog.boundingBox())!
    const view = page.viewportSize()!
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(view.height - 1)
    expect(Math.round(box.width)).toBe(view.width)
    // Pull it down by the handle.
    const grip = (await handle.boundingBox())!
    const x = grip.x + grip.width / 2
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: grip.y }] })
    for (let k = 1; k <= 8; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: grip.y + k * 25 }] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(dialog).toBeHidden()
  })
}

test('every pop-up has the same shadow (the dimming one on a phone), and on a phone the same sheet corners (rules 2 and 3)', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone'
  await page.goto('./')
  await upload(page, 'story.txt', STORY)
  const looks: Record<string, { shadow: string; corner: string }> = {}
  for (const popup of POPUPS) {
    await popup.open(page)
    const dialog = page.locator(popup.dialog)
    await expect(dialog).toBeVisible()
    await settled(page)
    looks[popup.name] = (await page.evaluate(`(() => {
      const style = getComputedStyle(document.querySelector('${popup.dialog.replace(/'/g, "\\'")}'))
      return { shadow: style.boxShadow, corner: style.borderTopLeftRadius }
    })()`)) as { shadow: string; corner: string }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  }
  const shadow = await page.evaluate(`(() => {
    const probe = document.createElement('div')
    probe.style.boxShadow = '${phone ? 'var(--shadow-scrim)' : 'var(--shadow)'}'
    document.body.append(probe)
    const value = getComputedStyle(probe).boxShadow
    probe.remove()
    return value
  })()`)
  // On a phone, sheets have no drop shadow: each dims the page around it with a shadow of its own.
  for (const [name, look] of Object.entries(looks)) expect(look.shadow, `${name}'s shadow`).toBe(shadow)
  if (phone) {
    const corners = new Set(Object.values(looks).map((l) => l.corner))
    expect([...corners], 'sheet corners').toHaveLength(1)
  }
})
