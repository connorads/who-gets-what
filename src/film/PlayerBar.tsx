/**
 * The film's video controls: play and pause (Resume once the viewer has
 * scrolled, Watch again at the end), a beat back and on, a progress bar with
 * a tick at each chapter, the chapter list, captions, mute, and the way out
 * to the explorer. While the film waits for the guess, Skip guess.
 */
import {
  Captions,
  CaptionsOff,
  ListVideo,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useRef, type CSSProperties } from 'react'
import type { PlayerStatus } from './playback.ts'
import type { PlayerSnapshot } from './player.ts'
import { SCRIPT } from './script.ts'

export interface PlayerActions {
  readonly toggle: () => void
  readonly skip: (direction: -1 | 1) => void
  readonly seek: (ms: number) => void
  readonly chapter: (index: number) => void
  readonly skipGuess: () => void
  readonly captions: () => void
  readonly mute: () => void
}

export interface PlayerBarProps {
  readonly snapshot: PlayerSnapshot
  readonly hidden: boolean
  readonly actions: PlayerActions
}

const STATUS: Readonly<Record<PlayerStatus, string>> = {
  idle: '',
  playing: 'Playing',
  paused: 'Paused',
  guess: 'Paused for your guess',
  manual: 'You are scrolling. Select Resume to play from here.',
  ended: 'The film has ended',
}

const BUTTON: Readonly<Record<PlayerStatus, string>> = {
  idle: 'Play',
  playing: 'Pause',
  paused: 'Play',
  guess: 'Play',
  manual: 'Resume',
  ended: 'Watch again',
}

/** Minutes and seconds, as a video player shows them. */
export function clockTime(ms: number): string {
  const seconds = Math.max(Math.floor(ms / 1000), 0)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const

export function PlayerBar({ snapshot, hidden, actions }: PlayerBarProps) {
  const chapters = useRef<HTMLDetailsElement>(null)
  const { state, ms, programme, chapter, waiting, muted, captions } = snapshot
  const status = state.status
  const duration = programme.durationMs
  const at = Math.min(ms, duration)
  const title = SCRIPT.chapters[chapter]?.title ?? ''
  const MainIcon = status === 'playing' ? Pause : status === 'ended' ? RotateCcw : Play
  const played: CSSProperties & { '--played': string } = {
    '--played': `${duration > 0 ? (at / duration) * 100 : 0}%`,
  }
  return (
    <fieldset className="film-player" hidden={hidden} data-status={status}>
      <legend className="sr-only">Film controls</legend>
      <div className="film-player__caption" aria-hidden="true" />
      <p className="sr-only" aria-live="polite">
        {waiting ? 'Loading' : STATUS[status]}
      </p>
      {status === 'guess' ? (
        <div className="film-player__guess">
          <button type="button" className="film-button" onClick={actions.skipGuess}>
            Skip guess
          </button>
        </div>
      ) : null}
      <div className="film-player__row">
        <button
          type="button"
          className="film-button film-player__play"
          data-waiting={waiting ? 'true' : undefined}
          onClick={actions.toggle}
        >
          <MainIcon {...ICON} />
          {BUTTON[status]}
        </button>
        <button
          type="button"
          className="film-icon"
          aria-label="Back one line"
          title="Back one line"
          onClick={() => actions.skip(-1)}
        >
          <SkipBack {...ICON} />
        </button>
        <button
          type="button"
          className="film-icon"
          aria-label="Forward one line"
          title="Forward one line"
          onClick={() => actions.skip(1)}
        >
          <SkipForward {...ICON} />
        </button>
        <label className="film-player__track" style={played}>
          <span className="sr-only">Position in the film</span>
          <input
            type="range"
            min={0}
            max={duration}
            step={250}
            value={at}
            aria-valuetext={`${clockTime(at)} of ${clockTime(duration)}, ${title}`}
            onChange={(event) => actions.seek(Number(event.currentTarget.value))}
          />
          <span className="film-player__ticks" aria-hidden="true">
            {programme.chapters.slice(1).map((c) => (
              <i key={c.id} style={{ left: `${(c.startMs / duration) * 100}%` }} />
            ))}
          </span>
        </label>
        <span className="film-player__time" aria-hidden="true">
          {clockTime(at)} / {clockTime(duration)}
        </span>
        <details ref={chapters} className="film-player__chapters">
          <summary className="film-icon" title="Chapters">
            <ListVideo {...ICON} />
            <span className="sr-only">Chapters</span>
          </summary>
          <ol data-own-scroll="">
            {SCRIPT.chapters.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={i === chapter ? 'step' : undefined}
                  onClick={() => {
                    actions.chapter(i)
                    chapters.current?.removeAttribute('open')
                  }}
                >
                  <span className="film-number">{String(i + 1).padStart(2, '0')}</span>
                  {c.title}
                </button>
              </li>
            ))}
          </ol>
        </details>
        <button
          type="button"
          className="film-icon"
          aria-label="Captions"
          title="Captions"
          aria-pressed={captions}
          onClick={actions.captions}
        >
          {captions ? <Captions {...ICON} /> : <CaptionsOff {...ICON} />}
        </button>
        <button
          type="button"
          className="film-icon"
          aria-label="Mute"
          title="Mute"
          aria-pressed={muted}
          onClick={actions.mute}
        >
          {muted ? <VolumeX {...ICON} /> : <Volume2 {...ICON} />}
        </button>
        <a className="film-button film-player__explore" href="/explore">
          Explore
        </a>
      </div>
    </fieldset>
  )
}
