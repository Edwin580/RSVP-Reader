import { useEffect, useRef } from 'react'
import type { WordTiming } from '../lib/rsvp'
import type { ReadingMode, Settings } from '../lib/storage'

interface Props {
  settings: Settings
  onSettings: (settings: Settings) => void
  onClose: () => void
}

const MIN_SCALE = 0.6
const MAX_SCALE = 1.6
const SCALE_STEP = 0.1

const TIMINGS: { value: WordTiming; label: string; hint: string }[] = [
  { value: 'natural', label: 'Natural', hint: 'Longer words stay a little longer' },
  { value: 'even', label: 'Even', hint: 'Every word gets the same time' },
]

const MODES: { value: ReadingMode; label: string; hint: string }[] = [
  { value: 'word', label: 'Word', hint: 'One word at a time in a fixed spot' },
  { value: 'page', label: 'Page', hint: 'Full pages with a marker that follows along' },
]

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['← →', 'Word'],
  ['⇧ ← →', 'Sentence'],
  ['↑ ↓', 'Speed'],
  ['/', 'Search'],
  ['M', 'Word / page mode'],
  ['PgUp PgDn', 'Page (page mode)'],
  ['Esc', 'Library'],
]

export function SettingsMenu({ settings, onSettings, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const target = e.target as Element
      if (!ref.current?.contains(target) && !target.closest?.('.aa')) onClose()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])

  const setScale = (textScale: number) =>
    onSettings({ ...settings, textScale: Math.round(Math.max(MIN_SCALE, Math.min(MAX_SCALE, textScale)) * 10) / 10 })
  const timingHint = TIMINGS.find((t) => t.value === settings.wordTiming)?.hint

  return (
    <div className="popover" ref={ref} role="dialog" aria-label="Reading settings">
      <div className="setting setting-stack">
        <span className="setting-name">Reading mode</span>
        <div className="segmented" role="radiogroup" aria-label="Reading mode">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={settings.mode === m.value}
              onClick={() => onSettings({ ...settings, mode: m.value })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="hint">{MODES.find((m) => m.value === settings.mode)?.hint}</span>
      </div>

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
        <span className="setting-name">Word timing</span>
        <div className="segmented" role="radiogroup" aria-label="Word timing">
          {TIMINGS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={settings.wordTiming === t.value}
              onClick={() => onSettings({ ...settings, wordTiming: t.value })}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="hint">{timingHint}</span>
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
  )
}
