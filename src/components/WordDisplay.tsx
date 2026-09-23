import { splitAtOrp } from '../lib/rsvp'

interface Props {
  word: string
  fontSize: number
  onClick?: () => void
}

/**
 * Shows one word with its Optimal Recognition Point pinned to the centre, so
 * the eye never has to move between words. Small notches above and below
 * mark where to look.
 */
export function WordDisplay({ word, fontSize, onClick }: Props) {
  const [before, pivot, after] = splitAtOrp(word)
  return (
    <div className="word-frame" style={{ fontSize }} onClick={onClick}>
      <div className="reticle" aria-hidden="true" />
      <div className="word">
        <span className="word-before">{before}</span>
        <span className="word-pivot">{pivot}</span>
        <span className="word-after">{after}</span>
      </div>
      <div className="reticle" aria-hidden="true" />
    </div>
  )
}
