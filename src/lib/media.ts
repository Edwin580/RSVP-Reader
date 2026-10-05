/**
 * Reading an audiobook file's own structure, so a long one (a whole book in
 * one file, hours long) can be lined up a stretch at a time: where each
 * moment's audio sits in the file, and the chapter markers it carries. MP3
 * (frames, and ID3 chapter frames), MP4/M4A/M4B (AAC samples, and Nero
 * or QuickTime chapters) and WAV are read; nothing here decodes sound.
 */

export interface FileChapter {
  title: string
  /** Seconds from the start of the file. */
  start: number
}

/** Bytes to hand a decoder for a stretch of the file, and where that stretch really starts. */
export interface Stretch {
  /** Parts of the file, in order, already wrapped for decoding (ADTS for AAC). */
  parts: (Blob | Uint8Array)[]
  /** Seconds into the file where the decoded audio starts. */
  start: number
  /** A media type to label the bytes with. */
  type: string
}

export interface AudioIndex {
  format: 'mp3' | 'aac' | 'wav'
  duration: number
  chapters: FileChapter[]
  /** The bytes holding at least [from, to] seconds. */
  stretch: (file: Blob, from: number, to: number) => Stretch
}

/** Reads a whole Blob in large pieces (a long audiobook is hundreds of MB; reading it in one go would hold it all in memory twice). */
async function bytes(file: Blob, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer())
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n))

// ——— MP3 ———

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

/** An MPEG audio layer III frame header at `at`: its length in bytes and how many samples it holds, or null. */
export function mp3Frame(b: Uint8Array, at: number): { length: number; samples: number; rate: number } | null {
  if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return null
  const version = (b[at + 1] >> 3) & 3 // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layer = (b[at + 1] >> 1) & 3 // 1 = layer III
  if (version === 1 || layer !== 1) return null
  const bitrateIndex = b[at + 2] >> 4
  const rateIndex = (b[at + 2] >> 2) & 3
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null
  const padding = (b[at + 2] >> 1) & 1
  const rate = RATES[version][rateIndex]
  const kbps = (version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIndex]
  const samples = version === 3 ? 1152 : 576
  const length = Math.floor(((samples / 8) * kbps * 1000) / rate) + padding
  return length > 4 ? { length, samples, rate } : null
}

function syncsafe(b: Uint8Array, at: number): number {
  return ((b[at] & 0x7f) << 21) | ((b[at + 1] & 0x7f) << 14) | ((b[at + 2] & 0x7f) << 7) | (b[at + 3] & 0x7f)
}

/** Chapters from an ID3v2 tag's CHAP frames (each with a TIT2 title). */
export function id3Chapters(tag: Uint8Array): FileChapter[] {
  if (ascii(tag, 0, 3) !== 'ID3') return []
  const major = tag[3]
  const size = syncsafe(tag, 6) + 10
  const chapters: FileChapter[] = []
  const frameSize = (at: number) =>
    major >= 4 ? syncsafe(tag, at) : (tag[at] << 24) | (tag[at + 1] << 16) | (tag[at + 2] << 8) | tag[at + 3]
  const text = (body: Uint8Array) => {
    const encoding = body[0]
    const raw = body.subarray(1)
    if (encoding === 1 || encoding === 2) return new TextDecoder(encoding === 1 ? 'utf-16' : 'utf-16be').decode(raw).replace(/\0/g, '')
    return new TextDecoder(encoding === 3 ? 'utf-8' : 'latin1').decode(raw).replace(/\0/g, '')
  }
  let at = 10
  while (at + 10 <= Math.min(size, tag.length)) {
    const id = ascii(tag, at, 4)
    const length = frameSize(at + 4)
    if (!/^[A-Z0-9]{4}$/.test(id) || length <= 0) break
    if (id === 'CHAP') {
      const body = tag.subarray(at + 10, at + 10 + length)
      const idEnd = body.indexOf(0)
      const startMs = new DataView(body.buffer, body.byteOffset + idEnd + 1, 4).getUint32(0)
      // Sub-frames after the four times (start, end, start byte, end byte).
      let sub = idEnd + 1 + 16
      let title = ''
      while (sub + 10 <= body.length) {
        const subId = ascii(body, sub, 4)
        const subLength = major >= 4 ? syncsafe(body, sub + 4) : new DataView(body.buffer, body.byteOffset + sub + 4, 4).getUint32(0)
        if (subId === 'TIT2') title = text(body.subarray(sub + 10, sub + 10 + subLength)).trim()
        sub += 10 + subLength
      }
      chapters.push({ title, start: startMs / 1000 })
    }
    at += 10 + length
  }
  return chapters.sort((a, b) => a.start - b.start)
}

