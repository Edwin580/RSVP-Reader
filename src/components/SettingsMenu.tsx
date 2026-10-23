import { useEffect, useRef, useState } from 'react'
import { useSheetDrag } from '../hooks/useSheetDrag'
import { Icon } from './Icon'
import type { WordTiming } from '../lib/rsvp'
import { effectiveGuideMark, type Accent, type LineFocus, type PlayControl, type ReadingFont, type ReadingMode, type Settings, type Theme } from '../lib/storage'

interface Props {
  settings: Settings
  onSettings: (settings: Settings) => void
  /** Animating out; the reader unmounts it shortly after. */
  closing?: boolean
  onClose: () => void
}

const MIN_SCALE = 0.6
const MAX_SCALE = 1.6
const SCALE_STEP = 0.1

const TIMINGS: { value: WordTiming; label: string; hint: string }[] = [
  { value: 'smart', label: 'Smart', hint: 'A beat longer on new names, rare words and numbers' },
  { value: 'natural', label: 'Natural', hint: 'Longer words stay a little longer' },
  { value: 'even', label: 'Even', hint: 'Every word gets the same time' },
]

const MODES: { value: ReadingMode; label: string; hint: string }[] = [
  { value: 'word', label: 'Word', hint: 'One word at a time in a fixed spot' },
  { value: 'page', label: 'Page', hint: 'Full pages with a marker that follows along' },
]

const PLAY_OPTIONS: { value: PlayControl; label: string; hint: string }[] = [
  { value: 'tap', label: 'Tap', hint: 'Tap anywhere on the page to start, and again to pause' },
  { value: 'hold', label: 'Hold', hint: 'Reads while you hold anywhere on the page, pauses when you let go' },
  {
    value: 'guide',
    label: 'Guide',
    hint: 'Your own pace: hold anywhere and drag to move through the text, or tap a line',
  },
  {
    value: 'free',
    label: 'Free',
    hint: 'Just the page, no timer: turn pages yourself with a swipe, a tap on either side, or the arrow keys',
  },
]

/** Play controls that set their own pace on a page, so only page mode offers them. */
const PAGE_ONLY: PlayControl[] = ['guide', 'free']

const FOCUS_OPTIONS: { value: LineFocus; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'one', label: '1 line' },
  { value: 'three', label: '3 lines' },
]

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'dark', label: 'Dark' },
]

const FONT_OPTIONS: { value: ReadingFont; label: string }[] = [
  { value: 'serif', label: 'Serif' },
  { value: 'sans', label: 'Sans' },
]

/** Swatch colours; the CSS (data-accent) holds the light and dark shades used in the reader. */
const ACCENT_OPTIONS: { value: Accent; label: string; color: string }[] = [
  { value: 'red', label: 'Red', color: '#b3261e' }, // ui-allow: a swatch shows its colour
  { value: 'blue', label: 'Blue', color: '#1f4fb4' }, // ui-allow: a swatch shows its colour
  { value: 'green', label: 'Green', color: '#1d6b43' }, // ui-allow: a swatch shows its colour
  { value: 'purple', label: 'Purple', color: '#6a3fb0' }, // ui-allow: a swatch shows its colour
]

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['← →', 'Word'],
  ['⇧ ← →', 'Sentence'],
  ['↑ ↓', 'Speed'],
  ['/', 'Search'],
  ['B', 'Bookmark this spot'],
  ['M', 'Word / page mode'],
  ['PgUp PgDn', 'Page (page mode)'],
  ['Esc', 'Library'],
]

const MORE_KEY = 'chapter-settings-more'

function loadMore(): boolean {
  try {
    return localStorage.getItem(MORE_KEY) === '1'
  } catch {
    return false
  }
}

/** A row of mutually exclusive choices. */
function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string; className?: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          className={o.className}
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** An on/off setting: its name and a switch, the whole row one tap target. */
function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="setting switch-row" onClick={() => onChange(!checked)}>
      <span className="setting-name">{label}</span>
      <span className="switch" aria-hidden="true" />
    </button>
  )
}

