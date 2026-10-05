import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adtsHeader, indexAudio, mp3Frame } from '../media'

// Three seconds of tone, with chapters at 0 and 1.5 s (made with ffmpeg).
const fixture = (name: string) => new Blob([readFileSync(join(__dirname, 'fixtures', name))])

async function joined(parts: (Blob | Uint8Array)[]): Promise<Uint8Array> {
  return new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer())
}

describe('audiobook files', () => {
  it('reads an M4B file’s chapters and length', async () => {
    const index = await indexAudio(fixture('chapters.m4b'))
    expect(index?.format).toBe('aac')
    expect(index!.duration).toBeCloseTo(3, 1)
    expect(index!.chapters).toEqual([
      { title: 'Chapter One', start: 0 },
      { title: 'Chapter Two', start: 1.5 },
    ])
  })

  it('reads QuickTime chapters when there is no Nero list', async () => {
    const raw = readFileSync(join(__dirname, 'fixtures', 'chapters.m4b'))
    // Turn the Nero chapter box into padding, leaving only the chapter text track.
    const at = raw.indexOf('chpl')
    raw.write('free', at, 'latin1')
    const index = await indexAudio(new Blob([raw]))
    expect(index!.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two'])
    expect(index!.chapters[1].start).toBeCloseTo(1.5, 2)
  })

  it('cuts an M4B stretch into ADTS frames that start where it says', async () => {
    const index = (await indexAudio(fixture('chapters.m4b')))!
    const stretch = index.stretch(fixture('chapters.m4b'), 1.5, 2.5)
    expect(stretch.type).toBe('audio/aac')
    expect(stretch.start).toBeLessThanOrEqual(1.5)
    expect(stretch.start).toBeGreaterThan(1.3)
    const b = await joined(stretch.parts)
    // Walk the frames by the lengths their headers give: they must tile the bytes exactly.
    let at = 0
    let frames = 0
    while (at < b.length) {
      expect(b[at]).toBe(0xff)
      expect(b[at + 1] & 0xf6).toBe(0xf0)
      at += ((b[at + 3] & 3) << 11) | (b[at + 4] << 3) | (b[at + 5] >> 5)
      frames++
    }
    expect(at).toBe(b.length)
    // 1024 samples a frame at 22050 Hz: a second is about 22 frames.
    expect(frames).toBeGreaterThanOrEqual(22)
    expect(frames).toBeLessThan(30)
  })

  it('reads an MP3 file’s ID3 chapters and length', async () => {
    const index = await indexAudio(fixture('chapters.mp3'))
    expect(index?.format).toBe('mp3')
    expect(index!.duration).toBeCloseTo(3, 0)
    expect(index!.chapters).toEqual([
      { title: 'Chapter One', start: 0 },
      { title: 'Chapter Two', start: 1.5 },
    ])
  })

  it('cuts an MP3 stretch on frame boundaries', async () => {
    const file = fixture('plain-vbr.mp3')
    const index = (await indexAudio(file))!
    expect(index.chapters).toEqual([])
    const stretch = index.stretch(file, 1, 2)
    expect(stretch.start).toBeLessThanOrEqual(1)
    expect(stretch.start).toBeGreaterThan(0.9)
    const b = await joined(stretch.parts)
    let at = 0
    let seconds = 0
    while (at < b.length) {
      const frame = mp3Frame(b, at)
      expect(frame).not.toBeNull()
      seconds += frame!.samples / frame!.rate
      at += frame!.length
    }
    expect(at).toBe(b.length)
    expect(stretch.start + seconds).toBeGreaterThanOrEqual(2)
  })

  it('cuts a WAV stretch with a header of its own', async () => {
    // One second of 8 kHz, 8-bit mono: each byte its own sample.
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + 8000, 4)
    header.write('WAVEfmt ', 8)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(8000, 24)
    header.writeUInt32LE(8000, 28)
    header.writeUInt16LE(1, 32)
    header.writeUInt16LE(8, 34)
    header.write('data', 36)
    header.writeUInt32LE(8000, 40)
    const samples = Buffer.from(Array.from({ length: 8000 }, (_, i) => i % 256))
    const file = new Blob([header, samples])
    const index = (await indexAudio(file))!
    expect(index.format).toBe('wav')
    expect(index.duration).toBe(1)
    const stretch = index.stretch(file, 0.5, 0.75)
    expect(stretch.start).toBe(0.5)
    const b = await joined(stretch.parts)
    expect(b.length).toBe(44 + 2000)
    expect(new DataView(b.buffer).getUint32(40, true)).toBe(2000)
    expect(b[44]).toBe(4000 % 256)
  })

  it('leaves other files alone', async () => {
    expect(await indexAudio(new Blob(['OggS....']))).toBeNull()
  })

  it('writes ADTS headers with the frame length', () => {
    const header = adtsHeader(100, { profile: 1, rateIndex: 7, channels: 1 })
    expect(Array.from(header.subarray(0, 2))).toEqual([0xff, 0xf1])
    expect(((header[3] & 3) << 11) | (header[4] << 3) | (header[5] >> 5)).toBe(107)
  })
})
