import { describe, expect, it } from 'vitest'
import {
  addPoint,
  formatTime,
  matchChapters,
  NARRATION_WORDS_PER_SECOND,
  parseTimestamps,
  sourceFromLink,
  syncPoints,
  timeAt,
  wordAt,
  youTubeId,
} from '../audio'

const chapters = [
  { title: 'CHAPTER I. Down the Rabbit-Hole', start: 0 },
  { title: 'CHAPTER II. The Pool of Tears', start: 1000 },
  { title: 'CHAPTER III. A Caucus-Race and a Long Tale', start: 2500 },
]

describe('links', () => {
  it('finds the video in every kind of YouTube link', () => {
    expect(youTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toBe('dQw4w9WgXcQ')
    expect(youTubeId('youtu.be/dQw4w9WgXcQ?si=abc')).toBe('dQw4w9WgXcQ')
    expect(youTubeId('https://m.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youTubeId('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youTubeId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youTubeId('https://www.youtube.com/@someone')).toBeNull()
    expect(youTubeId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })

  it('treats other web links as audio files', () => {
    expect(sourceFromLink('https://archive.org/download/alice/alice_01.mp3')).toEqual({
      kind: 'url',
      url: 'https://archive.org/download/alice/alice_01.mp3',
    })
    expect(sourceFromLink('not a link')).toBeNull()
    expect(sourceFromLink('javascript:alert(1)')).toBeNull()
  })
})

describe('timestamps', () => {
  it('reads a YouTube chapter list in its usual shapes', () => {
    const text = ['0:00 Intro', '1:05 - Chapter 1: Down the Rabbit-Hole', 'Chapter 2 (12:40)', '1:02:03 | Chapter Three', 'no time here']
    expect(parseTimestamps(text.join('\n'))).toEqual([
      { seconds: 0, label: 'Intro' },
      { seconds: 65, label: 'Chapter 1: Down the Rabbit-Hole' },
      { seconds: 760, label: 'Chapter 2' },
      { seconds: 3723, label: 'Chapter Three' },
    ])
  })

  it('formats times like a player does', () => {
    expect(formatTime(5)).toBe('0:05')
    expect(formatTime(605.9)).toBe('10:05')
    expect(formatTime(3723)).toBe('1:02:03')
  })
})

describe('matching chapters', () => {
  it('matches titles however the numbers are written, and skips an intro', () => {
    const stamps = parseTimestamps('0:00 Intro\n0:30 Chapter One\n9:00 Chapter 2 - The Pool of Tears\n20:00 chapter iii')
    expect(matchChapters(stamps, chapters)).toEqual([
      { index: 0, seconds: 30 },
      { index: 1000, seconds: 540 },
      { index: 2500, seconds: 1200 },
    ])
  })

  it('matches by name when the numbers are missing', () => {
    const stamps = parseTimestamps('4:00 The Pool of Tears')
    expect(matchChapters(stamps, chapters)).toEqual([{ index: 1000, seconds: 240 }])
  })

  it('pairs in order when nothing matches by name but the counts agree', () => {
    const stamps = parseTimestamps('0:10 Part A\n5:00 Part B\n9:00 Part C')
    expect(matchChapters(stamps, chapters).map((p) => p.index)).toEqual([0, 1000, 2500])
  })

  it('covers a recording of just part of the book', () => {
    // A video of chapter 3 alone.
    const stamps = parseTimestamps('0:00 Chapter 3')
    expect(matchChapters(stamps, chapters)).toEqual([{ index: 2500, seconds: 0 }])
  })
})

describe('lining up book and recording', () => {
  const points = [
    { index: 0, seconds: 30 },
    { index: 1000, seconds: 430 },
    { index: 2500, seconds: 1030 },
  ]

  it('interpolates between points, both ways', () => {
    expect(timeAt(points, 500)).toBe(230)
    expect(timeAt(points, 1750)).toBe(730)
    expect(wordAt(points, 230, 5000)).toBe(500)
    expect(wordAt(points, 730, 5000)).toBe(1750)
  })

  it('carries on at the last known pace past the ends', () => {
    // 1500 words in 600 s = 2.5 words a second.
    expect(timeAt(points, 3000)).toBe(1230)
    expect(wordAt(points, 1230, 5000)).toBe(3000)
    expect(timeAt([{ index: 2500, seconds: 0 }], 2000)).toBe(0)
  })

  it('guesses a narrator’s pace with nothing to go on', () => {
    expect(timeAt([], 260)).toBeCloseTo(260 / NARRATION_WORDS_PER_SECOND)
    expect(wordAt([], 10, 5000)).toBe(26)
    expect(wordAt([], 1e6, 5000)).toBe(4999)
  })

  it('lets a hand-set point override a chapter timestamp that disagrees', () => {
    const link = {
      source: { kind: 'url' as const, url: 'https://example.com/a.mp3' },
      timestamps: '0:30 Chapter 1\n9:00 Chapter 2\n20:00 Chapter 3',
      points: [{ index: 1500, seconds: 500 }],
    }
    // Chapter 2 at 9:00 would put word 1000 after word 1500's 500 s.
    expect(syncPoints(link, chapters)).toEqual([
      { index: 0, seconds: 30 },
      { index: 1500, seconds: 500 },
      { index: 2500, seconds: 1200 },
    ])
  })

  it('replaces a nearby hand-set point rather than adding another', () => {
    const points = addPoint(addPoint([], 100, 50), 110, 55)
    expect(points).toEqual([{ index: 110, seconds: 55 }])
    expect(addPoint(points, 500, 200)).toHaveLength(2)
  })
})
