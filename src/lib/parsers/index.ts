import { buildBook, splitMarkdownChapters, splitParagraphs, splitTextChapters, type Section } from '../text'
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

  let title: string | undefined
  let sections: Section[]
  let cover: string | undefined

  switch (ext) {
    case '.epub': {
      const { parseEpub } = await import('./epub')
      ;({ title, sections, cover } = await parseEpub(data))
      break
    }
    case '.pdf': {
      const { parsePdf } = await import('./pdf')
      ;({ title, sections, cover } = await parsePdf(data, onProgress))
      break
    }
    case '.txt':
    case '.md':
    case '.markdown': {
      const text = new TextDecoder().decode(data)
      sections = ext === '.txt' ? splitTextChapters(splitParagraphs(text)) : splitMarkdownChapters(text)
      break
    }
    default:
      throw new Error(`Unsupported file type "${ext || file.name}". Try ${ACCEPTED_EXTENSIONS.join(', ')}.`)
  }

  const book = buildBook(id, title || fallbackTitle, sections)
  if (book.words.length === 0) throw new Error('No readable text found in this file')
  return cover ? { ...book, cover } : book
}
