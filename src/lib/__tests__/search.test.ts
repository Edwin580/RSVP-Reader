import { describe, expect, it } from 'vitest'
import { buildSearchIndex, editDistance, search, stem, tokenize } from '../search'

const text =
  'Alice was beginning to get very tired of sitting by her sister on the bank. ' +
  'She had peeped into the book her sister was reading. ' +
  'Would making a daisy-chain be worth the trouble? ' +
  'Suddenly a White Rabbit with pink eyes ran close by her. ' +
  'The Rabbit said, “Oh dear! Oh dear! I shall be late!” ' +
  'The rabbits ran. Education matters. She was running; he runs. Café au lait, don’t worry.'
const words = text.split(' ')
const index = buildSearchIndex(words)
const phrase = (h: { start: number; end: number }) => words.slice(h.start, h.end + 1).join(' ')
const matched = (q: string) => search(index, q).matches.map(phrase)

describe('tokenize and stem', () => {
  it('splits into lowercase words without punctuation, accents or apostrophes', () => {
    expect(tokenize('“Daisy-chain!” Café, don’t')).toEqual(['daisy', 'chain', 'cafe', 'dont'])
  })

  it('joins common inflections with their base word', () => {
    for (const [a, b] of [['rabbits', 'rabbit'], ['running', 'run'], ['runs', 'run'], ['tired', 'tire'], ['making', 'make'], ['hoping', 'hope'], ['created', 'create'], ['creates', 'create'], ['stories', 'story'], ['boxes', 'box'], ['happily', 'happi']])
      expect(stem(a)).toBe(stem(b))
    expect(stem('this')).toBe('this')
    expect(stem('glass')).toBe('glass')
    expect(stem('here')).not.toBe(stem('her'))
  })

  it('weights typo distance towards missing and swapped letters', () => {
    expect(editDistance('rabit', 'rabbit', 2)).toBe(0.75)
    expect(editDistance('teh', 'the', 2)).toBe(0.75)
    expect(editDistance('wite', 'white', 2)).toBeLessThan(editDistance('wite', 'with', 2))
    expect(editDistance('kitten', 'sitting', 2)).toBe(3)
  })
})

describe('search matches', () => {
  it('matches whole words, never fragments of other words', () => {
    expect(matched('cat')).toEqual([])
    expect(matched('the ').every((w) => /^the$/i.test(w))).toBe(true)
  })

  it('matches different forms of a word', () => {
    expect(matched('rabbit')).toEqual(['Rabbit', 'Rabbit', 'rabbits'])
    expect(matched('rabbits')).toEqual(['Rabbit', 'Rabbit', 'rabbits'])
    expect(matched('run ')).toEqual(['running;', 'runs.'])
  })

  it('finds phrases regardless of case and punctuation, and hyphenated words as two', () => {
    expect(matched('white rabbit')).toEqual(['White Rabbit'])
    expect(matched('oh dear')).toEqual(['“Oh dear!', 'Oh dear!'])
    expect(matched('daisy chain')).toEqual(['daisy-chain'])
    expect(matched('cafe')).toEqual(['Café'])
    expect(matched('dont')).toEqual(['don’t'])
  })

  it('completes the last word while typing', () => {
    expect(matched('rabb')).toEqual(['Rabbit', 'Rabbit', 'rabbits'])
    expect(matched('white rab')).toEqual(['White Rabbit'])
    // A finished word (trailing space) doesn't expand.
    expect(matched('rabb ')).toEqual([])
  })
})

describe('related passages', () => {
  it('finds the important words close together when they are not a phrase', () => {
    const r = search(index, 'rabbit pink eyes')
    expect(r.totalMatches).toBe(0)
    expect(r.related.map(phrase)).toEqual(['Rabbit with pink eyes'])
    expect(r.related[0].highlights.map((i) => words[i])).toEqual(['Rabbit', 'pink', 'eyes'])
  })

  it('ignores word order and common words for related passages', () => {
    expect(search(index, 'sister the alice').related.length).toBe(1)
  })

  it('returns only the exact phrase when quoted', () => {
    const r = search(index, '"rabbit pink eyes"')
    expect(r.totalMatches + r.totalRelated).toBe(0)
    expect(search(index, '“white rabbit”').matches.map(phrase)).toEqual(['White Rabbit'])
  })

  it('does not list a phrase match again as related', () => {
    const r = search(index, 'white rabbit ')
    expect(r.totalMatches).toBe(1)
    expect(r.related.some((h) => h.start === r.matches[0].start)).toBe(false)
  })
})

describe('misspellings and no results', () => {
  it('falls back to the closest spelling and says so', () => {
    const r = search(index, 'rabit ')
    expect(r.correctedQuery).toBe('rabbit')
    expect(r.matches.map(phrase)).toEqual(['Rabbit', 'Rabbit', 'rabbits'])
    expect(search(index, 'rabi').correctedQuery).toBe('rabbit')
    expect(search(index, 'wite rabit ').correctedQuery).toBe('white rabbit')
    expect(search(index, 'wite rabit ').matches.map(phrase)).toEqual(['White Rabbit'])
  })

  it('prefers a well-attested spelling over a lookalike word form', () => {
    // "manderly" looks like a form of "mander" (→ Manders), but Manderley is far more common.
    const w = 'Manderley was grey. Manderley again, Manderley, Manderley and Manderley. Manders ran.'.split(' ')
    const r = search(buildSearchIndex(w), 'manderly ')
    expect(r.correctedQuery).toBe('manderley')
    expect(r.totalMatches).toBe(5)
  })

  it('splits a compound the book hyphenates', () => {
    const w = 'half cottage, half boat-house, built of stone.'.split(' ')
    expect(search(buildSearchIndex(w), 'boathouse ').matches.map((h) => w[h.start])).toEqual(['boat-house,'])
  })

  it('never guesses a word with a different first letter, except a swap', () => {
    // kernel ≠ herself (the old prefix comparison allowed two slips here)
    expect(search(index, 'kernel').correctedQuery).toBeUndefined()
    expect(search(index, 'hwite ').correctedQuery).toBe('white')
  })

  it('returns one hit per passage even when a word holds several matches', () => {
    const w = 'a well-well here and well there'.split(' ')
    const r = search(buildSearchIndex(w), 'well ')
    expect(r.matches.map((h) => [h.start, h.end])).toEqual([[1, 1], [4, 4]])
    expect(r.totalMatches).toBe(2)
  })

  it('returns nothing, without a correction, for words nowhere near the book', () => {
    for (const q of ['xyzzy', 'quantum physics', '', '   ', '!!!']) {
      const r = search(index, q)
      expect(r.totalMatches + r.totalRelated).toBe(0)
      expect(r.correctedQuery).toBeUndefined()
    }
  })

  it('reports totals beyond the limit', () => {
    const r = search(index, 'the ', 2)
    expect(r.matches.length).toBe(2)
    expect(r.totalMatches).toBeGreaterThan(2)
  })
})
