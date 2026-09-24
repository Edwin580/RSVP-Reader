import { describe, expect, it } from 'vitest'
import { createDemoBook, DEMO_ID } from '../demo'
import { buildSearchIndex, search } from '../search'

describe('demo book', () => {
  const book = createDemoBook()

  it('has chapters with titles set as headings', () => {
    expect(book.id).toBe(DEMO_ID)
    expect(book.chapters.map((c) => c.title)).toEqual([
      'Before you start',
      'Chapter I: Down the Rabbit-Hole',
      'Chapter II: The Pool of Tears',
    ])
    expect(book.headings?.length).toBe(5)
  })

  it('is short enough to try in a few minutes', () => {
    expect(book.words.length).toBeGreaterThan(500)
    expect(book.words.length / 300).toBeLessThan(5)
  })

  it('finds "rabbit", as the tips suggest', () => {
    expect(search(buildSearchIndex(book.words), 'rabbit ').totalMatches).toBeGreaterThan(3)
  })
})
