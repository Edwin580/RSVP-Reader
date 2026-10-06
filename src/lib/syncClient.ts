import type { SyncPoint } from './audio'
import { alignChapter, findPauses, type AlignOptions } from './pauses'
import type { SyncRequest } from '../workers/sync.worker'

/**
 * Lines a recording up with the book from its sound (see pauses.ts): the
 * audio is downloaded and decoded here, at a low sample rate (pauses don't
 * need more, and a long chapter stays small), and matched in a Web Worker.
 */

/** Larger files would take too much memory to decode on a phone (about two hours of MP3). */
export const MAX_BYTES = 60 * 1024 * 1024
const SAMPLE_RATES = [8000, 16000, 22050, 44100]

export interface TextRange {
  start: number
  end: number
  options: AlignOptions
}


async function decode(data: ArrayBuffer): Promise<{ samples: Float32Array; sampleRate: number }> {
  const Context =
    window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!Context) throw new Error('This browser can’t decode audio.')
  let failure: unknown
  // Not every browser decodes at every rate; the lowest it takes.
  for (const rate of SAMPLE_RATES) {
    try {
      const buffer = await new Context(1, 1, rate).decodeAudioData(data.slice(0))
      return { samples: buffer.getChannelData(0), sampleRate: buffer.sampleRate }
    } catch (error) {
      failure = error
    }
  }
  throw failure
}

function inWorker(request: SyncRequest, transfer = false): Promise<SyncPoint[]> {
  const here = () => {
    const pauses = findPauses(request.samples, request.sampleRate)
    const text = { start: 0, end: request.words.length, words: request.words, weights: request.weights, paragraphEnds: new Set(request.paragraphEnds) }
    return alignChapter(pauses, request.samples.length / request.sampleRate, text, request.options)
  }
  let worker: Worker
  try {
    worker = new Worker(new URL('../workers/sync.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return Promise.resolve(here())
  }
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ ok: true; points: SyncPoint[] } | { ok: false; error: string }>) => {
      worker.terminate()
      if (e.data.ok) resolve(e.data.points)
      else reject(new Error(e.data.error))
    }
    worker.onerror = (e) => {
      e.preventDefault()
      worker.terminate()
      try {
        resolve(here())
      } catch (error) {
        reject(error)
      }
    }
    // The samples can be large; hand them over rather than copy them again.
    worker.postMessage(request, transfer ? [request.samples.buffer] : [])
  })
}

/** Downloads a file, reporting how much has arrived (0–1) when its size is known. */
async function download(url: string, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    // Mobile connections drop requests now and then: one more try.
    await new Promise((done) => setTimeout(done, 800))
    response = await fetch(url)
  }
  if (!response.ok) throw new Error(`The recording couldn’t be downloaded (${response.status}).`)
  const size = Number(response.headers.get('content-length'))
  if (size > MAX_BYTES) throw new Error('This recording is too long to line up on this device.')
  if (!response.body || !size || !onProgress) return response.arrayBuffer()
  const reader = response.body.getReader()
  const out = new Uint8Array(size)
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    // A server can send more than it said (compression); grow rather than fail.
    if (got + value.length > out.length) return new Blob([out.subarray(0, got), value, ...(await rest(reader))] as BlobPart[]).arrayBuffer()
    out.set(value, got)
    got += value.length
    onProgress(got / size)
  }
  return out.buffer.slice(0, got)
}

async function rest(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array[]> {
  const parts: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return parts
    parts.push(value)
  }
}

export interface Detected {
  points: SyncPoint[]
  /** The file as downloaded, so the player can play it without downloading it again. */
  audio: Blob
}

/**
 * Sync points for one recording file, in seconds from its start: `audio` is
 * its address or the file itself, `range` the part of the book to look in.
 * `range` can depend on the file's length, so it's asked for once that's known.
 */
export async function detectSync(
  audio: string | Blob,
  book: { words: string[]; weights: ArrayLike<number>; paragraphEnds: number[] },
  range: (duration: number) => TextRange,
  onProgress?: (fraction: number) => void,
): Promise<Detected> {
  let data: ArrayBuffer
  if (typeof audio === 'string') {
    data = await download(audio, onProgress)
  } else {
    if (audio.size > MAX_BYTES) throw new Error('This recording is too long to line up on this device.')
    data = await audio.arrayBuffer()
  }
  const file = typeof audio === 'string' ? new Blob([data], { type: 'audio/mpeg' }) : audio
  const { samples, sampleRate } = await decode(data)
  const { start, end, options } = range(samples.length / sampleRate)
  const words = book.words.slice(start, end)
  const weights = Float32Array.from({ length: end - start }, (_, i) => book.weights[start + i] ?? 1)
  const paragraphEnds = book.paragraphEnds.filter((i) => i >= start && i < end).map((i) => i - start)
  // The worker gets its own copy of the samples (the decoded buffer's can't be handed over).
  // If it can't start, the fallback runs here on that copy, which is why it's handed over only to a worker.
  const points = await inWorker({ samples: samples.slice(), sampleRate, words, weights, paragraphEnds, options }, true)
  return { points: points.map((p) => ({ index: p.index + start, seconds: p.seconds })), audio: file }
}