/** Read buffer for scanning frames: big enough to be quick, small enough not to matter. */
const SCAN_BYTES = 4 * 1024 * 1024

async function indexMp3(file: Blob): Promise<AudioIndex> {
  const head = await bytes(file, 0, 10)
  let start = 0
  let chapters: FileChapter[] = []
  if (ascii(head, 0, 3) === 'ID3') {
    start = syncsafe(head, 6) + 10 + (head[5] & 0x10 ? 10 : 0)
    chapters = id3Chapters(await bytes(file, 0, start))
  }
  // Every frame's byte offset and running sample count, for exact times (VBR included).
  const offsets: number[] = []
  const times: number[] = []
  let rate = 44100
  let samples = 0
  let at = start
  let buffer: Uint8Array = new Uint8Array(0)
  let bufferStart = at
  while (at < file.size) {
    if (at + 4 > bufferStart + buffer.length) {
      bufferStart = at
      buffer = await bytes(file, at, Math.min(file.size, at + SCAN_BYTES))
      if (buffer.length < 4) break
    }
    const frame = mp3Frame(buffer, at - bufferStart)
    if (!frame) {
      at++ // Not a frame here (junk, or a tag at the end): look at the next byte.
      continue
    }
    rate = frame.rate
    offsets.push(at)
    times.push(samples / rate)
    samples += frame.samples
    at += frame.length
  }
  const duration = samples / rate
  return {
    format: 'mp3',
    duration,
    chapters,
    stretch: (blob, from, to) => {
      const first = Math.max(0, upperBound(times, from) - 1)
      const last = Math.min(offsets.length, upperBound(times, to) + 1)
      const end = last < offsets.length ? offsets[last] : blob.size
      return { parts: [blob.slice(offsets[first], end)], start: times[first] ?? 0, type: 'audio/mpeg' }
    },
  }
}

/** The index of the first value greater than `x` in sorted `values`. */
function upperBound(values: ArrayLike<number>, x: number): number {
  let lo = 0
  let hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (values[mid] > x) hi = mid
    else lo = mid + 1
  }
  return lo
}

// ——— MP4 / M4A / M4B ———

interface Box {
  type: string
  start: number
  /** Where its contents start and end. */
  body: number
  end: number
}

function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = []
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let at = from
  while (at + 8 <= to) {
    let size = view.getUint32(at)
    const type = ascii(b, at + 4, 4)
    let body = at + 8
    if (size === 1) {
      size = Number(view.getBigUint64(at + 8))
      body = at + 16
    } else if (size === 0) size = to - at
    if (size < 8 || at + size > to) break
    out.push({ type, start: at, body, end: at + size })
    at += size
  }
  return out
}

const child = (b: Uint8Array, box: Box, type: string, skip = 0) => boxes(b, box.body + skip, box.end).find((x) => x.type === type)
const children = (b: Uint8Array, box: Box, type: string) => boxes(b, box.body, box.end).filter((x) => x.type === type)

