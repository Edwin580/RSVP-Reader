import { expect, type Page } from '@playwright/test'

/** A short two-chapter book. */
export const STORY = [
  'Chapter 1',
  '',
  'The rabbit ran across the field. Alice followed it to a hole under the hedge. She looked in and saw nothing but darkness.',
  '',
  'Chapter 2',
  '',
  'Down she went, past cupboards and shelves. The fall seemed to last for ever, and she wondered where she would land.',
].join('\n')

/** Add a book from text and wait for it to open. */
export async function upload(page: Page, name = 'story.txt', text = STORY) {
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) })
  await expect(page.locator('.reader')).toBeVisible()
}

