# Chapter

Chapter (formerly RSVP Reader) is a speed-reading web app: upload a book (EPUB, PDF, TXT, Markdown) and read it one word at a time (word mode) or as pages with a pacer that follows along (page mode). Everything runs in the browser; books and progress are stored locally in IndexedDB. Deployed to GitHub Pages on every push to `main`.

## Stack and layout

Vite + React + TypeScript, Vitest, oxlint. See the README's "Project layout" for where things live. The main pieces:

- `src/lib/` — pure logic (parsing, timing, pagination, search, storage). Keep it framework-free and unit-tested.
- `src/components/` — UI. `Reader` owns playback; `PageView` and `WordDisplay` are the two reading modes.
- `src/hooks/useRsvp.ts` — the playback clock shared by both modes.

## Commands

```bash
npm test          # unit tests (Vitest)
npx tsc -b        # type-check
npm run lint      # oxlint
npm run build     # production build
```

Run all four before pushing. For UI changes, also check the app in a browser at phone and desktop sizes.

## Pull requests

Every PR description uses exactly these three sections, in this order:

```markdown
## Purpose
Why this change exists and what it does, in plain language. Link the issue or request if there is one.

## What to focus on in review
The parts that deserve a careful look: tricky logic, trade-offs, behavior changes, risky areas, anything you're unsure about. Point to files or functions.

## How it's tested
What was run and what it showed: unit tests added or changed, manual or browser checks (devices, modes, formats), and anything not tested.
```

- Screenshots or short tables are welcome inside these sections when they help, especially for UI changes.
- Do not include a Claude session link (`claude.ai/code/session_…`) in PR titles or descriptions.
- Keep titles short and descriptive.

## Commits

- Do not add a `Claude-Session:` trailer or any session link to commit messages. A `Co-Authored-By` line is fine.
- When squash-merging, write the final commit message explicitly so no session links come along from the individual commits.
