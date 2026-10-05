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

## Consistent styling

New UI looks and behaves like what's already there. Build it from the existing pieces instead of styling it afresh:

- Panels are sheets on phones and side panels on desktop: `search-backdrop is-sheet` around a `search-panel`, with a `sheet-handle`, a `panel-bar` and `panel-title`, a close `icon-button`, Escape to close, and `useSheetDrag` so it can be dragged down.
- Buttons: `demo-button` for the one main action, `text-button` for secondary ones, `icon-button` for icons, `link-button` inside text, `segmented` for a choice between a few options. Section headings are `search-section`, explanations `search-hint`.
- Colours, radii and shadows come from the variables in `index.css` (`--text`, `--text-2`, `--bg`, `--fill`, `--separator`, `--accent`, `--red`, `--radius`, `--shadow`), never literal values, so every theme follows. Only floating surfaces (panels, popovers, toasts) get `--shadow`.
- Before pushing a UI change, screenshot each screen it touches at phone and desktop sizes, in light and dark, next to an existing screen of the same kind (a new sheet next to Bookmarks, say). Check type sizes, spacing, buttons and colours match, nothing wraps or overlaps, and nothing shows that shouldn't, such as a stray shadow or a hidden element peeking through. Say in the PR what was compared.

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
