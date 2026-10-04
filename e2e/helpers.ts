import { expect, type Page } from '@playwright/test'

/** A short two-chapter book. */
export const STORY = [
  'Chapter 1',
  '',
  'The rabbit ran across the field. Alice followed it to a hole under the hedge. She looked in and saw nothing but darkness.',
  '',
  'Chapter 2',
  '',
  'Down she went, past cupboards and shelves. The fall seemed to last for ever, and she wondered where she would land.',
].join('\n')

/** Add a book from text and wait for it to open. */
export async function upload(page: Page, name = 'story.txt', text = STORY) {
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) })
  await expect(page.locator('.reader')).toBeVisible()
}

/** A WAV file standing in for a narrator: noise for speech and silence for pauses, so a recording's pauses can be placed exactly. */
export function wav(parts: ({ speech: number } | { silence: number })[]): Buffer {
  const rate = 8000
  const samples = parts.map((p) => ({ n: Math.round(('speech' in p ? p.speech : p.silence) * rate), loud: 'speech' in p }))
  const data = samples.reduce((sum, p) => sum + p.n, 0)
  const out = Buffer.alloc(44 + data, 128) // 8-bit silence is 128
  out.write('RIFF', 0)
  out.writeUInt32LE(36 + data, 4)
  out.write('WAVEfmt ', 8)
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20) // PCM
  out.writeUInt16LE(1, 22) // mono
  out.writeUInt32LE(rate, 24)
  out.writeUInt32LE(rate, 28)
  out.writeUInt16LE(1, 32)
  out.writeUInt16LE(8, 34)
  out.write('data', 36)
  out.writeUInt32LE(data, 40)
  let at = 44
  for (const p of samples) {
    if (p.loud) for (let i = 0; i < p.n; i++) out[at + i] = 128 + Math.round((Math.random() * 2 - 1) * 40)
    at += p.n
  }
  return out
}

export const silentWav = (seconds: number) => wav([{ silence: seconds }])

/** A book whose second chapter is long enough to line up by its sound, like a real one. */
export const SECOND = [
  'Down she went, past cupboards and shelves.',
  'The fall seemed to last for ever, and she wondered where she would land.',
  'Marmalade jars stood on the shelves, and she took one down as she passed.',
  'It was empty.',
  'Lanterns hung from hooks in the walls, and maps and pictures were pinned up in places, all the way down, so that she had plenty to look at.',
  'Would the fall never come to an end?',
  'Presently she began talking to herself again, about the cat she had left at home and whether anyone would remember to give it milk at tea time.',
  'Nobody answered.',
  'Then, quite suddenly, she landed on a heap of sticks and dry leaves, and the fall was over.',
]
export const LISTEN_BOOK = ['Chapter 1', '', 'The rabbit ran across the field. Alice followed it to a hole under the hedge.', '', 'Chapter 2', '', SECOND.join(' ')].join('\n')

/**
 * The second chapter read aloud: an announcement, the heading, then each
 * sentence at about 13 letters a second, pausing at commas and longer after
 * each sentence, like a narrator. Returns the recording and when each
 * sentence starts.
 */
function readChapterTwo(): { audio: Buffer; starts: number[] } {
  const parts: ({ speech: number } | { silence: number })[] = [{ speech: 4 }, { silence: 0.9 }, { speech: 1 }, { silence: 0.9 }]
  let t = 6.8
  const starts: number[] = []
  for (const sentence of SECOND) {
    starts.push(t)
    const words = sentence.split(' ')
    words.forEach((word, j) => {
      const length = word.replace(/[^\p{L}\p{N}]/gu, '').length / 13
      const pause = j === words.length - 1 ? 0.8 : /[,;:]$/.test(word) ? 0.3 : 0
      parts.push({ speech: length }, ...(pause ? [{ silence: pause }] : []))
      t += length + pause
    })
  }
  parts.push({ speech: 3 }, { silence: 1 })
  return { audio: wav(parts), starts }
}
export const chapterTwo = readChapterTwo()
/** Chapter 2's track starts after chapter 1's 20 seconds. */
const CHAPTER_TWO_LENGTH = Math.ceil(chapterTwo.audio.length / 8000)

/**
 * The Internet Archive, answering with a LibriVox recording of LISTEN_BOOK:
 * 20 silent seconds for chapter 1, then chapterTwo. `delay` slows each
 * download, like a phone on mobile data.
 */
export async function mockArchive(page: Page, { delay = 0 } = {}): Promise<{ downloads: string[] }> {
  const downloads: string[] = []
  await page.route('https://archive.org/advancedsearch.php**', (route) =>
    route.fulfill({ json: { response: { docs: [{ identifier: 'story_librivox', title: 'Story', creator: 'A. Writer' }] } } }),
  )
  await page.route('https://archive.org/metadata/story_librivox', (route) =>
    route.fulfill({
      json: {
        files: [
          { name: 'story_01_64kb.mp3', format: '64Kbps MP3', title: '01 Chapter 1', length: '0:20' },
          { name: 'story_02_64kb.mp3', format: '64Kbps MP3', title: '02 Chapter 2', length: `0:${CHAPTER_TWO_LENGTH}` },
        ],
      },
    }),
  )
  // Answered in ranges, like the real thing, or the browser can't seek in it.
  const files: Record<string, Buffer> = { 'story_01_64kb.mp3': silentWav(20), 'story_02_64kb.mp3': chapterTwo.audio }
  await page.route('https://archive.org/download/**', async (route) => {
    downloads.push(route.request().url().split('/').pop()!)
    if (delay) await new Promise((done) => setTimeout(done, delay))
    const body = files[route.request().url().split('/').pop()!]
    const headers = { 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' }
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '')
    if (!range) return route.fulfill({ body, contentType: 'audio/wav', headers })
    const start = Number(range[1])
    const end = range[2] ? Number(range[2]) : body.length - 1
    return route.fulfill({
      status: 206,
      body: body.subarray(start, end + 1),
      contentType: 'audio/wav',
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}` },
    })
  })
  return { downloads }
}

/** Seconds as the player shows them: "0:34", "1:02". */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
