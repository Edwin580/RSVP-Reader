/// <reference lib="webworker" />
import { buildSearchIndex, search, type SearchIndex } from '../lib/search'
import type { SearchRequest, SearchResponse } from '../lib/searchClient'

declare const self: DedicatedWorkerGlobalScope

let current: { id: string; index: SearchIndex } | null = null

self.onmessage = (e: MessageEvent<SearchRequest>) => {
  const msg = e.data
  if (msg.type === 'index') {
    // Words never contain whitespace, so they arrive as one newline-joined
    // string, which is much cheaper to copy between threads than an array.
    current = { id: msg.id, index: buildSearchIndex(msg.text.split('\n')) }
    return
  }
  const result =
    current?.id === msg.id ? search(current.index, msg.query, msg.limit) : { matches: [], total: 0 }
  self.postMessage({ reqId: msg.reqId, result } satisfies SearchResponse)
}
