import { describe, expect, it } from 'vitest'
import { alignTranscript } from '../align'
import { parseTimestamps, timeAt, wordAt } from '../audio'

const book = `CHAPTER I. Down the Rabbit-Hole

Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice
she had peeped into the book her sister was reading, but it had no pictures or conversations in it, “and what is the
use of a book,” thought Alice “without pictures or conversations?” So she was considering in her own mind (as well as
she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be
worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.`
  .split(/\s+/)
  .filter(Boolean)

/** Captions as YouTube's automatic ones come: lower case, no punctuation, the odd word misheard, after an intro. */
const captions = `0:00
this is a librivox recording all librivox
0:05
recordings are in the public domain
0:12
chapter one down the rabbit hole
0:16
alice was beginning to get very tired of sitting
0:20
by her sister on the bank and of having nothing to do
0:25
once or twice she had peeped into the book her sister was reading
0:30
but it had no pictures or conversations in it and what is the
0:35
use of a book thought alice without pictures or conversations
0:40
so she was considering in her own mind as well as she could
0:45
for the hot day made her feel very sleepy and stupid
0:50
whether the pleasure of making a daisy chain would be worth the trouble
0:56
of getting up and picking the daisies when suddenly a white rabbit
1:01
with pink ice ran close by her`

describe('matching a transcript to the book', () => {
  const points = alignTranscript(parseTimestamps(captions), book)
  const at = (word: string) => book.indexOf(word)

  it('finds where the reading starts, past the recording’s intro', () => {
    expect(points.length).toBeGreaterThan(5)
    // "Alice was beginning" is said at 0:16.
    expect(timeAt(points, at('Alice'))).toBeGreaterThanOrEqual(15)
    expect(timeAt(points, at('Alice'))).toBeLessThanOrEqual(17)
  })

  it('knows which word is being read at a moment, within a word or two', () => {
    // "peeped" is about a third of the way through the line said at 0:25.
    expect(Math.abs(wordAt(points, 27, book.length) - at('peeped'))).toBeLessThanOrEqual(2)
    expect(Math.abs(wordAt(points, 56, book.length) - at('getting'))).toBeLessThanOrEqual(2)
  })

  it('is always later in the recording further into the book', () => {
    for (let k = 1; k < points.length; k++) {
      expect(points[k].index).toBeGreaterThan(points[k - 1].index)
      expect(points[k].seconds).toBeGreaterThan(points[k - 1].seconds)
    }
  })

  it('finds nothing in a transcript of a different book', () => {
    const other = parseTimestamps('0:00\nit was the best of times it was the worst of times\n0:05\nit was the age of wisdom')
    expect(alignTranscript(other, book)).toEqual([])
  })
})
