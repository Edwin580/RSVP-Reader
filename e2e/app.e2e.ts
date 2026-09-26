import { expect, test, type Page } from '@playwright/test'

const STORY = [
  'Chapter 1',
  '',
  'The rabbit ran across the field. Alice followed it to a hole under the hedge. She looked in and saw nothing but darkness.',
  '',
  'Chapter 2',
  '',
  'Down she went, past cupboards and shelves. The fall seemed to last for ever, and she wondered where she would land.',
].join('\n')

async function upload(page: Page, name = 'story.txt', text = STORY) {
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) })
  await expect(page.locator('.reader')).toBeVisible()
}

const currentWord = (page: Page) => page.locator('.word').textContent()

test('the demo opens from an empty library and plays', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click()
  await expect(page.locator('.reader')).toBeVisible()
  const first = await currentWord(page)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => currentWord(page)).not.toBe(first)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  // Paused: the words around the current one appear.
  await expect(page.locator('.context p')).toBeVisible()
})

test('an uploaded book is saved with its reading position', async ({ page }) => {
  await page.goto('./')
  await upload(page)
  // Into the second sentence ("Alice followed it to …"), past its first word.
  for (let i = 0; i < 11; i++) await page.getByRole('button', { name: 'Forward one word', exact: true }).click()
  await expect(page.locator('.word')).toHaveText('to')
  await page.locator('.nav-button').click()
  await expect(page.locator('.shelf-title')).toHaveText('story')
  await page.reload()
  await page.locator('.shelf-open').click()
  // Reopening resumes at the start of the sentence that was showing.
  await expect(page.locator('.word')).toHaveText('Alice')
})

test('chapters are detected and can be jumped to', async ({ page }) => {
  await page.goto('./')
  await upload(page)
  const chapters = page.getByLabel('Jump to chapter')
  await expect(chapters.locator('option')).toHaveText(['Chapter 1', 'Chapter 2'])
  await chapters.selectOption({ label: 'Chapter 2' })
  await expect(page.locator('.word')).toHaveText('Chapter')
  await expect(page.locator('.deck-meta')).toContainText('left in chapter')
})

