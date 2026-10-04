import { describe, expect, it } from 'vitest'
import {
  addPoint,
  trackAt,
  trackChapters,
  trackRange,
  MAX_SPEED,
  paceAt,
  speedFor,
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
    expect(parseTimestamps(text.join('\n')).map(({ seconds, label }) => ({ seconds, label }))).toEqual([
      { seconds: 0, label: 'Intro' },
      { seconds: 65, label: 'Chapter 1: Down the Rabbit-Hole' },
      { seconds: 760, label: 'Chapter 2' },
      { seconds: 3723, label: 'Chapter Three' },
    ])
  })

  it('reads a transcript copied from YouTube, a time then what was said', () => {
    const text = '0:00\nchapter one down the rabbit hole\n0:04\nalice was beginning to get\nvery tired of sitting'
    expect(parseTimestamps(text).map(({ seconds, text }) => ({ seconds, text }))).toEqual([
      { seconds: 0, text: 'chapter one down the rabbit hole' },
      { seconds: 4, text: 'alice was beginning to get very tired of sitting' },
    ])
  })

  it('reads subtitle files', () => {
    const srt = '1\n00:00:01,000 --> 00:00:04,000\nAlice was beginning\n\n2\n00:00:04,500 --> 00:00:07,000\nto get very tired'
    expect(parseTimestamps(srt).map(({ seconds, text }) => ({ seconds, text }))).toEqual([
      { seconds: 1, text: 'Alice was beginning' },
      { seconds: 4, text: 'to get very tired' },
    ])
    const vtt = 'WEBVTT\n\n00:01.000 --> 00:04.000\n<c>Alice</c> was beginning'
    expect(parseTimestamps(vtt)[0]).toMatchObject({ seconds: 1, text: 'Alice was beginning' })
  })

  it('leaves a time said in a sentence as part of it', () => {
    const text = '0:10\nand the clock struck 10:30 as she ran past the old church and down the hill'
    expect(parseTimestamps(text)).toHaveLength(1)
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

  it('matches the ways recordings name their tracks', () => {
    const stamps = parseTimestamps('0:00 AliceInWonderland_chap01\n9:00 Chapters 2-3\n20:00 03 A Caucus-Race')
    expect(matchChapters(stamps, chapters).map((p) => p.index)).toEqual([0, 1000, 2500])
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

describe('playback speed', () => {
  it('measures the narrator’s pace around a spot', () => {
    const points = [
      { index: 0, seconds: 0 },
      { index: 1000, seconds: 400 },
      { index: 2000, seconds: 700 },
    ]
    expect(paceAt(points, 100)).toBeCloseTo(2.5)
    expect(paceAt(points, 1900)).toBeCloseTo(1000 / 300)
    expect(paceAt([], 100)).toBe(NARRATION_WORDS_PER_SECOND)
  })

  it('plays faster or slower to match the reading speed, within what players allow', () => {
    // A 150 wpm narrator heard at 300 wpm plays at double speed.
    expect(speedFor(300, 2.5)).toBe(2)
    expect(speedFor(195, 2.5)).toBe(1.3)
    expect(speedFor(1000, 2.5)).toBe(MAX_SPEED)
    expect(speedFor(100, 2.5)).toBe(0.65)
  })
})

describe('recordings in tracks', () => {
  it('pins each chapter to its track, after a LibriVox announcement', () => {
    const link = {
      source: {
        kind: 'archive' as const,
        identifier: 'alice',
        title: 'Alice',
        librivox: true,
        tracks: [
          { url: 'a', title: '01 Down the Rabbit Hole', seconds: 796 },
          { url: 'b', title: '02 The Pool of Tears', seconds: 775 },
          { url: 'c', title: '03 A Caucus-Race and a Long Tale', seconds: 632 },
        ],
      },
      timestamps: '',
      points: [],
    }
    expect(syncPoints(link, chapters)).toEqual([
      { index: 0, seconds: 14 },
      { index: 1000, seconds: 810 },
      { index: 2500, seconds: 1585 },
    ])
  })
})

describe('which part of the book each track covers', () => {
  const tracks = [
    { url: 'a', title: '01 Down the Rabbit Hole', seconds: 796 },
    { url: 'b', title: '02 The Pool of Tears', seconds: 775 },
    { url: 'c', title: '03 A Caucus-Race and a Long Tale', seconds: 632 },
  ]

  it('finds the chapter each track is named after', () => {
    expect(trackChapters(tracks, chapters)).toEqual([0, 1000, 2500])
    expect(trackChapters([{ url: 'x', title: 'Intro', seconds: 30 }, ...tracks], chapters)).toEqual([null, 0, 1000, 2500])
  })

  it('looks for a named track in its chapter, up to the next', () => {
    expect(trackRange(tracks, 1, chapters, [], 5000, 775)).toEqual({ start: 1000, end: 2500, options: {} })
    // The last track ends where a believable pace says: here the end of the book (2500 words in 1000 s)…
    expect(trackRange(tracks, 2, chapters, [], 5000, 1000)).toEqual({ start: 2500, end: 5000, options: {} })
    // …and here the next chapter, not the far end of the book (a recording of only part of it).
    const more = [...chapters, { title: 'CHAPTER IV. The Rabbit Sends in a Little Bill', start: 4300 }]
    expect(trackRange(tracks, 2, more, [], 30000, 700)).toEqual({ start: 2500, end: 4300, options: {} })
    // When no chapter break fits (a licence runs on after the last), where it ends is found from its sound.
    expect(trackRange(tracks, 2, chapters, [], 30000, 632)).toEqual({ start: 2500, end: expect.any(Number), options: { lead: 0, openEnd: true } })
  })

  it('looks either side of a guess for a track named after no chapter', () => {
    const unnamed = [{ url: 'a', title: 'Part one', seconds: 600 }, { url: 'b', title: 'Part two', seconds: 600 }]
    // Lined up so far: word 3000 is heard at 600 s, where the second track starts.
    const range = trackRange(unnamed, 1, chapters, [{ index: 0, seconds: 0 }, { index: 3000, seconds: 600 }], 20000, 600)
    expect(range.start).toBe(500)
    expect(range.options).toEqual({ lead: 5000, openEnd: true })
    expect(range.end).toBeGreaterThan(3000 + 600 * 2.6)
  })

  it('knows which track is playing', () => {
    expect(trackAt(tracks, 0)).toBe(0)
    expect(trackAt(tracks, 800)).toBe(1)
    expect(trackAt(tracks, 99999)).toBe(2)
  })
})
