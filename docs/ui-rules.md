# UI rules

How Chapter's interface stays consistent, and works on a phone first. Each rule
says how it's checked. `npm run check:ui` checks the code (CSS and components),
and the browser tests in `e2e/ui-rules.e2e.ts` check the running app at phone
and desktop sizes. CI runs both on every pull request.

## Look

**1. Colours come from the theme.** Every colour is a token defined at the top
of `src/index.css` (`--bg`, `--bg-2`, `--fill`, `--raised`, `--text`,
`--text-2`, `--separator`, `--red`, `--accent`, `--scrim`), with values for
light, sepia and dark. Anything else uses those tokens, or mixes them with
`color-mix()`, so a new theme or dark mode can't leave a stray colour behind.
A raw colour only appears where a token is defined (a `--name: value` line).
The few that can't follow the theme are marked with `ui-allow` and say why:
the logo, the book cover cloths, the colour wheel and the accent swatches.
*Checked by:* `check:ui`.

**2. One shadow for everything that floats.** Pop-overs, panels, cards and
toasts all use `--shadow`. Bottom sheets on a phone have no shadow, which
would fall below the sheet as a smudge above Safari's toolbar. Instead the
backdrop behind every sheet dims the page with `--shadow-scrim`, a shadow
inside it that ends at the page's edges. Not a coloured background, which
Safari picks up to tint its toolbars, and not a shadow spread out from the
sheet, which dims Safari's bars a second time. A chosen option is outlined with `--ring`; the
focus colour swatches use `--ring-swatch` and `--ring-swatch-on`. Book covers
have their own `--shadow-cover`. No other shadows: a `box-shadow` is `none` or
made only of these tokens.
*Checked by:* `check:ui`, and the browser tests compare the shadows of every
pop-up as drawn, and check on a phone, in each theme, that every sheet dims
the page the same way.

**3. A small set of corners.** `--radius-sm` (2px) for small marks,
`--radius` (4px) for buttons, fields and cards, `--radius-lg` (8px) for
pop-overs, and `--radius-sheet` (12px) for the top of bottom sheets. Circles
are `50%`, pills `999px`, and book covers `--radius-cover`.
*Checked by:* `check:ui`.

## Pop-ups

**4. Every pop-up can be put away the same ways.** Anything with
`role="dialog"` closes with Escape (wherever the focus is), with a tap
outside it, and on a phone by dragging it down: it's a bottom sheet there,
with a grab handle at the top, and pulling down from the handle (or the top
of its content) moves the whole sheet with the finger (`useSheetDrag`).
*Checked by:* `check:ui` (every dialog uses `useSheetDrag` and has a
`sheet-handle`), and the browser tests open each pop-up on a phone, drag it
down, and check it closes.

**5. Pop-ups fit the screen.** Never wider than the screen, never taller
than it, with their content scrolling inside.
*Checked by:* the browser tests, for each pop-up at 320px and 390px wide.

## Phones

**6. Nothing scrolls sideways.** No screen, and no open pop-up, is wider than
the phone, down to 320px (the smallest iPhone SE).
*Checked by:* the browser tests, on every screen and pop-up at 320px and 390px.

**7. Everything you can tap is at least 44 × 44px on a touch screen** (Apple's
minimum), so it can be hit with a thumb. Smaller looks are fine with a larger
invisible hit area around them. The one exception is the reading calendar's
day squares: a year of days can't have thumb-sized squares, so they're
marked `data-small-target` (the totals are in words on the button above them).
*Checked by:* the browser tests, on every screen and pop-up.

**8. Text fields use 16px text or larger,** or iOS zooms the page when they're
tapped.
*Checked by:* the browser tests.

**9. Mind the notch and the home bar.** Anything pinned to an edge of the
screen pads itself with `--safe-top`, `--safe-bottom`, `--safe-left` or
`--safe-right`.
*Checked by:* review.

**10. The reader is never `position: fixed`.** Safari would keep its top bar
in the wrong theme (see CLAUDE.md, "Bug fixes").
*Checked by:* the browser tests in `e2e/regressions.e2e.ts`.

## Adding to the interface

Use the existing pieces before making new ones: `.icon-button` for icon
buttons, `.text-button` for quiet text actions, `.demo-button` for the one
filled main action on a screen, `Choice` (`.segmented`) for a set of options,
and the sheet pattern in `SettingsMenu` or `BookmarksPanel` for a pop-up.
A new pop-up gets an entry in the pop-up list at the top of
`e2e/ui-rules.e2e.ts`, so the rules above are checked for it too.
