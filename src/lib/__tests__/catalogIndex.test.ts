import { describe, expect, it } from 'vitest'
import { INDEX_MAX_AGE_MS, INDEX_VERSION, freshness, normalize, searchIndex, withNewest, type IndexedBook } from '../catalogIndex'

const book = (id: string, title: string, author: string, extra: Partial<IndexedBook> = {}): IndexedBook => ({
  id,
  title,
  author,
  subjects: [],
  tags: [],
  popular: 0,
  ...extra,
})

const BOOKS: IndexedBook[] = [
  book('jane-austen/pride-and-prejudice', 'Pride and Prejudice', 'Jane Austen', { popular: 0, words: 121970, readingEase: 60.95, subjects: ['Fiction'], tags: ['fiction'] }),
  book('mary-shelley/frankenstein', 'Frankenstein', 'Mary Shelley', { popular: 1, words: 77898, readingEase: 56.3, subjects: ['Fiction', 'Horror', 'Science Fiction'], tags: ['fiction', 'horror', 'science-fiction'] }),
  book('jules-verne/twenty-thousand-leagues', 'Twenty Thousand Leagues Under the Seas', 'Jules Verne', { popular: 2, words: 140000, readingEase: 70, subjects: ['Adventure', 'Fiction', 'Science Fiction'], tags: ['adventure', 'fiction', 'science-fiction'] }),
  book('emile-zola/germinal', 'Germinal', 'Émile Zola', { popular: 3, words: 180000, subjects: ['Fiction'], tags: ['fiction'] }),
  book('jane-austen/emma', 'Emma', 'Jane Austen', { popular: 4, words: 160000, readingEase: 63, subjects: ['Fiction'], tags: ['fiction'] }),
  book('robert-louis-stevenson/treasure-island', 'Treasure Island', 'Robert Louis Stevenson', { popular: 5, words: 67000, readingEase: 80, subjects: ['Adventure', 'Fiction'], tags: ['adventure', 'fiction'] }),
]
const titles = (list: IndexedBook[]) => list.map((b) => b.title)

describe('searchIndex', () => {
  it('lists everything, most popular first, with nothing searched', () => {
    expect(titles(searchIndex(BOOKS, {}))[0]).toBe('Pride and Prejudice')
    expect(searchIndex(BOOKS, {})).toHaveLength(BOOKS.length)
  })

  it('filters by subject on the device', () => {
    expect(titles(searchIndex(BOOKS, { subject: 'adventure' }))).toEqual(['Twenty Thousand Leagues Under the Seas', 'Treasure Island'])
    expect(titles(searchIndex(BOOKS, { subject: 'science-fiction' }))).toEqual(['Frankenstein', 'Twenty Thousand Leagues Under the Seas'])
    expect(searchIndex(BOOKS, { subject: 'poetry' })).toEqual([])
  })

  it('finds by title, author or subject, from the start of a word, as you type', () => {
    expect(titles(searchIndex(BOOKS, { query: 'austen' }))).toEqual(['Pride and Prejudice', 'Emma'])
    expect(titles(searchIndex(BOOKS, { query: 'treas' }))).toEqual(['Treasure Island'])
    expect(titles(searchIndex(BOOKS, { query: 'horror' }))).toEqual(['Frankenstein'])
    // Inside a word doesn't count: "ice" isn't "Prejudice".
    expect(searchIndex(BOOKS, { query: 'ice' })).toEqual([])
  })

  it('needs every word to match, and ignores case, accents and punctuation', () => {
    expect(titles(searchIndex(BOOKS, { query: 'jane emma' }))).toEqual(['Emma'])
    expect(titles(searchIndex(BOOKS, { query: 'EMILE zola' }))).toEqual(['Germinal'])
    expect(titles(searchIndex(BOOKS, { query: 'pride & prejudice!' }))).toEqual(['Pride and Prejudice'])
  })

  it('puts title matches before author and subject matches', () => {
    const many = [...BOOKS, book('x/fiction-writer', 'The Art of Fiction', 'Henry James', { popular: 9 })]
    expect(titles(searchIndex(many, { query: 'fiction' }))[0]).toBe('The Art of Fiction')
  })

  it('sorts by ease, length or newest when asked, with a search too', () => {
    expect(titles(searchIndex(BOOKS, { sort: 'reading-ease' })).slice(0, 2)).toEqual(['Treasure Island', 'Twenty Thousand Leagues Under the Seas'])
    expect(titles(searchIndex(BOOKS, { sort: 'length' }))[0]).toBe('Treasure Island')
    // Books without a reading ease go last.
    expect(titles(searchIndex(BOOKS, { sort: 'reading-ease' })).at(-1)).toBe('Germinal')
    const newest = withNewest(BOOKS, ['jane-austen/emma', 'emile-zola/germinal'])
    expect(titles(searchIndex(newest, { sort: 'newest' })).slice(0, 2)).toEqual(['Emma', 'Germinal'])
    expect(titles(searchIndex(BOOKS, { query: 'jane', sort: 'length' }))).toEqual(['Pride and Prejudice', 'Emma'])
  })

  it('is quick on the whole catalog', () => {
    const catalog = Array.from({ length: 1600 }, (_, k) => book(`a/b${k}`, `Book ${k} of the sea`, `Author ${k % 90}`, { popular: k, subjects: ['Fiction'], tags: ['fiction'] }))
    searchIndex(catalog, { query: 'sea' })
    const start = performance.now()
    for (let k = 0; k < 20; k++) searchIndex(catalog, { query: `author ${k}`, subject: 'fiction' })
    expect((performance.now() - start) / 20).toBeLessThan(15)
  })
})

describe('normalize', () => {
  it('keeps letters and numbers only, lower case and without accents', () => {
    expect(normalize('Émile Zola’s “Germinal” (1885)')).toBe('emile zola s germinal 1885')
  })
})

describe('freshness', () => {
  const index = { version: INDEX_VERSION, builtAt: 1000, books: BOOKS, hasNewest: false }
  it('says when an index should be fetched again', () => {
    expect(freshness(undefined, 0)).toBe('missing')
    expect(freshness({ ...index, version: INDEX_VERSION - 1 }, 1000)).toBe('missing')
    expect(freshness({ ...index, books: [] }, 1000)).toBe('missing')
    expect(freshness(index, 1000 + INDEX_MAX_AGE_MS)).toBe('fresh')
    expect(freshness(index, 1001 + INDEX_MAX_AGE_MS)).toBe('stale')
  })
})
