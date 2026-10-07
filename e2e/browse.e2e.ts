import { expect, test } from '@playwright/test'
import { CATALOG_SIZE, mockCatalog, openBrowse } from './catalog.ts'

/*
 * Finding a free book: browse and search the catalog, read about a book and
 * a preview of it, and add it, which downloads it only once confirmed.
 * Standard Ebooks is stood in for by saved pages (see catalog.ts).
 */

test('browse the catalog: popular first, search, subjects, order, and more', async ({ page }) => {
  const catalog = await mockCatalog(page)
  await page.goto('./')
  await openBrowse(page)
  const list = page.getByRole('list', { name: 'Books' })
  // The whole catalog arrives in the background; 30 are listed to start with.
  await expect(page.getByText(`${CATALOG_SIZE} books`, { exact: true })).toBeVisible()
  await expect(list.getByRole('listitem')).toHaveCount(30)
  await expect(list.getByRole('button').first()).toContainText('Pride and Prejudice')
  await expect(list.getByRole('button').first()).toContainText('Jane Austen')
  await expect(list.getByRole('button').first()).toContainText('121,970 words')
  expect(catalog.searches().map((u) => u.searchParams.get('page') ?? '1').sort()).toEqual(['1', '2'])

  await page.getByRole('button', { name: 'Show more' }).click()
  await expect(list.getByRole('listitem')).toHaveCount(CATALOG_SIZE)

  // Subjects, order and search all work on what's on the device: nothing more is fetched.
  const before = catalog.searches().length
  await page.getByRole('button', { name: 'Mystery' }).click()
  await expect(page.getByRole('button', { name: 'Mystery' })).toHaveAttribute('aria-pressed', 'true')
  await expect(list.getByRole('button')).toHaveText([/The Hound of the Baskervilles/])
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByRole('radio', { name: 'Shortest' }).click()
  await expect(list.getByRole('button').first()).toContainText('Book 1')
  await page.getByRole('searchbox', { name: 'Search free books' }).fill('austen')
  await expect(page.getByRole('radio', { name: 'Shortest' })).toHaveAttribute('aria-checked', 'true')
  await expect(list.getByRole('button')).toHaveText([/Pride and Prejudice/, /Emma/])
  await page.getByRole('radio', { name: 'Best match' }).click()
  await page.getByRole('searchbox', { name: 'Search free books' }).fill('nothing like it')
  await expect(page.getByText('No books match.')).toBeVisible()
  expect(catalog.searches()).toHaveLength(before)

  // Newest needs the newest-first order, fetched only when it's picked.
  await page.getByRole('searchbox', { name: 'Search free books' }).fill('')
  await page.getByRole('radio', { name: 'Newest' }).click()
  await expect(list.getByRole('button').first()).toContainText('Book 54')
  expect(catalog.searches().some((u) => u.searchParams.get('sort') === 'newest')).toBe(true)

  await page.getByRole('button', { name: 'Back to your library' }).click()
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
})

test('the catalog and the books looked at are kept: coming back fetches nothing', async ({ page }) => {
  const catalog = await mockCatalog(page)
  await page.goto('./')
  await openBrowse(page)
  await expect(page.getByText(`${CATALOG_SIZE} books`, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Pride and Prejudice/ }).click()
  await expect(page.getByText(/A Regency-era novel of manners/)).toBeVisible()
  // The preview's contents were fetched with the book, so the preview opens complete.
  await expect.poll(() => catalog.requests.some((u) => u.pathname.endsWith('/text'))).toBe(true)
  await page.getByRole('button', { name: 'Read a preview' }).click()
  await expect(page.getByText(/^It is a truth universally acknowledged/)).toBeVisible()

  // Opened again later: everything comes from the device.
  await page.reload()
  const seen = catalog.requests.length
  await openBrowse(page)
  await expect(page.getByText(`${CATALOG_SIZE} books`, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Pride and Prejudice/ }).click()
  await expect(page.getByText(/A Regency-era novel of manners/)).toBeVisible()
  await page.getByRole('button', { name: 'Read a preview' }).click()
  await expect(page.getByText(/^It is a truth universally acknowledged/)).toBeVisible()
  expect(catalog.requests.slice(seen).filter((u) => !/\.(jpe?g|png|avif)$/.test(u.pathname))).toEqual([])
})

test('a book’s page is fetched as soon as its row is touched', async ({ page }) => {
  const catalog = await mockCatalog(page)
  await page.goto('./')
  await openBrowse(page)
  const row = page.getByRole('button', { name: /Pride and Prejudice/ })
  await row.hover()
  await page.mouse.down()
  // Once, though both the hover and the press asked for it.
  await expect.poll(() => catalog.bookPages().map((u) => u.pathname)).toEqual(['/ebooks/jane-austen/pride-and-prejudice'])
  await page.mouse.up()
  await expect(page.getByText(/A Regency-era novel of manners/)).toBeVisible()
  expect(catalog.bookPages()).toHaveLength(1)
})

