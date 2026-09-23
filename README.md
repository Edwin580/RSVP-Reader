# RSVP Reader

A simple speed-reading app that uses RSVP (Rapid Serial Visual Presentation). Upload a book and it shows the text one word at a time, always in the same spot on screen.

**Live:** https://edwin580.github.io/RSVP-Reader/ (deployed to GitHub Pages on every push to `main`)

## Features

- **File upload**: drag and drop or pick a file. Supports `.epub`, `.pdf` (text-based, not scanned), `.txt` and `.md`. All parsing happens in the browser.
- **Fixed focus point**: each word's *Optimal Recognition Point*, a letter a little left of centre, is highlighted and pinned to the centre, so your eyes never move.
- **Natural word timing**: longer words stay on screen slightly longer, following a smooth curve (1 letter ≈ 0.75×, 5 letters = 1×, 12 letters ≈ 1.25×). Commas, sentence endings and paragraph breaks get pauses. All of this is balanced across the book, so the speed you choose is your real average speed and time-left estimates are accurate. Choose *Even* in the Aa menu to give every word the same time. The first few words after you press play are shown a bit slower.
- **Steady rhythm**: words are scheduled against a clock rather than chained timers, so small delays don't add up into drift or stutter.
- **Navigation**: chapter picker (EPUB chapters and PDF pages), a position slider, word- and sentence-level skipping, and time left in the chapter and the book.
- **Focus mode**: while you're reading, the controls fade away after a couple of seconds and come back when you move the mouse or pause.
- **Context when paused**: the words around your position appear below. Click any word to jump to it.
- **Search**: find any word or phrase in the book. Case, punctuation and accents are ignored. Each result shows the surrounding text and which chapter it's in, and clicking one jumps there. The index is built in a background Web Worker when a book opens, so searching never freezes the UI, even for long books.
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
- **Literata** (reading and headings) and **IBM Plex Mono** (labels and numbers), bundled with `@fontsource`, so no external font requests
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
    rsvp.ts            ORP, word timing and timeline, sentence navigation
    search.ts          phrase search over the book's words
    searchClient.ts    runs indexing and search in a Web Worker (main-thread fallback)
    text.ts            paragraph/word splitting, Markdown stripping, book assembly
    parsers/           epub.ts, pdf.ts, index.ts (dispatches by file extension)
    storage.ts         IndexedDB library + progress, localStorage settings
  hooks/useRsvp.ts     playback engine
  workers/             search.worker.ts
  components/          Library, Reader, SearchPanel, SettingsMenu, WordDisplay, Icon
```

## Roadmap

### Next up

1. **Rename the app to "Chapter"**: a short, friendly name to use everywhere (page title, header, README, repo).
2. **Themes and customization**: light, dark and other color themes, plus reader settings such as font, focus-letter color and word position, so each reader can make it their own.
3. **Storage decision, local vs. account-based**: the leaning is to stay local, so no account is needed. Books and progress already live on the device (IndexedDB). Open questions are whether to add export/import for moving a library between devices, and whether optional sync is ever worth adding.

### Done

- Dynamic word length timing, balanced to the chosen speed
- UI refresh

### Later

- Backend with accounts, so the library and progress sync across devices. Optional, depending on the storage decision above.
- Reading sessions and statistics (time spent, average wpm)
- More formats (`.docx`, `.mobi`), plus OCR for scanned PDFs
- Showing multiple words at a time
