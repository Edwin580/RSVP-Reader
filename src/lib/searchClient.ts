import { buildSearchIndex, search, type SearchIndex, type SearchResult } from './search'

export type SearchRequest =
  | { type: 'index'; id: string; text: string }
  | { type: 'search'; id: string; reqId: number; query: string; limit: number }

export interface SearchResponse {
  reqId: number
  result: SearchResult
}

/**
 * Search for one book. The index is built in a Web Worker as soon as this is
 * created, so it's ready by the time the user opens search and the UI never
 * blocks. Falls back to building on the main thread when workers aren't
 * available.
 */
export class BookSearch {
  private worker: Worker | null = null
  private fallback: SearchIndex | null = null
  private nextId = 0
  private pending = new Map<number, { query: string; limit: number; resolve: (r: SearchResult) => void }>()
  private readonly id: string
  private readonly words: string[]

  constructor(id: string, words: string[]) {
    this.id = id
    this.words = words
    try {
      this.worker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      return
    }
    this.worker.onmessage = (e: MessageEvent<SearchResponse>) => {
      this.pending.get(e.data.reqId)?.resolve(e.data.result)
      this.pending.delete(e.data.reqId)
    }
    this.worker.onerror = () => this.useFallback()
    this.post({ type: 'index', id, text: words.join('\n') })
  }

  query(query: string, limit = 200): Promise<SearchResult> {
    if (!this.worker) {
      this.fallback ??= buildSearchIndex(this.words)
      return Promise.resolve(search(this.fallback, query, limit))
    }
    const reqId = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(reqId, { query, limit, resolve })
      this.post({ type: 'search', id: this.id, reqId, query, limit })
    })
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
  }

  private post(msg: SearchRequest) {
    this.worker?.postMessage(msg)
  }

  /** If the worker fails, answer outstanding and future queries on the main thread. */
  private useFallback() {
    this.worker?.terminate()
    this.worker = null
    const waiting = [...this.pending.values()]
    this.pending.clear()
    for (const { query, limit, resolve } of waiting) this.query(query, limit).then(resolve)
  }
}
