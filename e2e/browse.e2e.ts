import { expect, test } from '@playwright/test'
import { mockCatalog, openBrowse } from './catalog.ts'

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
  await expect(list.getByRole('listitem')).toHaveCount(12)
  await expect(list.getByRole('button').first()).toContainText('Pride and Prejudice')
  await expect(list.getByRole('button').first()).toContainText('Jane Austen')
  await expect(list.getByRole('button').first()).toContainText('121,970 words')
  expect(catalog.searches()[0].searchParams.get('sort')).toBe('popularity')

  // More books, added below the ones already there.
  await page.getByRole('button', { name: 'Show more' }).click()
  await expect(list.getByRole('listitem')).toHaveCount(18)
  expect(catalog.searches().at(-1)!.searchParams.get('page')).toBe('2')

  // A subject and an order each search again from the first page.
  await page.getByRole('button', { name: 'Mystery' }).click()
  await expect(page.getByRole('button', { name: 'Mystery' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => catalog.searches().at(-1)!.searchParams.getAll('tags[]')).toEqual(['mystery'])
  await page.getByRole('radio', { name: 'Newest' }).click()
  await expect.poll(() => catalog.searches().at(-1)!.searchParams.get('sort')).toBe('newest')
  expect(catalog.searches().at(-1)!.searchParams.has('page')).toBe(false)

  // Searching, as you type.
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search free books' }).fill('austen')
  await expect.poll(() => catalog.searches().at(-1)!.searchParams.get('query')).toBe('austen')
  await expect(list.getByRole('listitem')).toHaveCount(7)
  await page.getByRole('searchbox', { name: 'Search free books' }).fill('nothing like it')
  await expect(page.getByText('No books match.')).toBeVisible()

  await page.getByRole('button', { name: 'Back to your library' }).click()
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
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
  // Twice: one dropped connection is retried on its own.
  catalog.failNext(/\/ebooks\?/)
  catalog.failNext(/\/ebooks\?/)
  await page.goto('./')
  await page.getByRole('button', { name: /Find a free book/ }).click()
  await expect(page.getByRole('alert')).toContainText('Couldn’t reach Standard Ebooks')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('list', { name: 'Books' }).getByRole('listitem')).toHaveCount(12)
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
