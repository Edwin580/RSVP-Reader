import { expect, test, type Page } from '@playwright/test'
import { upload } from './helpers.ts'

/*
 * Bugs that were fixed and must stay fixed. Each test names the bug as it
 * was reported and the pull request that fixed it, and was checked to fail
 * with that fix undone. Bugs fixed later get their test here too (see
 * CLAUDE.md, "Bug fixes").
 */

const openSettings = (page: Page) => page.getByRole('button', { name: 'Reading settings', exact: true }).click()
const closeSettings = async (page: Page) => {
  await page.locator('.popover-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(page.locator('.popover')).toBeHidden()
}

/**
 * Fixed layers with any colour that touch the top edge of the page. Safari
 * colours its top bar from such a layer and keeps that colour after it
 * changes, which left the bar in the wrong theme.
 */
const colouredLayersAtTop = (page: Page) =>
  page.evaluate(`(() => {
    const found = []
    for (const x of [8, innerWidth / 2, innerWidth - 8]) {
      for (const el of document.elementsFromPoint(x, 1)) {
        const style = getComputedStyle(el)
        const colour = style.backgroundColor.match(/[\\d.]+/g)?.map(Number) ?? []
        const opaque = colour.length === 4 ? colour[3] > 0 : colour.length === 3
        if ((style.position === 'fixed' || style.position === 'sticky') && opaque) found.push(el.className || el.tagName)
      }
    }
    return [...new Set(found)]
  })()`)

/** A CSS colour resolved by the browser, to compare with what's painted. */
const resolve = (page: Page, css: string) =>
  page.evaluate(`(() => {
    const probe = document.createElement('div')
    probe.style.backgroundColor = '${css}'
    document.body.append(probe)
    const colour = getComputedStyle(probe).backgroundColor
    probe.remove()
    return colour
  })()`)

const pageColour = (page: Page) => page.evaluate(`getComputedStyle(document.documentElement).backgroundColor`)

for (const mode of ['Word', 'Page'] as const) {
  test(`${mode} mode: Safari's top bar follows the theme and dims with the Aa sheet (#36, #48)`, async ({ page }, testInfo) => {
    // Reported: "When changing theme on mobile, top still shows old theme",
    // twice. Safari takes its top bar colour from a coloured fixed layer at
    // the top (once the settings backdrop, later a fixed reader) and keeps it.
    await page.goto('./')
    await upload(page)
    if (mode === 'Page') {
      await openSettings(page)
      await page.getByRole('radio', { name: 'Page' }).click()
      await closeSettings(page)
    }
    expect(await colouredLayersAtTop(page)).toEqual([])

    await openSettings(page)
    expect(await colouredLayersAtTop(page)).toEqual([])
    await page.getByRole('radio', { name: 'Dark' }).click()
    expect(await colouredLayersAtTop(page)).toEqual([])
    if (testInfo.project.name === 'phone') {
      // Behind the sheet, the page itself is the dimmed colour of the theme
      // just picked: that's what Safari's bar shows.
      await expect.poll(() => pageColour(page)).toBe(await resolve(page, 'var(--page-dimmed)'))
    }
    await closeSettings(page)
    expect(await colouredLayersAtTop(page)).toEqual([])
    await expect.poll(() => pageColour(page)).not.toBe(await resolve(page, 'var(--page-dimmed)'))
    expect(await page.evaluate(`getComputedStyle(document.body).backgroundColor`)).toBe(await resolve(page, 'var(--bg)'))
  })
}

test('the page behind the reader never scrolls or bounces (#44, #48)', async ({ page }, testInfo) => {
  // Reported: in Safari (not the home screen app) page mode could be
  // scrolled, which slid the reader and left a gap. Chromium wouldn't
  // scroll an exactly-fitting page anyway, so this also checks the page is
  // set not to scroll or bounce at all.
  await page.goto('./')
  await upload(page)
  for (const mode of ['Word', 'Page'] as const) {
    if (mode === 'Page') {
      await openSettings(page)
      await page.getByRole('radio', { name: 'Page' }).click()
      await closeSettings(page)
    }
    for (const el of ['documentElement', 'body']) {
      const style = await page.evaluate(`(() => { const s = getComputedStyle(document.${el}); return s.overflowY + ' ' + s.overscrollBehaviorY })()`)
      expect(style, `${mode} mode, ${el}`).toBe('hidden none')
    }
    const box = (await page.locator('.stage').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 600)
    await page.mouse.wheel(0, -1200)
    if (testInfo.project.name === 'phone') {
      const cdp = await page.context().newCDPSession(page)
      const drag = async (from: number, to: number) => {
        const x = box.x + box.width / 2
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] })
        for (let i = 1; i <= 6; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + ((to - from) * i) / 6 }] })
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      }
      await drag(box.y + box.height - 20, box.y + 20)
      await drag(box.y + 20, box.y + box.height - 20)
    }
    await page.waitForTimeout(300)
    expect(await page.evaluate('document.scrollingElement.scrollTop'), mode).toBe(0)
    expect(await page.evaluate(`document.querySelector('.reader').getBoundingClientRect().top`), mode).toBe(0)
  }
})

