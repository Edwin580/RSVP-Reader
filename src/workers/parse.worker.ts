/// <reference lib="webworker" />
import { assemble, packBook, type AssembleRequest } from '../lib/assemble'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = (e: MessageEvent<AssembleRequest>) => {
  try {
    self.postMessage({ ok: true, book: packBook(assemble(e.data)) })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