/** Finds the top-level `moov` box: reading headers only, so a file of hundreds of MB isn't read whole. */
async function findMoov(file: Blob): Promise<Uint8Array | null> {
  let at = 0
  while (at + 8 <= file.size) {
    const head = await bytes(file, at, Math.min(file.size, at + 16))
    const view = new DataView(head.buffer)
    let size = view.getUint32(0)
    const type = ascii(head, 4, 4)
    if (size === 1) size = Number(view.getBigUint64(8))
    else if (size === 0) size = file.size - at
    if (size < 8) return null
    if (type === 'moov') return bytes(file, at, at + size)
    at += size
  }
  return null
}

interface SampleTable {
  timescale: number
  /** Each sample's byte offset, size and start time (in timescale units). */
  offsets: Float64Array
  sizes: Uint32Array
  times: Float64Array
  handler: string
}

function sampleTable(m: Uint8Array, trak: Box): SampleTable | null {
  const view = new DataView(m.buffer, m.byteOffset, m.byteLength)
  const mdia = child(m, trak, 'mdia')
  if (!mdia) return null
  const mdhd = child(m, mdia, 'mdhd')
  const hdlr = child(m, mdia, 'hdlr')
  const stbl = (() => {
    const minf = child(m, mdia, 'minf')
    return minf ? child(m, minf, 'stbl') : undefined
  })()
  if (!mdhd || !hdlr || !stbl) return null
  const timescale = view.getUint32(mdhd.body + (m[mdhd.body] === 1 ? 20 : 12))
  const handler = ascii(m, hdlr.body + 8, 4)
  const box = (type: string) => child(m, stbl, type)
  const stts = box('stts')
  const stsc = box('stsc')
  const stsz = box('stsz')
  const stco = box('stco') ?? box('co64')
  if (!stts || !stsc || !stsz || !stco) return null

  const fixed = view.getUint32(stsz.body + 4)
  const count = view.getUint32(stsz.body + 8)
  const sizes = new Uint32Array(count)
  for (let i = 0; i < count; i++) sizes[i] = fixed || view.getUint32(stsz.body + 12 + i * 4)

  const times = new Float64Array(count)
  let t = 0
  let i = 0
  const sttsEntries = view.getUint32(stts.body + 4)
  for (let e = 0; e < sttsEntries; e++) {
    const n = view.getUint32(stts.body + 8 + e * 8)
    const delta = view.getUint32(stts.body + 12 + e * 8)
    for (let k = 0; k < n && i < count; k++, i++) {
      times[i] = t
      t += delta
    }
  }

  const chunkCount = view.getUint32(stco.body + 4)
  const chunkOffset = (c: number) =>
    stco.type === 'co64' ? Number(view.getBigUint64(stco.body + 8 + c * 8)) : view.getUint32(stco.body + 8 + c * 4)
  const offsets = new Float64Array(count)
  const stscEntries = view.getUint32(stsc.body + 4)
  let sample = 0
  for (let e = 0; e < stscEntries; e++) {
    const firstChunk = view.getUint32(stsc.body + 8 + e * 12) - 1
    const perChunk = view.getUint32(stsc.body + 12 + e * 12)
    const nextFirst = e + 1 < stscEntries ? view.getUint32(stsc.body + 8 + (e + 1) * 12) - 1 : chunkCount
    for (let c = firstChunk; c < nextFirst && sample < count; c++) {
      let at = chunkOffset(c)
      for (let k = 0; k < perChunk && sample < count; k++, sample++) {
        offsets[sample] = at
        at += sizes[sample]
      }
    }
  }
  return { timescale, offsets, sizes, times, handler }
}

