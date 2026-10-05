import { describe, expect, it } from 'vitest'
import { authorFromTitle, authorTerm, sameBook, seemsAbridged, gutenbergAuthor, parseLength, parseSearch, searchRecordings, searchTerms, searchUrl, tracksFromMetadata } from '../archive'

describe('Internet Archive', () => {
  it('searches for the title alone', () => {
    expect(searchTerms('Pride and Prejudice by Jane Austen')).toBe('Pride and Prejudice')
    expect(searchTerms('alice-in-wonderland.epub')).toBe('alice in wonderland')
    // Apostrophes stay, straightened: the Archive finds "Alice's" but not "Alices" or "Alice s".
    const url = new URL(searchUrl('Alice’s Adventures', true))
    expect(url.searchParams.get('q')).toBe("title:(Alice's Adventures) AND mediatype:(audio) AND collection:(librivoxaudio)")
  })

  it('reads search results', () => {
    const json = { response: { docs: [{ identifier: 'alice_1003', title: 'Alice', creator: ['Lewis Carroll'] }, { title: 'no id' }] } }
    expect(parseSearch(json, true)).toEqual([{ identifier: 'alice_1003', title: 'Alice', creator: 'Lewis Carroll', librivox: true }])
    expect(parseSearch(null, true)).toEqual([])
  })

  it('looks beyond LibriVox when it has little', async () => {
    const fetcher = (async (url: string) => {
      const librivox = url.includes('librivoxaudio')
      const docs = librivox ? [{ identifier: 'lv', title: 'A' }] : [{ identifier: 'lv', title: 'A' }, { identifier: 'other', title: 'B' }]
      return new Response(JSON.stringify({ response: { docs } }))
    }) as typeof fetch
    const results = await searchRecordings('Alice', undefined, fetcher)
    expect(results.map((r) => [r.identifier, r.librivox])).toEqual([
      ['lv', true],
      ['other', false],
    ])
  })

  it('lists one format’s MP3s in order, with their lengths', () => {
    const json = {
      files: [
        { name: 'alice_02_carroll.mp3', format: 'VBR MP3', title: '02 The Pool of Tears', length: '775.29', track: '2/12' },
        { name: 'alice_02_carroll_64kb.mp3', format: '64Kbps MP3', title: '02 The Pool of Tears', length: '12:55' },
        { name: 'alice_10_carroll_64kb.mp3', format: '64Kbps MP3', title: '10 The Lobster Quadrille', length: '13:50' },
        { name: 'alice_01_carroll_64kb.mp3', format: '64Kbps MP3', title: '01 Down the Rabbit Hole', length: '13:16' },
        { name: 'cover.jpg', format: 'JPEG' },
      ],
    }
    expect(tracksFromMetadata('alice 1', json)).toEqual([
      { url: 'https://archive.org/download/alice%201/alice_01_carroll_64kb.mp3', title: '01 Down the Rabbit Hole', seconds: 796 },
      { url: 'https://archive.org/download/alice%201/alice_02_carroll_64kb.mp3', title: '02 The Pool of Tears', seconds: 775 },
      { url: 'https://archive.org/download/alice%201/alice_10_carroll_64kb.mp3', title: '10 The Lobster Quadrille', seconds: 830 },
    ])
  })

  it('reads lengths in either form', () => {
    expect(parseLength('1:02:03')).toBe(3723)
    expect(parseLength('796.5')).toBe(796.5)
    expect(parseLength(undefined)).toBe(0)
  })

  it('searches by the author’s surname, however the name is written', () => {
    expect(authorTerm('Lewis Carroll')).toBe('Carroll')
    expect(authorTerm('Carroll, Lewis')).toBe('Carroll')
    expect(authorTerm('Martin Luther King, Jr.')).toBe('King')
    expect(authorTerm('Kurt Vonnegut Jr.')).toBe('Vonnegut')
    expect(authorTerm('Jane Austen; Tony Tanner')).toBe('Austen')
    expect(authorTerm(undefined)).toBe('')
    const url = new URL(searchUrl('Emma', true, 'Jane Austen'))
    expect(url.searchParams.get('q')).toBe('title:(Emma) AND creator:(Austen) AND mediatype:(audio) AND collection:(librivoxaudio)')
  })

  it('finds the author in a Gutenberg header or a title', () => {
    expect(gutenbergAuthor('The Project Gutenberg eBook\n\nTitle: Emma\r\nAuthor: Jane Austen\r\n')).toBe('Jane Austen')
    expect(gutenbergAuthor('No header here')).toBeUndefined()
    expect(authorFromTitle('Pride and Prejudice by Jane Austen')).toBe('Jane Austen')
  })

  it('looks by author first, then by title alone when that finds too few', async () => {
    const asked: string[] = []
    const fetcher = (async (url: string) => {
      const q = new URL(url).searchParams.get('q')!
      asked.push(q)
      const docs = q.includes('creator') ? (q.includes('librivox') ? [{ identifier: 'austen_emma' }] : []) : [{ identifier: 'other_emma' }, { identifier: 'third' }]
      return new Response(JSON.stringify({ response: { docs } }))
    }) as typeof fetch
    const results = await searchRecordings('Emma', 'Jane Austen', fetcher)
    expect(results.map((r) => r.identifier)).toEqual(['austen_emma', 'other_emma', 'third'])
    expect(asked[0]).toContain('creator:(Austen)')
  })

  it('tells recordings of this book from other books with similar titles', () => {
    const r = (title: string, creator: string) => ({ identifier: 'x', title, creator, librivox: true })
    expect(sameBook(r('Rebecca', 'Daphne Du Maurier'), 'Rebecca', 'Daphne du Maurier')).toBe(true)
    expect(sameBook(r('Rebecca of Sunnybrook Farm', 'Kate Douglas Wiggin'), 'Rebecca', 'Daphne du Maurier')).toBe(false)
    expect(sameBook(r('*Du Maurier - Rebecca - 1973 Trantow Pasetti', 'Daphne Du Maurier'), 'Rebecca', 'Daphne du Maurier')).toBe(false)
    expect(sameBook(r("Alice's Adventures in Wonderland, by Lewis Carroll", 'Lewis Carroll'), 'Alice’s Adventures in Wonderland', 'Lewis Carroll')).toBe(true)
    expect(sameBook(r("Alice's Adventures in Wonderland (version 6)", 'Lewis Carroll'), 'Alice’s Adventures in Wonderland', undefined)).toBe(true)
    expect(sameBook(r('The Five People You Meet in Heaven', 'Mitch Albom'), 'The Five People You Meet in Heaven: A Novel', 'Mitch Albom')).toBe(true)
  })

  it('knows a recording far shorter than the book can’t be all of it', () => {
    // Rebecca is about 160,000 words: some 17 hours aloud, not 84 minutes.
    expect(seemsAbridged(84 * 60, 160000)).toBe(true)
    expect(seemsAbridged(15 * 3600, 160000)).toBe(false)
  })
})
