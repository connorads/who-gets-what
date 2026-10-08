/**
 * Captions for a chapter: its beats laid end to end on one clock. With sound
 * on, the clock is the narration's playback time and words light up as the
 * aligned audio reaches them. With sound off, scroll drives the same clock,
 * so captions advance with the picture and run backwards on the way up.
 */
import { phase } from './timeline.ts'
import { spoken, type Beat, type SkylineId } from './script.ts'

export interface CueWord {
  readonly text: string
  readonly startMs: number
  readonly endMs: number
}

export interface Cue {
  readonly beat: string
  readonly text: string
  /** Chapter clock, milliseconds. */
  readonly startMs: number
  readonly endMs: number
  readonly words: readonly CueWord[]
}

/** A recorded beat: its length and, when aligned, each word's time from the beat's start. */
export interface BeatTiming {
  readonly durationMs: number
  readonly words?: readonly CueWord[]
}

/** Silence between beats, milliseconds. */
export const BEAT_GAP_MS = 350

/** A reading pace for beats with no recording: about 160 words a minute. */
export function estimateMs(text: string): number {
  return Math.round(text.split(/\s+/).filter(Boolean).length * 375 + 300)
}

/** Even word timings across an estimated beat, so unrecorded captions still step word by word. */
function estimatedWords(text: string, durationMs: number): readonly CueWord[] {
  const words = text.split(/\s+/).filter(Boolean)
  const each = durationMs / Math.max(words.length, 1)
  return words.map((word, i) => ({
    text: word,
    startMs: Math.round(i * each),
    endMs: Math.round((i + 1) * each),
  }))
}

/** A chapter's beats in playing order: the two skyline beats follow the session's order. */
export function orderedBeats(
  beats: readonly Beat[],
  skylineOrder: readonly [SkylineId, SkylineId],
): readonly Beat[] {
  const slots = beats.flatMap((beat, i) => (beat.skyline === undefined ? [] : [i]))
  if (slots.length !== 2) return beats
  const bySkyline = new Map(beats.flatMap((beat) => (beat.skyline ? [[beat.skyline, beat]] : [])))
  const out = [...beats]
  skylineOrder.forEach((skyline, k) => {
    const slot = slots[k]
    const beat = bySkyline.get(skyline)
    if (slot !== undefined && beat !== undefined) out[slot] = beat
  })
  return out
}

export function chapterCues(
  beats: readonly Beat[],
  timings: ReadonlyMap<string, BeatTiming>,
): readonly Cue[] {
  let at = 0
  return beats.map((beat) => {
    const text = spoken(beat.narration)
    const timing = timings.get(beat.id)
    const durationMs = timing?.durationMs ?? estimateMs(text)
    const words = timing?.words ?? estimatedWords(text, durationMs)
    const cue: Cue = {
      beat: beat.id,
      text,
      startMs: at,
      endMs: at + durationMs,
      words: words.map((word) => ({
        text: word.text,
        startMs: at + word.startMs,
        endMs: at + word.endMs,
      })),
    }
    at += durationMs + BEAT_GAP_MS
    return cue
  })
}

export function cuesDuration(cues: readonly Cue[]): number {
  return cues.at(-1)?.endMs ?? 0
}

export interface CaptionState {
  readonly cue: Cue
  /** Words spoken so far, 0 to `cue.words.length`. */
  readonly spoken: number
}

/** The caption on screen at `ms`: the beat being read, or the last one read during a gap. */
export function captionAt(cues: readonly Cue[], ms: number): CaptionState | undefined {
  if (cues.length === 0 || ms < 0) return undefined
  let cue = cues[0]
  for (const candidate of cues) if (candidate.startMs <= ms) cue = candidate
  if (cue === undefined) return undefined
  const spokenWords = cue.words.filter((word) => word.startMs <= ms).length
  return { cue, spoken: spokenWords }
}

/** A point where a chapter's local progress (0 to 1) meets its caption clock, milliseconds. */
export type ClockKnot = readonly [local: number, ms: number]

/**
 * Where a chapter's caption clock meets its scroll: narration runs over the
 * moving part of the chapter and has finished by its rest frame. `starts`
 * gives the local progress at which each cue begins, so a beat appears with
 * the picture it describes; without it the cues spread evenly. The clock is
 * linear between knots. The playing film runs the same knots the other way.
 */
export function clockKnots(
  rest: number,
  cues: readonly Cue[],
  starts?: readonly number[],
): readonly ClockKnot[] {
  const end = Math.max(rest * 0.92, 0.05)
  const durationMs = cuesDuration(cues)
  if (starts === undefined || starts.length !== cues.length) {
    return [
      [0, 0],
      [end, durationMs],
    ]
  }
  return [...cues.map((cue, i): ClockKnot => [starts[i] ?? 0, cue.startMs]), [end, durationMs]]
}

/** The chapter clock when scroll drives captions. */
export function scrollClockMs(
  local: number,
  rest: number,
  cues: readonly Cue[],
  starts?: readonly number[],
): number {
  const knots = clockKnots(rest, cues, starts)
  let ms = 0
  for (const [i, [at, clock]] of knots.entries()) {
    const [nextAt, nextClock] = knots[i + 1] ?? [at, clock]
    if (local < at) break
    ms = clock + phase(local, at, nextAt) * (nextClock - clock)
  }
  return ms
}

/** Draw one caption line into `host`, the words spoken so far marked; nothing for no caption. */
export function drawCaption(host: HTMLElement, state: CaptionState | undefined): void {
  if (state === undefined) {
    host.replaceChildren()
    return
  }
  const line = document.createElement('p')
  state.cue.words.forEach((word, i) => {
    const span = document.createElement('span')
    span.className = 'word'
    if (i < state.spoken) span.dataset['spoken'] = ''
    span.textContent = word.text
    line.appendChild(span)
    if (i < state.cue.words.length - 1) line.appendChild(document.createTextNode(' '))
  })
  host.replaceChildren(line)
}
