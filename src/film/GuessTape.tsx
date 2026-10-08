/**
 * Guess first: a tape cut into three shares. Each share has its own native
 * range input, so keyboards and screen readers get a slider per group;
 * pointer readers can also drag the two cuts on the tape. Moving one share
 * rebalances the other two. Locking freezes the guess, which then appears as
 * a ghost beside the real split. The guess never leaves the reader's device.
 */
import { useRef, type PointerEvent } from 'react'
import type { FilmFacts } from './facts.ts'
import { dividers, guessSentence, moveDivider, setShare, type Shares } from './guess.ts'

export interface GuessTapeProps {
  readonly facts: FilmFacts
  readonly shares: Shares
  readonly locked: boolean
  readonly onChange: (shares: Shares) => void
  readonly onLock: () => void
  readonly onReset: () => void
}

export function GuessTape({ facts, shares, locked, onChange, onLock, onReset }: GuessTapeProps) {
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef<0 | 1 | undefined>(undefined)

  const positionOf = (clientX: number): number => {
    const box = track.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0) return 0
    return ((clientX - box.left) / box.width) * 100
  }

  const onDown = (which: 0 | 1) => (event: PointerEvent<HTMLDivElement>) => {
    if (locked) return
    dragging.current = which
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const which = dragging.current
    if (which === undefined || locked) return
    onChange(moveDivider(shares, which, positionOf(event.clientX)))
  }

  const onUp = () => {
    dragging.current = undefined
  }

  const [first, second] = dividers(shares)
  return (
    <div className="film-tape" data-locked={locked ? 'true' : 'false'}>
      <div
        ref={track}
        className="film-tape__track"
        aria-hidden="true"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {facts.groups.map((group, i) => (
          <div
            key={group.id}
            className={`film-tape__segment film-tape__segment--${i}`}
            style={{ width: `${shares[i] ?? 0}%` }}
          >
            {(shares[i] ?? 0) >= 8 ? `${shares[i] ?? 0}%` : ''}
          </div>
        ))}
        {([0, 1] as const).map((which) => (
          <div
            key={which}
            className="film-tape__divider"
            style={{ left: `${which === 0 ? first : second}%` }}
            onPointerDown={onDown(which)}
          />
        ))}
      </div>
      <fieldset className="film-tape__handles" disabled={locked}>
        <legend className="sr-only">Your guess at the split, in per cent</legend>
        {facts.groups.map((group, i) => {
          const index = i === 0 ? 0 : i === 1 ? 1 : 2
          return (
            <label key={group.id} className="film-tape__handle">
              <span>{group.label}</span>
              <strong aria-hidden="true">{shares[index]}%</strong>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={shares[index]}
                aria-valuetext={`${shares[index]}%`}
                onChange={(event) => onChange(setShare(shares, index, Number(event.target.value)))}
              />
            </label>
          )
        })}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        {locked ? (
          <button type="button" className="film-button" onClick={onReset}>
            Change my guess
          </button>
        ) : (
          <button type="button" className="film-button" onClick={onLock}>
            Lock in my guess
          </button>
        )}
        <span className="film-note">Your guess stays on this device.</span>
      </div>
      {locked ? <GuessReveal facts={facts} shares={shares} /> : null}
    </div>
  )
}

export function GuessReveal({ facts, shares }: { facts: FilmFacts; shares: Shares }) {
  return (
    <ul className="film-reveal" aria-live="polite">
      {facts.groups.map((group, i) => (
        <li key={group.id}>
          {group.label}. {guessSentence(shares[i] ?? 0, group.share * 100)}
        </li>
      ))}
    </ul>
  )
}
