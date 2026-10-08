/**
 * The film as a programme: every chapter's narration laid end to end on one
 * clock, and the scroll progress it stands at each millisecond. Inside a
 * chapter the clock meets progress at the same knots the scroll-driven
 * captions use (`clockKnots`), run the other way, so a playing film and a
 * scrolled one show the same words on the same frame. After a chapter's last
 * word a tail carries the film through the rest frame into the next chapter.
 * Pure: built from the spans and each chapter's cues.
 */
import { clockKnots, cuesDuration, type Cue } from './captions.ts'
import type { ChapterId, SkylineId } from './script.ts'
import { BEAT_STARTS, restProgress, type Span } from './timeline.ts'

export interface ProgrammeBeat {
  readonly id: string
  /** Index of its chapter. */
  readonly chapter: number
  /** Film clock, milliseconds. */
  readonly startMs: number
  readonly endMs: number
}

export interface ProgrammeChapter {
  readonly id: ChapterId
  readonly startMs: number
  /** Where its last word ends. */
  readonly spokenMs: number
  readonly endMs: number
}

/** Film clock (milliseconds) against scroll progress (0 to 1); both rise. */
export type Knot = readonly [ms: number, progress: number]

export interface Programme {
  readonly beats: readonly ProgrammeBeat[]
  readonly chapters: readonly ProgrammeChapter[]
  readonly knots: readonly Knot[]
  readonly durationMs: number
  /** Where playback waits for the reader's guess. */
  readonly guessMs: number | undefined
}

/** From a chapter's last word to the next chapter's first, milliseconds. */
export const TAIL_MS = 1600

/** Longer tails: after the guess the reveal needs time to read. */
const TAILS: Partial<Record<ChapterId, number>> = { 'your-split': 3200 }

/** The chapter whose narration ends by asking for the guess. */
const GUESS_CHAPTER: ChapterId = 'your-split'

/** A beat in progress for less than this restarts the beat before it on a skip back. */
const RESTART_MS = 1500

export function buildProgramme(
  all: readonly Span[],
  cuesFor: (id: ChapterId) => readonly Cue[],
): Programme {
  const knots: Knot[] = []
  const beats: ProgrammeBeat[] = []
  const chapters: ProgrammeChapter[] = []
  const add = (ms: number, progress: number): void => {
    const last = knots.at(-1)
    if (last !== undefined && last[0] === ms && last[1] === progress) return
    knots.push([ms, progress])
  }
  let at = 0
  all.forEach((span, index) => {
    const cues = cuesFor(span.id)
    const toProgress = (local: number): number => span.start + (span.end - span.start) * local
    for (const [local, ms] of clockKnots(span.rest, cues, BEAT_STARTS[span.id])) {
      add(at + ms, toProgress(local))
    }
    for (const cue of cues) {
      beats.push({ id: cue.beat, chapter: index, startMs: at + cue.startMs, endMs: at + cue.endMs })
    }
    const spokenMs = at + cuesDuration(cues)
    const endMs = spokenMs + (TAILS[span.id] ?? TAIL_MS)
    // The last chapter stops on its rest frame, with its card in view.
    add(endMs, index === all.length - 1 ? restProgress(span) : span.end)
    chapters.push({ id: span.id, startMs: at, spokenMs, endMs })
    at = endMs
  })
  return {
    knots,
    beats,
    chapters,
    durationMs: at,
    guessMs: chapters.find((chapter) => chapter.id === GUESS_CHAPTER)?.spokenMs,
  }
}

/** Linear interpolation along knots from column `from` to column `to`, clamped at both ends. */
function along(knots: readonly Knot[], x: number, from: 0 | 1, to: 0 | 1): number {
  const first = knots[0]
  const last = knots.at(-1)
  if (first === undefined || last === undefined) return 0
  if (x <= first[from]) return first[to]
  if (x >= last[from]) return last[to]
  let low = 0
  let high = knots.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if ((knots[middle]?.[from] ?? 0) <= x) low = middle
    else high = middle
  }
  const a = knots[low] ?? first
  const b = knots[high] ?? last
  const span = b[from] - a[from]
  return span === 0 ? b[to] : a[to] + ((x - a[from]) / span) * (b[to] - a[to])
}

/** Scroll progress at a point on the film clock. */
export function progressAt(programme: Programme, ms: number): number {
  return along(programme.knots, ms, 0, 1)
}

/** The point on the film clock that shows this scroll progress. */
export function msAt(programme: Programme, progress: number): number {
  return along(programme.knots, progress, 1, 0)
}

/** Index of the chapter playing at `ms`. */
export function chapterAt(programme: Programme, ms: number): number {
  const index = programme.chapters.findLastIndex((chapter) => chapter.startMs <= ms)
  return Math.max(index, 0)
}

/**
 * Where playback resumes for a scroll position: the start of the beat being
 * read there, so the voice never starts mid-sentence. Between beats and in a
 * chapter's tail, from the position itself.
 */
export function resumeMs(programme: Programme, progress: number): number {
  const ms = msAt(programme, progress)
  const beat = programme.beats.find((b) => b.startMs <= ms && ms < b.endMs)
  return beat?.startMs ?? ms
}

/** The next beat's start after `ms`, or the end of the film. */
export function beatAfter(programme: Programme, ms: number): number {
  return programme.beats.find((beat) => beat.startMs > ms + 1)?.startMs ?? programme.durationMs
}

/** The current beat's start, or the one before it when the current beat has only just begun. */
export function beatBefore(programme: Programme, ms: number): number {
  const index = programme.beats.findLastIndex((beat) => beat.startMs <= ms)
  const current = programme.beats[index]
  if (current === undefined) return 0
  if (ms - current.startMs > RESTART_MS) return current.startMs
  return programme.beats[index - 1]?.startMs ?? 0
}

const SKYLINE_KEY = 'wgw-film-skylines'

/** The skyline order for this browser session: chosen once at random, then kept. */
export function sessionSkylineOrder(): readonly [SkylineId, SkylineId] {
  let flip: boolean
  try {
    const stored = window.sessionStorage.getItem(SKYLINE_KEY)
    flip = stored === null ? Math.random() < 0.5 : stored === 'working-age'
    window.sessionStorage.setItem(SKYLINE_KEY, flip ? 'working-age' : 'pensioner')
  } catch {
    flip = Math.random() < 0.5
  }
  return flip ? ['working-age', 'pensioner'] : ['pensioner', 'working-age']
}
