import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import type { WordTiming } from '../lib/rsvp'
import type { Accent, PageGuide, PlayControl, ReadingFont, ReadingMode, Settings, Theme } from '../lib/storage'

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
]

const GUIDE_OPTIONS: { value: PageGuide; label: string }[] = [
  { value: 'highlight', label: 'Highlight' },
  { value: 'pacer', label: 'Line' },
  { value: 'both', label: 'Both' },
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
  { value: 'red', label: 'Red', color: '#b3261e' },
  { value: 'blue', label: 'Blue', color: '#1f4fb4' },
  { value: 'green', label: 'Green', color: '#1d6b43' },
  { value: 'purple', label: 'Purple', color: '#6a3fb0' },
]

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['← →', 'Word'],
  ['⇧ ← →', 'Sentence'],
  ['↑ ↓', 'Speed'],
  ['/', 'Search'],
  ['B', 'Bookmark this spot'],
  ['D', 'Define the word'],
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

/**
 * The Aa menu. Up front, only what people change while reading: mode, text
 * size and theme. Everything else waits behind "More settings".
 */
export function SettingsMenu({ settings, onSettings, closing, onClose }: Props) {
  const [more, setMore] = useState(loadMore)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const set = (change: Partial<Settings>) => onSettings({ ...settings, ...change })
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
      <div className={`popover settings-menu${closing ? ' is-closing' : ''}`} role="dialog" aria-label="Reading settings">
        <div className="setting">
          <span className="setting-name">Mode</span>
          <Choice label="Reading mode" options={MODES} value={settings.mode} onChange={(mode) => set({ mode })} />
        </div>

        {settings.mode === 'page' && (
          <div className="setting setting-stack">
            <span className="setting-name">Guide</span>
            <Choice label="Guide" options={GUIDE_OPTIONS} value={settings.pageGuide} onChange={(pageGuide) => set({ pageGuide })} />
          </div>
        )}

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
              <span className="setting-name">Play with</span>
              <Choice label="Play with" options={PLAY_OPTIONS} value={settings.playControl} onChange={(playControl) => set({ playControl })} />
              <span className="hint">{PLAY_OPTIONS.find((p) => p.value === settings.playControl)?.hint}</span>
            </div>

            <div className="setting setting-stack">
              <span className="setting-name">Word timing</span>
              <Choice label="Word timing" options={TIMINGS} value={settings.wordTiming} onChange={(wordTiming) => set({ wordTiming })} />
              <span className="hint">{TIMINGS.find((t) => t.value === settings.wordTiming)?.hint}</span>
            </div>

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
