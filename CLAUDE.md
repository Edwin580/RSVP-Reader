# Chapter

Chapter (formerly RSVP Reader) is a speed-reading web app: upload a book (EPUB, PDF, TXT, Markdown) and read it one word at a time (word mode) or as pages with a pacer that follows along (page mode). Everything runs in the browser; books and progress are stored locally in IndexedDB. Deployed to GitHub Pages on every push to `main` (via the `gh-pages` branch), and every pull request gets a preview at `/pr-preview/pr-<number>/` with its own separate storage.

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
npm run test:e2e  # browser tests (Playwright); set PW_CHROMIUM_PATH to use an installed Chromium
```

Run the first four before pushing, and the browser tests too for UI changes. CI runs all five on every pull request. For UI changes, also check the app in a browser at phone and desktop sizes.

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

- Include screenshots whenever a PR changes what the app looks like: before and after, at phone and desktop sizes (and light and dark when colours change). Put them in the section where they help most, usually "How it's tested". Short tables are welcome too.
- Do not include a Claude session link (`claude.ai/code/session_…`) in PR titles or descriptions.
- Keep titles short and descriptive.

## Commits

- Do not add a `Claude-Session:` trailer or any session link to commit messages. A `Co-Authored-By` line is fine.
- When squash-merging, write the final commit message explicitly so no session links come along from the individual commits.
