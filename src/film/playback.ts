/**
 * The film player's states and what moves it between them, as a pure
 * reducer. The narration clock drives a playing film; the reader's own
 * scroll takes over from it; Resume picks the clock up again at the beat on
 * screen. Times are on the programme's film clock, in milliseconds.
 *
 *   idle --play--> playing --pause--> paused --play--> playing
 *   playing --tick past the guess, unlocked--> guess --guessed--> playing
 *   playing --tick past the end--> ended --play--> playing from 0
 *   any but manual --scroll--> manual --resume--> playing at the beat on screen
 */
import { resumeMs, type Programme } from './programme.ts'

export type PlayerState =
  | { readonly status: 'idle' }
  /** A run of playback that began at `from`; a new run is a new object. */
  | { readonly status: 'playing'; readonly from: number }
  | { readonly status: 'paused'; readonly at: number }
  /** Waiting at `at` for the reader to lock a guess or skip it. */
  | { readonly status: 'guess'; readonly at: number }
  /** The reader is scrolling; the clock has let go. */
  | { readonly status: 'manual' }
  | { readonly status: 'ended' }

export type PlayerStatus = PlayerState['status']

export type PlayerEvent =
  | { readonly type: 'play' }
  | { readonly type: 'pause'; readonly at: number }
  /** The clock reached `at`. */
  | { readonly type: 'tick'; readonly at: number; readonly locked: boolean }
  /** The reader scrolled: wheel, touch, keys or the scrollbar. */
  | { readonly type: 'scroll' }
  /** Play again from the reader's scroll position. */
  | { readonly type: 'resume'; readonly progress: number }
  | { readonly type: 'seek'; readonly at: number }
  /** The guess was locked or skipped. */
  | { readonly type: 'guessed' }

export const IDLE: PlayerState = { status: 'idle' }

const clamp = (ms: number, programme: Programme): number =>
  Math.min(Math.max(ms, 0), programme.durationMs)

export function reduce(programme: Programme, state: PlayerState, event: PlayerEvent): PlayerState {
  if (event.type === 'play') {
    if (state.status === 'idle' || state.status === 'ended') return { status: 'playing', from: 0 }
    if (state.status === 'paused' || state.status === 'guess') {
      return { status: 'playing', from: state.at }
    }
    return state
  }
  if (event.type === 'pause') {
    return state.status === 'playing' ? { status: 'paused', at: clamp(event.at, programme) } : state
  }
  if (event.type === 'tick') {
    if (state.status !== 'playing') return state
    const guess = programme.guessMs
    if (guess !== undefined && state.from < guess && event.at >= guess && !event.locked) {
      return { status: 'guess', at: guess }
    }
    return event.at >= programme.durationMs ? { status: 'ended' } : state
  }
  if (event.type === 'scroll') return state.status === 'manual' ? state : { status: 'manual' }
  if (event.type === 'resume') {
    return state.status === 'manual'
      ? { status: 'playing', from: clamp(resumeMs(programme, event.progress), programme) }
      : state
  }
  if (event.type === 'seek') {
    const at = clamp(event.at, programme)
    return state.status === 'playing' ? { status: 'playing', from: at } : { status: 'paused', at }
  }
  return state.status === 'guess' ? { status: 'playing', from: state.at } : state
}

/** What the play button and the space bar do from this state. */
export function toggleEvent(state: PlayerState, at: number, progress: number): PlayerEvent {
  if (state.status === 'playing') return { type: 'pause', at }
  if (state.status === 'manual') return { type: 'resume', progress }
  return { type: 'play' }
}