test('page mode shows the page and follows along', async ({ page }) => {
  await page.goto('./')
  await upload(page)
  await page.getByRole('button', { name: 'Reading settings', exact: true }).click()
  await page.getByRole('radio', { name: 'Page' }).click()
  await page.locator('.popover-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(page.locator('.page > .page-text')).toContainText('The rabbit ran across the field.')
  await page.getByRole('button', { name: 'Forward one word', exact: true }).click()
  await expect(page.locator('.page-marker')).toHaveCSS('opacity', '1')
})

test('search finds a word and jumps to it', async ({ page }) => {
  await page.goto('./')
  await upload(page)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByLabel('Search text').fill('cupboard')
  const result = page.locator('.search-results button').first()
  await expect(result).toContainText('cupboards')
  await result.click()
  await expect(page.locator('.search-panel')).toBeHidden()
  await expect(page.locator('.word')).toContainText('cupboards')
})

test('closing settings with a tap does not resume reading', async ({ page }) => {
  await page.goto('./')
  await upload(page)
  await page.getByRole('button', { name: 'Reading settings', exact: true }).click()
  await page.locator('.popover-backdrop').click({ position: { x: 5, y: 200 } })
  await expect(page.locator('.popover')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
})

test('unsupported files show a clear error', async ({ page }) => {
  await page.goto('./')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') })
  await expect(page.getByRole('alert')).toContainText('Chapter reads EPUB, PDF, TXT and Markdown files')
})

test('page mode guide: highlight, line or both, never neither', async ({ page }) => {
  await page.goto('./')
  await upload(page)
  await page.getByRole('button', { name: 'Reading settings', exact: true }).click()
  await page.getByRole('radio', { name: 'Page' }).click()
  const guide = page.getByRole('radiogroup', { name: 'Guide' })
  await expect(guide.getByRole('radio', { name: 'Both' })).toHaveAttribute('aria-checked', 'true')

  await guide.getByRole('radio', { name: 'Line' }).click()
  await page.locator('.popover-backdrop').click({ position: { x: 5, y: 5 } })
  await page.getByRole('button', { name: 'Forward one word', exact: true }).click()
  await expect(page.locator('.page-marker')).toBeHidden()
  await expect(page.locator('.page-pacer')).toBeVisible()

  await page.getByRole('button', { name: 'Reading settings', exact: true }).click()
  await guide.getByRole('radio', { name: 'Highlight' }).click()
  await page.locator('.popover-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(page.locator('.page-marker')).toBeVisible()
  await expect(page.locator('.page-pacer')).toBeHidden()
  await expect(page.locator('.page > .page-text')).toContainText('The rabbit ran across the field.')
})

test('holding the word glances back and letting go carries on', async ({ page }) => {
  await page.goto('./')
  await upload(page)
  for (let i = 0; i < 9; i++) await page.getByRole('button', { name: 'Forward one word', exact: true }).click()
  const word = page.locator('.word-frame')
  const box = (await word.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect(page.locator('.glance')).toContainText('The rabbit ran across the field. Alice followed it')
  await page.mouse.up()
  await expect(page.locator('.glance')).toBeHidden()
  // Swipe right: back to the start of this sentence (like Shift+←).
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('.word')).toHaveText('Alice')
})

test('a session can run for a set time or to a chapter end', async ({ page }) => {
  await page.goto('./')
  await upload(page, 'long.txt', ['Chapter 1', '', 'Word after word here. '.repeat(900), '', 'Chapter 2', '', 'More words to read. '.repeat(900)].join('\n'))

  // A set time: pick 5, nudge it up to 10, see where it ends, start.
  await page.locator('.session-open').click()
  await page.getByRole('radio', { name: '5', exact: true }).click()
  await page.getByRole('button', { name: '5 minutes more' }).click()
  await expect(page.locator('.session-number')).toHaveText('10')
  await expect(page.getByRole('radio', { name: '10', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.session-lands')).toContainText('Chapter')
  await page.getByRole('button', { name: 'Start reading' }).click()
  await expect(page.locator('.session-active')).toContainText('left in session')
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await page.locator('.session-end').click()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()

  // To a chapter end: one tap starts it.
  await page.locator('.session-open').click()
  await page.getByRole('radio', { name: 'Chapter', exact: true }).click()
  await expect(page.locator('.session-chapter').first()).toContainText('This chapter')
  await page.locator('.session-chapter').first().click()
  await expect(page.locator('.session-active')).toContainText('to the end of Chapter 1')
})

test('hold to read plays only while the text is held', async ({ page }) => {
  await page.goto('./')
  await upload(page)
  await page.getByRole('button', { name: 'Reading settings', exact: true }).click()
  await page.getByRole('button', { name: 'More settings' }).click()
  await page.getByRole('radio', { name: 'Hold', exact: true }).click()
  await expect(page.locator('.popover')).toContainText('pauses when you let go')
  await page.locator('.popover-backdrop').click({ position: { x: 5, y: 5 } })

  // Press anywhere on the reading area, not just the word: here, well above it.
  const stage = (await page.locator('.stage').boundingBox())!
  await page.mouse.move(stage.x + 20, stage.y + 20)
  await page.mouse.down()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await expect.poll(() => currentWord(page)).not.toBe('Chapter')
  // Let go anywhere, even off the word: reading stops.
  await page.mouse.move(5, 5)
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect(page.locator('.glance')).toBeHidden()
  const stopped = await currentWord(page)
  await page.waitForTimeout(600)
  expect(await currentWord(page)).toBe(stopped)
})

test('tapping anywhere plays and pauses, and holding never selects text', async ({ page }) => {
  await page.goto('./')
  await upload(page)
  // Let the page-open transition finish: taps during it go to the page root.
  await page.waitForFunction('document.getAnimations().length === 0')
  const stage = (await page.locator('.stage').boundingBox())!
  const corner = { x: stage.x + 20, y: stage.y + 20 }
  await page.mouse.click(corner.x, corner.y)
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await page.mouse.click(corner.x, corner.y)
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()

  // Tapping a word in the paused text jumps there instead of playing.
  await page.locator('.context [data-i]', { hasText: 'Alice' }).first().click()
  await expect(page.locator('.word')).toHaveText('Alice')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()

  // A long press dragged across the paused text selects nothing.
  const text = (await page.locator('.context p').boundingBox())!
  await page.mouse.move(text.x + 5, text.y + 10)
  await page.mouse.down()
  await page.mouse.move(text.x + text.width - 5, text.y + 10, { steps: 8 })
  await page.mouse.up()
  expect(await page.evaluate('String(window.getSelection())')).toBe('')
})

test('old settings with both page guides off come back with both on', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('migrated')) {
      localStorage.setItem('rsvp-settings', JSON.stringify({ mode: 'page', pageHighlight: false, pacer: false }))
      localStorage.setItem('migrated', '1')
    }
  })
  await page.goto('./')
  await upload(page)
  await page.getByRole('button', { name: 'Reading settings', exact: true }).click()
  await expect(page.getByRole('radiogroup', { name: 'Guide' }).getByRole('radio', { name: 'Both' })).toHaveAttribute('aria-checked', 'true')
})

test('holding to read keeps the controls hidden, through drift and page turns', async ({ page }) => {
  test.setTimeout(40_000)
  await page.goto('./')
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click()
  await expect(page.locator('.reader')).toBeVisible()
  await page.getByRole('button', { name: 'Reading settings', exact: true }).click()
  await page.getByRole('radio', { name: 'Page' }).click()
  await page.getByRole('button', { name: 'More settings' }).click()
  await page.getByRole('radio', { name: 'Hold', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.popover')).toBeHidden()
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowUp')
  await expect(page.locator('.speed-value')).toContainText('1050')
  await page.waitForFunction('document.getAnimations().length === 0')

  const firstWord = () => page.locator('.page-text [data-i]').first().getAttribute('data-i')
  const startPage = await firstWord()
  const box = (await page.locator('.page').boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  // A held finger drifts: keep nudging it while the pages turn.
  const hidden: boolean[] = []
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(x + (i % 2 ? 6 : -6), y + (i % 3) * 4)
    await page.waitForTimeout(200)
    // Once the controls have faded (after 2s), they must stay hidden.
    if (i >= 15) hidden.push(await page.locator('.reader.is-idle.is-playing').isVisible())
  }
  expect(hidden.every(Boolean)).toBe(true)
  expect(await firstWord()).not.toBe(startPage)
  await page.mouse.up()
  await expect(page.locator('.reader')).not.toHaveClass(/is-playing/)
})

test('the settings sheet dims the page without a coloured layer over the top', async ({ page }, testInfo) => {
  await page.goto('./')
  await upload(page)
  await page.getByRole('button', { name: 'Reading settings', exact: true }).click()
  // Safari would tint its top bar from a coloured backdrop and keep that colour.
  const backdrop = await page.evaluate(`getComputedStyle(document.querySelector('.popover-backdrop')).backgroundColor`)
  expect(backdrop).toBe('rgba(0, 0, 0, 0)')
  await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  if (testInfo.project.name === 'phone') {
    // The dimming comes from the sheet's shadow, which follows the theme.
    await expect.poll(() => page.evaluate(`getComputedStyle(document.querySelector('.settings-menu')).boxShadow`)).toContain('rgba(0, 0, 0, 0.5)')
    // The page background (where Safari takes its top bar colour from) is the
    // dimmed dark page, #121211 under half black, while the reader keeps its own.
    const pageColour = () => page.evaluate(`getComputedStyle(document.documentElement).backgroundColor`)
    await expect.poll(pageColour).toMatch(/0\.035/)
    await expect(page.locator('.reader')).toHaveCSS('background-color', 'rgb(18, 18, 17)')
    await page.locator('.popover-backdrop').click({ position: { x: 5, y: 5 } })
    await expect.poll(pageColour).toBe('rgb(18, 18, 17)')
  }
})
