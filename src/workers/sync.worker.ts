/// <reference lib="webworker" />
import { alignChapter, findPauses, type AlignOptions } from '../lib/pauses'

declare const self: DedicatedWorkerGlobalScope

export interface SyncRequest {
  samples: Float32Array
  sampleRate: number
  /** The stretch of text to look in: its words, their weights, and which end a paragraph (indices into `words`). */
  words: string[]
  weights: Float32Array
  paragraphEnds: number[]
  options: AlignOptions
}

self.onmessage = (e: MessageEvent<SyncRequest>) => {
  const { samples, sampleRate, words, weights, paragraphEnds, options } = e.data
  try {
    const pauses = findPauses(samples, sampleRate)
    const text = { start: 0, end: words.length, words, weights, paragraphEnds: new Set(paragraphEnds) }
    self.postMessage({ ok: true, points: alignChapter(pauses, samples.length / sampleRate, text, options) })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
