import { describe, expect, it } from 'vitest'
import { normalize, oneSlip, packIndex, rerank, searchIndex, searchTerms, unpackIndex, type IndexedBook } from '../catalogIndex'

const book = (id: string, title: string, author: string, tags: string[] = ['fiction'], extra: Partial<IndexedBook> = {}): IndexedBook => ({
  id,
  title,
  author,
  subjects: tags,
  tags,
  popular: 0,
  ...extra,
})

const BOOKS: IndexedBook[] = [
  book('jane-austen/pride-and-prejudice', 'Pride and Prejudice', 'Jane Austen', ['fiction'], { popular: 0, words: 121970, readingEase: 60.95 }),
  book('arthur-conan-doyle/the-adventures-of-sherlock-holmes', 'The Adventures of Sherlock Holmes', 'Arthur Conan Doyle', ['fiction', 'mystery', 'shorts'], { popular: 1, words: 105000, readingEase: 75 }),
  book('leo-tolstoy/war-and-peace/louise-maude_aylmer-maude', 'War and Peace', 'Leo Tolstoy', ['fiction'], { popular: 2, words: 566000 }),
  book('edgar-allan-poe/short-fiction', 'Short Fiction', 'Edgar Allan Poe', ['fiction', 'horror', 'shorts'], { popular: 3 }),
  book('john-donne/poetry', 'Poetry', 'John Donne', ['poetry'], { popular: 4 }),
  book('fyodor-dostoevsky/crime-and-punishment', 'Crime and Punishment', 'Fyodor Dostoevsky', ['fiction'], { popular: 5 }),
  book('mary-shelley/frankenstein', 'Frankenstein', 'Mary Shelley', ['fiction', 'horror', 'science-fiction'], { popular: 6, words: 77898, readingEase: 56 }),
  book('isaac-asimov/short-science-fiction', 'Short Science Fiction', 'Isaac Asimov', ['fiction', 'science-fiction', 'shorts'], { popular: 7, words: 30000, readingEase: 80 }),
  book('emile-zola/germinal', 'Germinal', 'Émile Zola', ['fiction'], { popular: 8 }),
  book('jane-austen/emma', 'Emma', 'Jane Austen', ['fiction'], { popular: 9 }),
]
const titles = (list: IndexedBook[]) => list.map((b) => b.title)
const find = (query: string, rest = {}) => titles(searchIndex(BOOKS, { query, ...rest }).matches)

describe('searchIndex', () => {
  it('finds a word still being typed', () => {
    expect(find('sherl')).toEqual(['The Adventures of Sherlock Holmes'])
    expect(find('holm')).toEqual(['The Adventures of Sherlock Holmes'])
    expect(find('pride prej')).toEqual(['Pride and Prejudice'])
  })

  it('puts the title, as typed, first: "war and peace" is War and Peace', () => {
    expect(find('war and peace')[0]).toBe('War and Peace')
  })

  it('ranks a whole word above the start of a longer one: "poe" is Poe before Poetry', () => {
    expect(find('poe')).toEqual(['Short Fiction', 'Poetry'])
  })

  it('finds by author and subject, and every word must match', () => {
    expect(find('austen')).toEqual(['Pride and Prejudice', 'Emma'])
    expect(find('jane emma')).toEqual(['Emma'])
    expect(find('horror')).toEqual(['Short Fiction', 'Frankenstein'])
  })

  it('understands common ways of naming a subject', () => {
    expect(searchTerms('Sci-Fi stories')).toEqual(['science', 'fiction', 'stories'])
    expect(find('sci fi')).toEqual(['Short Science Fiction', 'Frankenstein'])
  })

  it('ignores case, accents and punctuation', () => {
    expect(find('EMILE zola')).toEqual(['Germinal'])
    expect(find('pride & prejudice!')).toEqual(['Pride and Prejudice'])
  })

  it('finds a typing slip, apart from the matches', () => {
    expect(searchIndex(BOOKS, { query: 'dostoyevsky' })).toEqual({ matches: [], close: [BOOKS[5]] })
    expect(titles(searchIndex(BOOKS, { query: 'frankenstien' }).close)).toEqual(['Frankenstein'])
    // Not for short words, which would match everything.
    expect(searchIndex(BOOKS, { query: 'emna' }).close).toEqual([])
  })

  it('keeps to a subject, and sorts when asked', () => {
    expect(find('short', { subject: 'science-fiction' })).toEqual(['Short Science Fiction'])
    expect(find('fiction', { sort: 'length' })[0]).toBe('Short Science Fiction')
    expect(find('fiction', { sort: 'reading-ease' })[0]).toBe('Short Science Fiction')
  })

  it('is quick on the whole catalog', () => {
    const catalog = Array.from({ length: 1600 }, (_, k) => book(`a/b${k}`, `Book ${k} of the sea`, `Author ${k % 90}`, ['fiction'], { popular: k }))
    searchIndex(catalog, { query: 'sea' })
    const start = performance.now()
    for (let k = 0; k < 20; k++) searchIndex(catalog, { query: `author ${k}` })
    expect((performance.now() - start) / 20).toBeLessThan(15)
  })
})

describe('rerank', () => {
  it('puts the site’s results matching a title or author first, keeping the rest in the site’s order', () => {
    const fromSite = [BOOKS[4], BOOKS[2], BOOKS[0]] // as the site ranked "war and peace": poetry first
    expect(titles(rerank(fromSite, 'war and peace'))).toEqual(['War and Peace', 'Poetry', 'Pride and Prejudice'])
    expect(titles(rerank(fromSite, 'war and peace', 'length'))).toEqual(titles(fromSite))
    // Nothing searched yet (typing just began): as the site gave them.
    expect(titles(rerank(fromSite, ''))).toEqual(titles(fromSite))
  })
})

describe('oneSlip', () => {
  it('allows one letter added, missing, wrong, or two swapped', () => {
    expect(oneSlip('dostoyevsky', 'dostoevsky')).toBe(true)
    expect(oneSlip('frankenstien', 'frankenstein')).toBe(true)
    expect(oneSlip('austin', 'austen')).toBe(true)
    expect(oneSlip('austen', 'austen')).toBe(true)
    expect(oneSlip('dickens', 'dikcnes')).toBe(false)
    expect(oneSlip('verne', 'vernes12')).toBe(false)
  })
})

describe('the list as kept', () => {
  it('keeps only what searching needs, and finds each cover from the address', () => {
    const rows = packIndex(BOOKS)
    expect(rows[0]).toEqual(['jane-austen/pride-and-prejudice', 'Pride and Prejudice', 'Jane Austen', 121970, 60.95, 'fiction'])
    const back = unpackIndex(rows)
    expect(back[2]).toMatchObject({ id: 'leo-tolstoy/war-and-peace/louise-maude_aylmer-maude', popular: 2, tags: ['fiction'], subjects: ['Fiction'] })
    expect(back[2].cover).toBe('https://standardebooks.org/ebooks/leo-tolstoy/war-and-peace/louise-maude_aylmer-maude/downloads/cover-thumbnail.jpg')
    expect(back[6].subjects).toEqual(['Fiction', 'Horror', 'Science fiction'])
    expect(JSON.stringify(rows).length / rows.length).toBeLessThan(120)
  })
})

describe('normalize', () => {
  it('keeps letters and numbers only, lower case and without accents', () => {
    expect(normalize('Émile Zola’s “Germinal” (1885)')).toBe('emile zola s germinal 1885')
  })
})
