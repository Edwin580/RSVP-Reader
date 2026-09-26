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
  await expect(page.getByRole('alert')).toContainText('Unsupported file type')
})

test('page mode highlight and pacer can be switched off', async ({ page }) => {
  await page.goto('./')
  await upload(page)
  await page.getByRole('button', { name: 'Reading settings', exact: true }).click()
  await page.getByRole('radio', { name: 'Page' }).click()
  await page.getByRole('switch', { name: 'Highlight the current word' }).uncheck()
  await page.getByRole('switch', { name: 'Pacer line' }).uncheck()
  await page.locator('.popover-backdrop').click({ position: { x: 5, y: 5 } })
  await page.getByRole('button', { name: 'Forward one word', exact: true }).click()
  await expect(page.locator('.page-marker')).toBeHidden()
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
