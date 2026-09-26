import { useEffect } from 'react'

export interface SessionOption {
  minutes: number
  /** Where it ends, e.g. "to the end of Chapter 3". */
  lands: string
}

interface Props {
  options: SessionOption[]
  closing?: boolean
  onPick: (minutes: number) => void
  onClose: () => void
}

/** "Read for…": timed sessions, each showing where it will end. */
export function SessionMenu({ options, closing, onPick, onClose }: Props) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <>
      <div className={`popover-backdrop${closing ? ' is-closing' : ''}`} aria-hidden="true" onClick={onClose} />
      <div className={`popover opens-up${closing ? ' is-closing' : ''}`} role="dialog" aria-label="Read for">
        <div className="setting setting-stack">
          <span className="setting-name">Read for</span>
          <span className="hint">Stops at a natural break, never mid-sentence.</span>
        </div>
        <div className="session-options">
          {options.map((o) => (
            <button key={o.minutes} type="button" className="session-option" onClick={() => onPick(o.minutes)}>
              <span className="session-minutes">{o.minutes} min</span>
              <span className="muted">{o.lands}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
