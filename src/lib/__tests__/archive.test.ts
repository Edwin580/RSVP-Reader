import { describe, expect, it } from 'vitest'
import { parseLength, parseSearch, searchRecordings, searchTerms, searchUrl, tracksFromMetadata } from '../archive'

describe('Internet Archive', () => {
  it('searches for the title alone', () => {
    expect(searchTerms('Pride and Prejudice by Jane Austen')).toBe('Pride and Prejudice')
    expect(searchTerms('alice-in-wonderland.epub')).toBe('alice in wonderland')
    const url = new URL(searchUrl('Alice’s Adventures', true))
    expect(url.searchParams.get('q')).toBe('title:(Alice s Adventures) AND mediatype:(audio) AND collection:(librivoxaudio)')
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
    const results = await searchRecordings('Alice', fetcher)
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
})