/** The AAC settings an ADTS header needs, from the track's esds box. */
function aacConfig(m: Uint8Array, trak: Box): { profile: number; rateIndex: number; channels: number } | null {
  // esds sits deep in stsd > mp4a; its DecoderSpecificInfo (tag 5) is the AudioSpecificConfig.
  const start = trak.body
  for (let at = start; at + 4 < trak.end; at++) {
    if (ascii(m, at, 4) !== 'esds') continue
    for (let k = at + 8; k + 2 < trak.end && k < at + 200; k++) {
      if (m[k] !== 5) continue
      // Tag 5, then a length (1–4 bytes, high bit = more), then the config.
      let p = k + 1
      let length = 0
      for (let n = 0; n < 4; n++) {
        length = (length << 7) | (m[p] & 0x7f)
        if (!(m[p++] & 0x80)) break
      }
      if (length < 2 || length > 64) continue
      const objectType = m[p] >> 3
      const rateIndex = ((m[p] & 7) << 1) | (m[p + 1] >> 7)
      const channels = (m[p + 1] >> 3) & 15
      if (objectType < 1 || objectType > 4 || rateIndex > 12) continue
      return { profile: objectType - 1, rateIndex, channels: channels || 2 }
    }
  }
  return null
}

/** A 7-byte ADTS header for one AAC frame of `length` bytes. */
export function adtsHeader(length: number, config: { profile: number; rateIndex: number; channels: number }): Uint8Array {
  const full = length + 7
  return Uint8Array.from([
    0xff,
    0xf1,
    (config.profile << 6) | (config.rateIndex << 2) | (config.channels >> 2),
    ((config.channels & 3) << 6) | (full >> 11),
    (full >> 3) & 0xff,
    ((full & 7) << 5) | 0x1f,
    0xfc,
  ])
}

/** Where a track's edit list starts playing, in its own time units (0 without one). */
function editStart(m: Uint8Array, trak: Box): number {
  const edts = child(m, trak, 'edts')
  const elst = edts && child(m, edts, 'elst')
  if (!elst) return 0
  const view = new DataView(m.buffer, m.byteOffset, m.byteLength)
  const version = m[elst.body]
  const entries = view.getUint32(elst.body + 4)
  // An entry of media time -1 is an empty stretch before the track; the first real one says where it starts.
  for (let e = 0, at = elst.body + 8; e < entries; e++, at += version === 1 ? 20 : 12) {
    const time = version === 1 ? Number(view.getBigInt64(at + 8)) : view.getInt32(at + 4)
    if (time >= 0) return time
  }
  return 0
}

/** Nero chapters (moov > udta > chpl): start times in 100 ns units and titles. */
function neroChapters(m: Uint8Array, moov: Box): FileChapter[] {
  const udta = child(m, moov, 'udta')
  const chpl = udta && child(m, udta, 'chpl')
  if (!chpl) return []
  const view = new DataView(m.buffer, m.byteOffset, m.byteLength)
  // Version and flags (4), then on version 1 four more bytes, then the count (1 byte).
  let at = chpl.body + 4 + (m[chpl.body] === 1 ? 4 : 0)
  const count = m[at++]
  const out: FileChapter[] = []
  for (let i = 0; i < count && at + 9 <= chpl.end; i++) {
    const start = Number(view.getBigUint64(at)) / 1e7
    const length = m[at + 8]
    const title = new TextDecoder().decode(m.subarray(at + 9, at + 9 + length))
    out.push({ title, start })
    at += 9 + length
  }
  return out
}

