# RSVP Reader

A simple speed-reading app that uses RSVP (Rapid Serial Visual Presentation). Upload a book and it shows the text one word at a time, always in the same spot on screen.

**Live:** https://edwin580.github.io/RSVP-Reader/ (deployed to GitHub Pages on every push to `main`)

**Previews:** every pull request gets its own copy of the app at `https://edwin580.github.io/RSVP-Reader/pr-preview/pr-<number>/`, linked (with a QR code) in a comment on the PR and removed when the PR closes. Previews keep their own books and settings, separate from the real app.

## Features

- **File upload**: drag and drop or pick a file. Supports `.epub`, `.pdf` (text-based, not scanned), `.txt` and `.md`. All parsing happens in the browser, and splitting a book into words runs in a background Web Worker so the page stays responsive while a long book loads.
- **Demo for first-time visitors**: while the library is empty, a "Try the demo" card opens a short sample (tips plus the opening of *Alice's Adventures in Wonderland*, public domain) to try both reading modes, chapters and search. The sample is never saved and the card disappears once you add a book.
- **Two reading modes**, switched in the Aa menu or with `M`:
  - **Word**: RSVP, one word at a time in a fixed spot.
  - **Page**: guided reading. The book is laid out as pages that fit your screen. The current word is softly highlighted and a thin pacer line sweeps steadily along each line at your chosen speed (the first word of each line gets a beat more for the return sweep), and the page turns itself when you reach the end: the old page slides out as the new one slides in, the marker fades in on the first word, and that word gets a little extra time so your eyes can move to the top. Pages end at a sentence when one falls on the last two lines. Tap any word to jump there. Pages are measured to fit exactly and re-flow when you rotate or resize.
- **Themes and customization** (Aa menu): Auto (follows your system), Light, Sepia and Dark themes; a sans or serif reading font; and a red, blue, green or purple focus color for the focus letter and page-mode marker. The default is warm paper and ink: a beige page in light mode and a warm near-black in dark mode. All text meets WCAG AA contrast in every theme.
- **Fixed focus point**: each word's *Optimal Recognition Point*, a letter a little left of centre, is highlighted and pinned to the centre, so your eyes never move.
- **Natural word timing**: longer words stay on screen slightly longer, following a smooth curve (1 letter ≈ 0.75×, 5 letters = 1×, 12 letters ≈ 1.25×). Commas, sentence endings and paragraph breaks get pauses. All of this is balanced across the book, so the speed you choose is your real average speed and time-left estimates are accurate. Choose *Even* in the Aa menu to give every word the same time. The first few words after you press play are shown a bit slower.
- **Steady rhythm**: words are scheduled against a clock rather than chained timers, so small delays don't add up into drift or stutter.
- **Chapters**: detected from EPUB headings, text-file headings ("CHAPTER I.", "Chapter 12: …", "Prologue", with subtitles), Markdown `#`/`##` headings, and PDF bookmarks. Like an e-reader, page mode starts each chapter on a new page with its title set as a heading; word mode shows titles in bold with a short extra pause. (Books added before this update keep their old chapters; re-add a text file to pick up detected chapters.)
- **Navigation**: chapter picker (EPUB chapters and PDF pages), a position slider, word- and sentence-level skipping, and time left in the chapter and the book.
- **Sized for your device**: the word size comes from your screen's width and height, and very long words slide slightly off-centre or shrink so they're never cut off. Safe areas around notches and home bars are respected, buttons are at least 44px, settings open as a bottom sheet on phones, and landscape phones get a compact layout.
- **Smooth, native-feeling motion**: every button responds visibly to a tap, opening a book slides the reader in (and back out to the library) where the browser supports view transitions, and menus and panels slide away when closed instead of vanishing. All motion is turned off when the system asks for reduced motion.
- **Focus mode**: while you're reading, the controls fade away after a couple of seconds and come back when you move the mouse or pause.
- **Context when paused**: the words around your position appear below. Click any word to jump to it.
- **Search**: finds whole words (never fragments: *cat* doesn't match *education*), different forms of a word (*run* finds *running*), and hyphenated words both ways (*daisy chain* and *boathouse* find *daisy-chain* and *boat-house*); ignores case, punctuation and accents. Results are grouped into exact **matches** of your words in order and **related passages** where all the important words appear close together. The last word completes as you type (*rabb* → *rabbit*), misspellings fall back to the closest word in the book with a note (*wite rabit* → *white rabbit*), "quotes" restrict to the exact phrase, and a clear message appears when nothing matches. Indexing runs in a background Web Worker when a book opens; searches take a few milliseconds even on long books.
- **Reading stats**: a quiet line under the library title ("12 min today · 4-day streak") opens a small card with a bar for each of the last 7 days, time read, your real average speed, streak and words read. Only time with the words moving counts, the demo isn't counted, and nothing shows until you've read in the last week, so it never nags.
- **Book covers**: the library shows each EPUB's cover image and a PDF's first page as its cover; other books get a plain cloth cover with the title. (Books added before covers were supported get the plain cover; add the file again to pick up its cover.)
- **Works offline**: after your first visit the whole app is cached on the device, so it opens and reads without a connection (handy once it's added to your Home Screen). When you're online, new versions load as soon as they're deployed.
- **Local library and progress**: books and reading positions are saved in IndexedDB. Uploading the same file again finds your saved progress, because books are identified by a hash of their contents. When you reopen a book, reading resumes at the start of the sentence you were on. The app asks the browser to keep this data permanently (Safari otherwise clears site data that goes unused for about a week).
- **Backup and restore**: a quiet line under your books shows when you last backed up. *Back up* saves your whole library and reading positions as one file (on phones, through the share sheet, so it can go to Files, iCloud or another device); *Restore* merges a backup into this device: books you already have are kept, and the most recent reading position wins. A gentle reminder appears only when the browser might clear your books and there's no backup from the last two weeks.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Back / forward one word |
| Shift + ← / → | Previous / next sentence |
| ↑ / ↓ | Speed ±25 wpm |
| / or Ctrl/⌘ + F | Search in book |
| M | Switch word / page mode |
| Page Up / Page Down | Previous / next page (page mode) |
| Esc | Back to library |

## Stack

- **Vite + React + TypeScript**
- **System fonts** (San Francisco on Apple devices, Roboto on Android, Segoe UI on Windows), so the app feels native and loads no font files
- **JSZip + DOMParser** for EPUB. We only need the text, so this avoids a full EPUB rendering engine.
- **pdf.js** (`pdfjs-dist`, legacy build for broader browser support) for PDF text extraction
- **idb-keyval** for IndexedDB storage (`src/lib/storage.ts`). All persistence goes through this one module, so it can later be replaced by or synced with a backend.
- **Vitest** for unit tests and **oxlint** for linting

## Development

```bash
npm install
npm run dev      # start the dev server
npm test         # run unit tests
npm run test:e2e # build, then run browser tests (desktop and phone) with Playwright
npm run lint
npm run build    # type-check and build for production
```

## Project layout

```
e2e/                   browser tests: demo, upload and resume, chapters, page mode, search, settings
service-worker/sw.js   offline cache; the build fills in the file list (vite.config.ts)
src/
  lib/
    appearance.ts      applies theme, reading font and focus color to the page
    backup.ts          backup file format and merging a restore into the library
    covers.ts          finding EPUB cover images and making cover thumbnails
    demo.ts            built-in sample book offered while the library is empty
    rsvp.ts            ORP, word timing and timeline, sentence navigation
    pages.ts           page anchoring and paragraph grouping for page mode
    search.ts          full-text search: word index, word forms, related passages, typo fallback
    searchClient.ts    runs indexing and search in a Web Worker (main-thread fallback)
    text.ts            paragraph/word splitting, Markdown stripping, book assembly
    parsers/           epub.ts, pdf.ts, index.ts (dispatches by file extension)
    assemble.ts        text → words, paragraphs, chapters (runs in the parse worker)
    parseClient.ts     runs assembly in a Web Worker (main-thread fallback)
    preview.ts         pull request preview builds: separate storage, preview label
    stats.ts           reading time per day, average speed and streak
    storage.ts         IndexedDB library + progress, localStorage settings
  hooks/useRsvp.ts     playback engine
  workers/             search.worker.ts, parse.worker.ts
  components/          Library, ReadingStats, Reader, PageView, SearchPanel, SettingsMenu, WordDisplay, Icon
```

## Roadmap

### Next up

1. **Rename the app to "Chapter"**: a short, friendly name to use everywhere (page title, header, README, repo).
2. **Themes and customization**: light, dark and other color themes, plus reader settings such as font, focus-letter color and word position, so each reader can make it their own.
3. **Storage decision, local vs. account-based**: the leaning is to stay local, so no account is needed. Books and progress already live on the device (IndexedDB). Backup and restore now covers moving a library between devices; the open question is whether optional sync is ever worth adding.

### Done

- Dynamic word length timing, balanced to the chosen speed
- UI refresh

### Later

- Backend with accounts, so the library and progress sync across devices. Optional, depending on the storage decision above.
- Reading sessions and statistics (time spent, average wpm)
- More formats (`.docx`, `.mobi`), plus OCR for scanned PDFs
- Showing multiple words at a time