for (const mode of ['Word', 'Page'] as const) {
  test(`${mode} mode: holding to read never selects text (#33)`, async ({ page }, testInfo) => {
    // Reported: "make it so hold doesn't select words". With Hold to read, a
    // long press reads; it must not start selecting or bring up the menu.
    await page.goto('./')
    await upload(page)
    await openSettings(page)
    if (mode === 'Page') await page.getByRole('radio', { name: 'Page' }).click()
    await page.getByRole('button', { name: 'More settings' }).click()
    await page.getByRole('radio', { name: 'Hold', exact: true }).click()
    await closeSettings(page)
    await page.waitForFunction('document.getAnimations().length === 0')
    const target = page.locator(mode === 'Page' ? '.page > .page-text [data-i]' : '.context [data-i]').nth(2)
    const box = (await target.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    const selected = () => page.evaluate('String(window.getSelection())')

    // With a mouse: hold, drift across the text, let go.
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.waitForTimeout(700)
    await page.mouse.move(x + 120, y, { steps: 6 })
    expect(await selected()).toBe('')
    await page.mouse.up()
    expect(await selected()).toBe('')

    // With a finger: a long press.
    if (testInfo.project.name === 'phone') {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await page.waitForTimeout(900)
      expect(await selected()).toBe('')
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(200)
      expect(await selected()).toBe('')
    }
  })
}

test('Escape closes any sheet or panel, wherever the focus is, and never the book (#39)', async ({ page }) => {
  // Reported with the definition sheet: Escape only worked with the focus
  // inside it. Here with focus moved away, Escape would otherwise reach the
  // reader and close the book.
  await page.goto('./')
  await upload(page)
  const blur = () => page.evaluate('document.activeElement?.blur()')
  const panels: [string, () => Promise<void>, string][] = [
    ['settings', () => openSettings(page), '.settings-menu'],
    ['bookmarks', () => page.getByRole('button', { name: 'Bookmarks', exact: true }).click(), '.search-panel'],
    ['search', () => page.getByRole('button', { name: 'Search', exact: true }).click(), '.search-panel'],
    ['read for', () => page.locator('.session-open').click(), '.session-menu'],
  ]
  for (const [name, open, selector] of panels) {
    await open()
    await expect(page.locator(selector), name).toBeVisible()
    await blur()
    await page.keyboard.press('Escape')
    await expect(page.locator(selector), name).toBeHidden()
    await expect(page.locator('.reader'), `${name}: still in the book`).toBeVisible()
  }
})

test("the ring around a tapped day in the stats calendar isn't clipped (#52)", async ({ page }) => {
  // Reported: the bottom row looked clipped. The scrolling calendar cut off
  // the ring drawn just outside a square, on the bottom row and the last week.
  await page.goto('./')
  await page.evaluate(`new Promise((done) => {
    const pad = (n) => String(n).padStart(2, '0')
    const d = new Date()
    const key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    const req = indexedDB.open('rsvp-reader')
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite')
      tx.objectStore('kv').put({ days: { [key]: { ms: 20 * 60000, words: 5000 } } }, 'stats')
      tx.oncomplete = () => done()
    }
  })`)
  await page.reload()
  await page.locator('.stats-toggle').click()
  const cells = page.locator('.stats-grid .stats-cell')
  // The last Saturday shown (bottom row) and today (last week).
  const today = new Date().getDay()
  for (const index of [(await cells.count()) - today - 2, (await cells.count()) - 1]) {
    await cells.nth(index).click()
    const fits = await page.evaluate(`(() => {
      const cell = document.querySelectorAll('.stats-grid .stats-cell')[${index}]
      const box = document.querySelector('.stats-scroll').getBoundingClientRect()
      const r = cell.getBoundingClientRect()
      const style = getComputedStyle(cell)
      const ring = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset)
      return r.left - ring >= box.left && r.right + ring <= box.right && r.top - ring >= box.top && r.bottom + ring <= box.bottom
    })()`)
    expect(fits, `square ${index}`).toBe(true)
  }
})