/**
 * The Aa menu. Up front, what people change while reading: mode, how to read
 * (and the options that go with it), text size and theme. Everything else
 * waits behind "More settings".
 */
export function SettingsMenu({ settings, onSettings, closing, onClose }: Props) {
  const [more, setMore] = useState(loadMore)
  const sheet = useRef<HTMLDivElement>(null)
  useSheetDrag(sheet, onClose)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const set = (change: Partial<Settings>) => onSettings({ ...settings, ...change })
  // The guide and free reading set their own pace on a page, so they're only
  // offered in page mode (in word mode they play with a tap, as the reader does).
  const playOptions = settings.mode === 'page' ? PLAY_OPTIONS : PLAY_OPTIONS.filter((p) => !PAGE_ONLY.includes(p.value))
  const playControl = settings.mode === 'word' && PAGE_ONLY.includes(settings.playControl) ? 'tap' : settings.playControl
  // Only what applies to how you read: the pacer moves with the timer (tap or
  // hold), the guide marks the line you're on, and free reading has neither.
  const timed = playControl === 'tap' || playControl === 'hold'
  const guided = settings.mode === 'page' && playControl === 'guide'
  // The guide's mark as two parts: the rest blacked out (its line focus) and
  // a line under the one you're on. On pages it always marks something (see
  // effectiveGuideMark), so turning off the one left switches on the other.
  const guideMark = effectiveGuideMark(settings)
  const blackout = guideMark === 'focus' || guideMark === 'both'
  const under = guideMark === 'line' || guideMark === 'both'
  const pages = settings.guideLayout === 'pages'
  const guideFocus: LineFocus = settings.lineFocus === 'three' ? 'three' : 'one'
  const setGuide = (blackout: boolean, under: boolean, lineFocus = guideFocus) =>
    set({ guideMark: blackout && under ? 'both' : blackout ? 'focus' : under ? 'line' : 'none', lineFocus })
  const lineFocus = guided ? (blackout ? guideFocus : 'off') : settings.lineFocus
  const setLineFocus = (value: LineFocus) =>
    guided ? (value === 'off' ? setGuide(false, under || pages) : setGuide(true, under, value)) : set({ lineFocus: value })
  const highlight = settings.pageGuide === 'highlight' || settings.pageGuide === 'both'
  const pacer = settings.pageGuide === 'pacer' || settings.pageGuide === 'both'
  const setPageGuide = (highlight: boolean, pacer: boolean) =>
    set({ pageGuide: highlight && pacer ? 'both' : highlight ? 'highlight' : pacer ? 'pacer' : 'none' })
  const setScale = (textScale: number) =>
    set({ textScale: Math.round(Math.max(MIN_SCALE, Math.min(MAX_SCALE, textScale)) * 10) / 10 })
  const toggleMore = () => {
    setMore(!more)
    try {
      localStorage.setItem(MORE_KEY, more ? '0' : '1')
    } catch {
      // Not remembered; fine.
    }
  }

  return (
    <>
      {/* Catches the tap that closes the menu, so it can't also reach the
          reader underneath (where a tap plays, pauses or jumps to a word). */}
      {/* Clear: on phones the page is dimmed by the sheet's shadow instead.
          Safari tints its top bar from a coloured layer covering the top of
          the page and keeps that colour, so a dim backdrop there left the bar
          in the old theme after changing it here. */}
      <div className={`popover-backdrop is-clear${closing ? ' is-closing' : ''}`} aria-hidden="true" onClick={onClose} />
      <div ref={sheet} className={`popover settings-menu${closing ? ' is-closing' : ''}`} role="dialog" aria-label="Reading settings">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="setting">
          <span className="setting-name">Mode</span>
          <Choice label="Reading mode" options={MODES} value={settings.mode} onChange={(mode) => set({ mode })} />
        </div>

        <div className="setting setting-stack">
          <span className="setting-name">Play with</span>
          <Choice label="Play with" options={playOptions} value={playControl} onChange={(playControl) => set({ playControl })} />
          <span className="hint">{playOptions.find((p) => p.value === playControl)?.hint}</span>
        </div>

        {settings.mode === 'page' && timed && (
          <>
            <Switch label="Highlight word" checked={highlight} onChange={(on) => setPageGuide(on, pacer)} />
            <Switch label="Pacer line" checked={pacer} onChange={(on) => setPageGuide(highlight, on)} />
          </>
        )}

        {guided && (
          <Switch label="Continuous scroll" checked={!pages} onChange={(on) => set({ guideLayout: on ? 'scroll' : 'pages' })} />
        )}

        {settings.mode === 'page' && (timed || guided) && (
          <div className="setting setting-stack">
            <span className="setting-name">Line focus</span>
            <Choice label="Line focus" options={FOCUS_OPTIONS} value={lineFocus} onChange={setLineFocus} />
          </div>
        )}

        {guided && <Switch label="Line under" checked={under} onChange={(on) => setGuide(blackout || (!on && pages), on)} />}

        <div className="setting">
          <span className="setting-name">Text size</span>
          <div className="stepper">
            <button type="button" className="icon-button" onClick={() => setScale(settings.textScale - SCALE_STEP)} aria-label="Smaller text">
              <span style={{ fontSize: '0.8em' }}>A</span>
            </button>
            <span className="stepper-value">{Math.round(settings.textScale * 100)}%</span>
            <button type="button" className="icon-button" onClick={() => setScale(settings.textScale + SCALE_STEP)} aria-label="Larger text">
              <span style={{ fontSize: '1.2em' }}>A</span>
            </button>
          </div>
        </div>

        <div className="setting setting-stack">
          <span className="setting-name">Theme</span>
          <Choice label="Theme" options={THEME_OPTIONS} value={settings.theme} onChange={(theme) => set({ theme })} />
        </div>

        <button type="button" className="more-toggle" aria-expanded={more} onClick={toggleMore}>
          More settings
          <Icon name="chevronDown" size={18} />
        </button>

        {more && (
          <div className="more-settings">
            <div className="setting setting-stack">
              <span className="setting-name">Word timing</span>
              <Choice label="Word timing" options={TIMINGS} value={settings.wordTiming} onChange={(wordTiming) => set({ wordTiming })} />
              <span className="hint">{TIMINGS.find((t) => t.value === settings.wordTiming)?.hint}</span>
            </div>

            <Switch
              label="Thin progress bar"
              checked={settings.progressBar === 'thin'}
              onChange={(on) => set({ progressBar: on ? 'thin' : 'slider' })}
            />

            <div className="setting">
              <span className="setting-name">Font</span>
              <Choice
                label="Font"
                options={FONT_OPTIONS.map((f) => ({ ...f, className: f.value === 'serif' ? 'serif' : 'sans' }))}
                value={settings.font}
                onChange={(font) => set({ font })}
              />
            </div>

            <div className="setting">
              <span className="setting-name">Focus color</span>
              <div className="swatches" role="radiogroup" aria-label="Focus color">
                {ACCENT_OPTIONS.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    role="radio"
                    className="swatch"
                    aria-checked={settings.accent === a.value}
                    aria-label={a.label}
                    title={a.label}
                    style={{ '--swatch': a.color } as React.CSSProperties}
                    onClick={() => set({ accent: a.value })}
                  />
                ))}
                {/* Any colour: the system colour picker, behind a colour-wheel swatch. */}
                <label
                  className={`swatch swatch-custom${settings.accent === 'custom' ? ' is-checked' : ''}`}
                  title="Custom color"
                  style={settings.accent === 'custom' ? ({ '--swatch': settings.customColor } as React.CSSProperties) : undefined}
                >
                  <input
                    type="color"
                    aria-label="Custom color"
                    value={settings.customColor}
                    onClick={() => settings.accent !== 'custom' && set({ accent: 'custom' })}
                    onChange={(e) => set({ accent: 'custom', customColor: e.target.value.toLowerCase() })}
                  />
                </label>
              </div>
            </div>

            <dl className="shortcuts">
              {SHORTCUTS.map(([key, action]) => (
                <div key={key}>
                  <dt>
                    <kbd>{key}</kbd>
                  </dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </>
  )
}
