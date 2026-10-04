import { describe, expect, it } from 'vitest'
import { alignChapter, findPauses } from '../pauses'
import { buildTimeline } from '../rsvp'

const RATE = 8000

/** Loud noise for speech and near-silence for pauses, like a narrator in a quiet room. */
function recording(list: ({ speech: number } | { silence: number })[]): Float32Array {
  const total = list.reduce((s, p) => s + ('speech' in p ? p.speech : p.silence), 0)
  const out = new Float32Array(Math.ceil(total * RATE))
  let at = 0
  let seed = 1
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  for (const p of list) {
    const n = Math.round(('speech' in p ? p.speech : p.silence) * RATE)
    const level = 'speech' in p ? 0.3 : 0.002
    for (let i = 0; i < n; i++) out[at + i] = random() * level
    at += n
  }
  return out
}

const sentences = [
  'CHAPTER II.',
  'The Pool of Tears.',
  'Curiouser and curiouser, cried Alice, she was so much surprised that for the moment she quite forgot how to speak good English.',
  'Now I am opening out like the largest telescope that ever was!',
  'Good-bye, feet, for when she looked down at her feet, they seemed to be almost out of sight, they were getting so far off.',
  'Oh, my poor little feet, I wonder who will put on your shoes and stockings for you now, dears?',
  'I am sure I shan’t be able!',
  'I shall be a great deal too far off to trouble myself about you: you must manage the best way you can.',
  'But I must be kind to them, thought Alice, or perhaps they won’t walk the way I want to go!',
  'Let me see: I’ll give them a new pair of boots every Christmas.',
]

describe('lining a recording up with the text from its pauses', () => {
  const words = sentences.join(' ').split(' ')
  const weights = buildTimeline(words, [], 'natural').weights
  const starts: number[] = []
  sentences.reduce((i, s) => (starts.push(i), i + s.split(' ').length), 0)
  // A narrator at about 2.7 weight units a second, varying a little sentence to sentence,
  // after a 12-second announcement, with short silences between some words.
  const pace = [2.5, 2.9, 2.6, 2.8, 2.7, 2.5, 2.9, 2.6, 2.8, 2.7]
  const parts: ({ speech: number } | { silence: number })[] = [{ speech: 12 }, { silence: 0.9 }]
  const truth: number[] = []
  let t = 12.9
  sentences.forEach((s, k) => {
    truth.push(t)
    const first = starts[k]
    const count = s.split(' ').length
    let weight = 0
    for (let i = first; i < first + count; i++) weight += weights[i]
    const length = weight / pace[k]
    // A comma's pause in longer sentences: shorter than a sentence break, but long enough to be found.
    if (length > 4) parts.push({ speech: length / 2 }, { silence: 0.25 }, { speech: length / 2 }, { silence: 0.7 })
    else parts.push({ speech: length }, { silence: 0.7 })
    t += length + (length > 4 ? 0.25 : 0) + 0.7
  })
  parts.push({ speech: 6 })
  const samples = recording(parts)
  const text = { start: 0, end: words.length, words, weights, paragraphEnds: new Set([1, 5]) }

  it('finds the pauses', () => {
    const pauses = findPauses(samples, RATE)
    // The one after the announcement, a full stop's after each sentence, and a comma's in the long ones.
    expect(pauses.length).toBe(1 + sentences.length + sentences.filter((s) => s.split(' ').length > 9).length)
    expect(pauses[0].start).toBeCloseTo(12, 1)
  })

  it('places each sentence at the moment it starts, past the announcement', () => {
    const points = alignChapter(findPauses(samples, RATE), samples.length / RATE, text)
    expect(points.length).toBeGreaterThanOrEqual(8)
    for (const p of points) {
      const k = starts.indexOf(p.index)
      expect(k).toBeGreaterThanOrEqual(0)
      expect(Math.abs(p.seconds - truth[k])).toBeLessThan(0.1)
    }
  })

  it('finds where the recording starts and ends in a longer stretch of text', () => {
    // Text before and after that the recording doesn't cover.
    const before = 'This sentence is not in the recording at all. Nor is this one, which comes before it.'.split(' ')
    const after = 'And this part comes after the end of the recording. It is never read here.'.split(' ')
    const all = [...before, ...words, ...after]
    const allWeights = buildTimeline(all, [], 'natural').weights
    const points = alignChapter(findPauses(samples, RATE), samples.length / RATE, {
      start: 0, end: all.length, words: all, weights: allWeights, paragraphEnds: new Set(),
    }, { lead: 40, openEnd: true })
    const placed = points.filter((p) => starts.includes(p.index - before.length))
    expect(placed.length).toBeGreaterThanOrEqual(7)
    for (const p of placed) expect(Math.abs(p.seconds - truth[starts.indexOf(p.index - before.length)])).toBeLessThan(0.1)
  })

  it('finds nothing in silence', () => {
    expect(alignChapter(findPauses(new Float32Array(RATE * 10), RATE), 10, text)).toEqual([])
  })
})