async function indexMp4(file: Blob): Promise<AudioIndex | null> {
  const m = await findMoov(file)
  if (!m) return null
  const moov = boxes(m, 0, m.length)[0]
  const traks = children(m, moov, 'trak')
  const tables = traks.map((t) => ({ trak: t, table: sampleTable(m, t) }))
  const audio = tables.find((t) => t.table?.handler === 'soun')
  if (!audio?.table) return null
  const config = aacConfig(m, audio.trak)
  if (!config) return null
  const { table } = audio
  // Encoders put a little silence first (priming) and an edit list saying where the sound really starts.
  const skip = editStart(m, audio.trak)
  const seconds = (t: number) => (t - skip) / table.timescale
  const count = table.sizes.length
  const duration = count ? Math.max(0, seconds(table.times[count - 1] + 1024)) : 0

  // Chapters: Nero's list, or a QuickTime chapter track (text samples: a 2-byte length, then the title).
  let chapters = neroChapters(m, moov)
  if (!chapters.length) {
    const text = tables.find((t) => t.table?.handler === 'text')
    if (text?.table && text.table.sizes.length) {
      const reads = await Promise.all(
        Array.from(text.table.sizes, (size, i) => bytes(file, text.table!.offsets[i], text.table!.offsets[i] + size)),
      )
      chapters = reads.map((b, i) => {
        const length = b.length >= 2 ? (b[0] << 8) | b[1] : 0
        return { title: new TextDecoder().decode(b.subarray(2, 2 + length)).trim(), start: text.table!.times[i] / text.table!.timescale }
      })
    }
  }

  return {
    format: 'aac',
    duration,
    chapters: chapters.sort((a, b) => a.start - b.start),
    stretch: (blob, from, to) => {
      const first = Math.max(0, upperBound(table.times, from * table.timescale + skip) - 1)
      const last = Math.min(count, upperBound(table.times, to * table.timescale + skip) + 1)
      const parts: (Blob | Uint8Array)[] = []
      for (let i = first; i < last; i++) {
        parts.push(adtsHeader(table.sizes[i], config), blob.slice(table.offsets[i], table.offsets[i] + table.sizes[i]))
      }
      return { parts, start: seconds(table.times[first] ?? skip), type: 'audio/aac' }
    },
  }
}

// ——— WAV ———

async function indexWav(file: Blob): Promise<AudioIndex | null> {
  const head = await bytes(file, 0, Math.min(file.size, 4096))
  const view = new DataView(head.buffer)
  let format: { channels: number; rate: number; block: number; bytes: Uint8Array } | null = null
  let at = 12
  while (at + 8 <= head.length) {
    const id = ascii(head, at, 4)
    const size = view.getUint32(at + 4, true)
    if (id === 'fmt ' && at + 8 + 16 <= head.length) {
      format = { channels: view.getUint16(at + 10, true), rate: view.getUint32(at + 12, true), block: view.getUint16(at + 20, true), bytes: head.slice(at, at + 8 + size) }
    }
    if (id === 'data') {
      if (!format || !format.block || !format.rate) return null
      const { rate, block, bytes: fmt } = format
      const start = at + 8
      const length = Math.min(size, file.size - start)
      const frames = Math.floor(length / block)
      return {
        format: 'wav',
        duration: frames / rate,
        chapters: [],
        stretch: (blob, from, to) => {
          const first = Math.max(0, Math.min(frames, Math.floor(from * rate)))
          const last = Math.max(first, Math.min(frames, Math.ceil(to * rate)))
          const data = (last - first) * block
          // A header of its own: RIFF, the same format, and a data chunk this long.
          const header = new Uint8Array(12 + fmt.length + 8)
          const h = new DataView(header.buffer)
          header.set([0x52, 0x49, 0x46, 0x46], 0)
          h.setUint32(4, header.length - 8 + data, true)
          header.set([0x57, 0x41, 0x56, 0x45], 8)
          header.set(fmt, 12)
          header.set([0x64, 0x61, 0x74, 0x61], 12 + fmt.length)
          h.setUint32(16 + fmt.length, data, true)
          return { parts: [header, blob.slice(start + first * block, start + last * block)], start: first / rate, type: 'audio/wav' }
        },
      }
    }
    at += 8 + size + (size & 1)
  }
  return null
}

/** Indexes an audiobook file, or null when its format isn't one read here (it's then decoded whole, if small enough). */
export async function indexAudio(file: Blob): Promise<AudioIndex | null> {
  const head = await bytes(file, 0, 12)
  if (ascii(head, 4, 4) === 'ftyp') return indexMp4(file)
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') return indexWav(file)
  if (ascii(head, 0, 3) === 'ID3' || mp3Frame(head, 0)) return indexMp3(file)
  return null
}