test('a book: what it’s about, how long it takes, and a preview from the first chapter', async ({ page }) => {
  await mockCatalog(page)
  await page.goto('./')
  await openBrowse(page)
  await page.getByRole('button', { name: /Pride and Prejudice/ }).click()
  await expect(page.getByRole('heading', { name: 'Pride and Prejudice' })).toBeVisible()
  await expect(page.getByText(/A Regency-era novel of manners/)).toBeVisible()
  await expect(page.getByText(/may today be one of Jane Austen’s most enduring novels/)).toBeVisible()
  await expect(page.getByText(/121,970 words · about 6h 47m at 300 wpm · Average to read/)).toBeVisible()

  await page.getByRole('button', { name: 'Read a preview' }).click()
  // The title page and imprint are skipped.
  await expect(page.getByText('Preview · Chapter I', { exact: true })).toBeVisible()
  await expect(page.getByText(/^It is a truth universally acknowledged/)).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('Preview · Chapter II', { exact: true })).toBeVisible()

  // Back to the book, then to the list.
  await page.getByRole('button', { name: 'Pride and Prejudice' }).click()
  await expect(page.getByRole('button', { name: 'Read a preview' })).toBeVisible()
  await page.getByRole('button', { name: 'Free books' }).click()
  await expect(page.getByRole('list', { name: 'Books' })).toBeVisible()
})

test('a book is downloaded only once confirmed, then opens at its first chapter', async ({ page }) => {
  const catalog = await mockCatalog(page)
  await page.goto('./')
  await openBrowse(page)
  await page.getByRole('button', { name: /Pride and Prejudice/ }).click()

  // Asked first; cancelling downloads nothing.
  await page.getByRole('button', { name: 'Add to library' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add Pride and Prejudice' })
  await expect(sheet).toContainText('Add “Pride and Prejudice” to your library?')
  await sheet.getByRole('button', { name: 'Cancel' }).click()
  await expect(sheet).toBeHidden()
  await page.getByRole('button', { name: 'Add to library' }).click()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  // Escape closed only the sheet, not the book.
  await expect(page.getByRole('button', { name: 'Read a preview' })).toBeVisible()
  expect(catalog.downloads()).toHaveLength(0)

  await page.getByRole('button', { name: 'Add to library' }).click()
  await sheet.getByRole('button', { name: 'Download and add' }).click()
  await expect(page.locator('.reader')).toBeVisible()
  expect(catalog.downloads()).toHaveLength(1)
  expect(catalog.downloads()[0].searchParams.get('source')).toBe('download')
  // Past the title page and imprint, at the heading of chapter I.
  await expect(page.locator('.word')).toHaveText('I')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.word')).toHaveText('It')

  // In the library now, and shown so when browsing.
  await page.locator('.nav-button').click()
  await expect(page.locator('.shelf-title')).toHaveText(['Pride and Prejudice'])
  await openBrowse(page)
  await expect(page.getByRole('button', { name: /Pride and Prejudice/ })).toContainText('In your library')
  await page.getByRole('button', { name: /Pride and Prejudice/ }).click()
  await page.getByRole('button', { name: 'Open from your library' }).click()
  await expect(page.locator('.reader')).toBeVisible()
  expect(catalog.downloads()).toHaveLength(1)
})

test('when the catalog can’t be reached, it says so and tries again', async ({ page }) => {
  const catalog = await mockCatalog(page)
  // Every try: a dropped connection is retried on its own, and each page is tried three times.
  for (let k = 0; k < 6; k++) catalog.failNext(/\/ebooks\?/)
  await page.goto('./')
  await page.getByRole('button', { name: /Find a free book/ }).click()
  await expect(page.getByRole('alert')).toContainText('Couldn’t reach Standard Ebooks')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText(`${CATALOG_SIZE} books`, { exact: true })).toBeVisible()
})

test('a failed download can be tried again from the same sheet', async ({ page }) => {
  const catalog = await mockCatalog(page)
  await page.goto('./')
  await openBrowse(page)
  await page.getByRole('button', { name: /Pride and Prejudice/ }).click()
  catalog.failNext(/\.epub/)
  catalog.failNext(/\.epub/)
  await page.getByRole('button', { name: 'Add to library' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add Pride and Prejudice' })
  await sheet.getByRole('button', { name: 'Download and add' }).click()
  await expect(sheet.getByRole('alert')).toContainText('Couldn’t reach Standard Ebooks')
  await sheet.getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('.reader')).toBeVisible()
})
