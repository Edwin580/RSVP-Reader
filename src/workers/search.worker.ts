/// <reference lib="webworker" />
import { analyzeBook } from '../lib/analysis'
import { buildSearchIndex, search, type SearchIndex } from '../lib/search'
import type { SearchRequest, SearchResponse } from '../lib/searchClient'

declare const self: DedicatedWorkerGlobalScope

let current: { id: string; index: SearchIndex } | null = null

self.onmessage = (e: MessageEvent<SearchRequest>) => {
  const msg = e.data
  if (msg.type === 'index') {
    // Words never contain whitespace, so they arrive as one newline-joined
    // string, which is much cheaper to copy between threads than an array.
    const words = msg.text.split('\n')
    // Names and pacing first: the reader is waiting on them to fine-tune timing.
    const analysis = analyzeBook(words)
    self.postMessage({ type: 'analysis', id: msg.id, analysis } satisfies SearchResponse, [
      analysis.nameOf.buffer,
      analysis.extras.buffer,
    ])
    current = { id: msg.id, index: buildSearchIndex(words) }
    return
  }
  const result =
    current?.id === msg.id
      ? search(current.index, msg.query, msg.limit)
      : { matches: [], related: [], totalMatches: 0, totalRelated: 0 }
  self.postMessage({ type: 'result', reqId: msg.reqId, result } satisfies SearchResponse)
}
