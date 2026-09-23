# RSVP Reader

A simple speed-reading app that uses RSVP (Rapid Serial Visual Presentation). Upload a book and it shows the text one word at a time, always in the same spot on screen.

**Live:** https://edwin580.github.io/RSVP-Reader/ (deployed to GitHub Pages on every push to `main`)

## Features

- **File upload**: drag and drop or pick a file. Supports `.epub`, `.pdf` (text-based, not scanned), `.txt` and `.md`. All parsing happens in the browser.
- **Fixed focus point**: each word's *Optimal Recognition Point*, a letter a little left of centre, is highlighted and pinned to the centre, so your eyes never move.
- **Natural pacing**: commas, sentence endings, paragraph breaks and long words get extra time. The first few words after you press play are also shown a bit slower.
- **Navigation**: chapter picker (EPUB chapters and PDF pages), a position slider, and word- and sentence-level skipping.
- **Context when paused**: the words around your position appear below. Click any word to jump to it.
- **Search**: find any word or phrase in the book. Case, punctuation and accents are ignored. Each result shows the surrounding text and which chapter it's in, and clicking one jumps there.
- **Local library and progress**: books and reading positions are saved in IndexedDB. Uploading the same file again finds your saved progress, because books are identified by a hash of their contents. When you reopen a book, reading resumes at the start of the sentence you were on.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Back / forward one word |
| Shift + ← / → | Previous / next sentence |
| ↑ / ↓ | Speed ±25 wpm |
| / or Ctrl/⌘ + F | Search in book |
| Esc | Back to library |

## Stack

- **Vite + React + TypeScript**
- **JSZip + DOMParser** for EPUB. We only need the text, so this avoids a full EPUB rendering engine.
- **pdf.js** (`pdfjs-dist`, legacy build for broader browser support) for PDF text extraction
- **idb-keyval** for IndexedDB storage (`src/lib/storage.ts`). All persistence goes through this one module, so it can later be replaced by or synced with a backend.
- **Vitest** for unit tests and **oxlint** for linting

## Development

```bash
npm install
npm run dev      # start the dev server
npm test         # run unit tests
npm run lint
npm run build    # type-check and build for production
```

## Project layout

```
src/
  lib/
    rsvp.ts            ORP, timing, sentence navigation
    search.ts          phrase search over the book's words
    text.ts            paragraph/word splitting, Markdown stripping, book assembly
    parsers/           epub.ts, pdf.ts, index.ts (dispatches by file extension)
    storage.ts         IndexedDB library + progress, localStorage settings
  hooks/useRsvp.ts     playback engine
  components/          Library, Reader, SearchPanel, WordDisplay
```

## Roadmap

- Backend with accounts, so the library and progress sync across devices
- Reading sessions and statistics (time spent, average wpm)
- More formats (`.docx`, `.mobi`), plus OCR for scanned PDFs
- Showing multiple words at a time and more display options
