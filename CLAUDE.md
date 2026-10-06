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
npm run lint      # oxlint, then the UI rules (npm run check:ui)
npm run build     # production build
npm run test:e2e  # browser tests (Playwright); set PW_CHROMIUM_PATH to use an installed Chromium
```

Run the first four before pushing, and the browser tests too for UI changes. CI runs all five on every pull request. For UI changes, also check the app in a browser at phone and desktop sizes.

## UI rules

The interface follows the rules in `docs/ui-rules.md`. In short:

- Colours, shadows and corners come from the tokens at the top of `src/index.css`: one shadow (`--shadow`) for everything that floats, a small set of corners, no raw colours.
- Every pop-up closes with Escape, a tap outside, and on a phone by dragging it down: there it's a bottom sheet with a grab handle (`useSheetDrag`).
- On a phone nothing is wider than the screen (down to 320px), everything tappable is at least 44 × 44px, and text fields use 16px text or larger.

`npm run check:ui` (part of `npm run lint`) checks the code, and `e2e/ui-rules.e2e.ts` checks the running app; both run in CI. A new pop-up goes in the list at the top of that test file.

## Bug fixes

Every bug fix comes with a test that would have caught it, so it can't quietly come back:

- Write a test that reproduces the bug as reported (a browser test for anything you can see or touch, a unit test for logic in `src/lib/`).
- Check it fails with the fix undone, then passes with it. Say so in the PR.
- Browser tests for fixed bugs go in `e2e/regressions.e2e.ts`, named after the behaviour and the PR that fixed it, for example `(#48)`.
- Before changing something a past fix relied on (a CSS rule, a gesture, a layout), read the comment next to it. Several fixes depend on things that look harmless to change: for example, the reader must never be `position: fixed`, because Safari would keep its top bar in the wrong theme.

## Branches

Name each branch `edwin/` plus a few words for the feature or fix, for example `edwin/page-number-fix` or `edwin/faster-pdf-import`. Use a new branch for each pull request.

## Pull requests

Every PR description uses exactly these three sections, in this order:

```markdown
## Purpose
Why this change exists and what it does, in plain language. Link the issue or request if there is one.

## What to focus on in review
The parts that deserve a careful look: tricky logic, trade-offs, behavior changes, risky areas, anything you're unsure about. Point to files or functions.

## How it's tested
What was run and what it showed: unit tests added or changed, manual or browser checks (devices, modes, formats), and anything not tested.
Then how a reviewer can try it on their own phone: numbered steps on the PR preview (`/pr-preview/pr-<number>/`), and how to run the branch locally instead.
```

- Keep it short: a few plain sentences per section. Use lists, bold, tables and code formatting only where they make something clearer, not by default.
- Write in a neutral voice ("Pages are numbered", "The test checks…"), not "I".
- Screenshots are welcome when the change is visible, especially for UI changes.
- End "How it's tested" with "Try it on your phone": a few numbered steps a reviewer can follow on the preview link (where to tap, what should happen), then the local alternative: `git checkout <branch>`, `npm install && npm run dev -- --host`, and open the printed Network address on a phone on the same Wi-Fi.
- Do not include a Claude session link (`claude.ai/code/session_…`) in PR titles or descriptions.
- Keep titles short and descriptive.

## Commits

- Do not add a `Claude-Session:` trailer or any session link to commit messages. A `Co-Authored-By` line is fine.
- When squash-merging, write the final commit message explicitly so no session links come along from the individual commits.
