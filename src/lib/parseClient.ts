import { assemble, unpackBook, type AssembleRequest, type PackedBook } from './assemble'
import type { Book } from './types'

type Reply = { ok: true; book: PackedBook } | { ok: false; error: string }

/**
 * Assemble a book in a Web Worker so a long book doesn't freeze the page
 * while it's split into words. Falls back to the main thread if workers
 * aren't available or the worker fails to start.
 */
export function assembleInBackground(request: AssembleRequest): Promise<Book> {
  let worker: Worker
  try {
    worker = new Worker(new URL('../workers/parse.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return Promise.resolve(assemble(request))
  }
  return new Promise<Book>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<Reply>) => {
      worker.terminate()
      if (e.data.ok) resolve(unpackBook(e.data.book))
      else reject(new Error(e.data.error))
    }
    worker.onerror = (e) => {
      e.preventDefault()
      worker.terminate()
      // The worker couldn't run (e.g. blocked by the browser): do it here instead.
      try {
        resolve(assemble(request))
      } catch (error) {
        reject(error)
      }
    }
    // Hand over a copy of the file's bytes (cheap) so the original stays usable for the fallback.
    if (request.kind === 'sections') worker.postMessage(request)
    else {
      const data = request.data.slice(0)
      worker.postMessage({ ...request, data }, [data])
    }
  })
}
