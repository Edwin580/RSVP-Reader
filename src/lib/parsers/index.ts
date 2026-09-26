import type { AssembleRequest } from '../assemble'
import { assembleInBackground } from '../parseClient'
import type { Book } from '../types'

export const ACCEPTED_EXTENSIONS = ['.epub', '.pdf', '.txt', '.md', '.markdown']

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

/** Content hash, so re-uploading the same file finds its saved progress. */
async function fileId(data: ArrayBuffer, file: File): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return `${file.name}-${file.size}-${file.lastModified}`
}

export async function parseFile(file: File, onProgress?: (fraction: number) => void): Promise<Book> {
  const ext = extension(file.name)
  const data = await file.arrayBuffer()
  const id = await fileId(data, file)
  const fallbackTitle = file.name.replace(/\.[^.]+$/, '')

  // EPUB and PDF text is extracted here (it needs the DOM and pdf.js); the
  // heavy work of splitting it into words happens in a background worker.
  let request: AssembleRequest
  let cover: string | undefined
  switch (ext) {
    case '.epub': {
      const { parseEpub } = await import('./epub')
      const parsed = await parseEpub(data)
      cover = parsed.cover
      request = { kind: 'sections', id, title: parsed.title || fallbackTitle, sections: parsed.sections }
      break
    }
    case '.pdf': {
      const { parsePdf } = await import('./pdf')
      const parsed = await parsePdf(data, onProgress)
      cover = parsed.cover
      request = { kind: 'sections', id, title: parsed.title || fallbackTitle, sections: parsed.sections }
      break
    }
    case '.txt':
    case '.md':
    case '.markdown':
      request = { kind: ext === '.txt' ? 'text' : 'markdown', id, title: fallbackTitle, data }
      break
    default:
      throw new Error('Chapter reads EPUB, PDF, TXT and Markdown files.')
  }

  const book = await assembleInBackground(request)
  if (book.words.length === 0) throw new Error('There’s no readable text in it.')
  return cover ? { ...book, cover } : book
}
