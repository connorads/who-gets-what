import { describe, expect, it } from 'vitest'
import { chapterCues, orderedBeats, scrollClockMs } from './captions.ts'
import { IDLE, reduce, toggleEvent, type PlayerEvent, type PlayerState } from './playback.ts'
import {
  beatAfter,
  beatBefore,
  buildProgramme,
  chapterAt,
  msAt,
  progressAt,
  resumeMs,
  type Programme,
} from './programme.ts'
import { chapterOf, SCRIPT, type ChapterId } from './script.ts'
import { BEAT_STARTS, frameAt, locate, restProgress, spans } from './timeline.ts'

const all = spans(SCRIPT)
const order = ['pensioner', 'working-age'] as const
/** Unrecorded timings: every beat at the estimated reading pace. */
const cuesFor = (id: ChapterId) =>
  chapterCues(orderedBeats(chapterOf(SCRIPT, id).beats, order), new Map())
const programme = buildProgramme(all, cuesFor)

const chapter = (id: ChapterId) => {
  const found = programme.chapters.find((c) => c.id === id)
  if (found === undefined) throw new Error(`No chapter ${id}`)
  return found
}

/** The film frame at a point on the programme's clock. */
const frame = (ms: number) => frameAt(all, progressAt(programme, ms), { skylineOrder: order })

/** Run events through the reducer from a state. */
const run = (state: PlayerState, ...events: PlayerEvent[]): PlayerState =>
  events.reduce((s, event) => reduce(programme, s, event), state)

describe('programme', () => {
  it('lays every beat end to end, chapter by chapter, from 0 to the end', () => {
    const beats = SCRIPT.chapters.flatMap((c) => c.beats.map((beat) => beat.id))
    expect(programme.beats.map((beat) => beat.id).toSorted()).toEqual(beats.toSorted())
    expect(programme.chapters[0]?.startMs).toBe(0)
    for (let i = 1; i < programme.chapters.length; i++) {
      expect(programme.chapters[i]?.startMs).toBe(programme.chapters[i - 1]?.endMs)
    }
    expect(programme.chapters.at(-1)?.endMs).toBe(programme.durationMs)
    for (const beat of programme.beats) {
      const own = programme.chapters[beat.chapter]
      expect(beat.startMs).toBeGreaterThanOrEqual(own?.startMs ?? Infinity)
      expect(beat.endMs).toBeLessThanOrEqual(own?.spokenMs ?? -Infinity)
    }
  })

  it('moves forward through the film as the clock runs, never back', () => {
    for (let i = 1; i < programme.knots.length; i++) {
      const [ms, progress] = programme.knots[i] ?? [0, 0]
      const [prevMs, prevProgress] = programme.knots[i - 1] ?? [0, 0]
      expect(ms).toBeGreaterThan(prevMs)
      expect(progress).toBeGreaterThan(prevProgress)
    }
    expect(programme.knots[0]).toEqual([0, 0])
    const last = all.at(-1)
    expect(progressAt(programme, programme.durationMs)).toBe(last ? restProgress(last) : NaN)
  })

  it('maps clock to progress and back', () => {
    for (let ms = 0; ms <= programme.durationMs; ms += 997) {
      expect(msAt(programme, progressAt(programme, ms))).toBeCloseTo(ms, 6)
    }
    expect(progressAt(programme, -50)).toBe(0)
    expect(msAt(programme, 1)).toBe(programme.durationMs)
  })

  it('shows each beat on the frame where scroll would caption it', () => {
    for (const beat of programme.beats) {
      const own = programme.chapters[beat.chapter]
      if (own === undefined) throw new Error('beat outside the film')
      const at = beat.startMs + 200
      const { span, local } = locate(all, progressAt(programme, at))
      expect(span.id).toBe(own.id)
      const scrolled = scrollClockMs(local, span.rest, cuesFor(span.id), BEAT_STARTS[span.id])
      expect(scrolled).toBeCloseTo(at - own.startMs, 3)
    }
  })

  it("finishes each chapter's words before its rest frame", () => {
    for (const [i, own] of programme.chapters.entries()) {
      const span = all[i]
      if (span === undefined) throw new Error('chapter without a span')
      expect(progressAt(programme, own.spokenMs)).toBeLessThan(restProgress(span))
      expect(chapterAt(programme, own.startMs)).toBe(i)
      expect(chapterAt(programme, own.endMs - 1)).toBe(i)
    }
  })

  it('flattens the skylines within a second of the next chapter starting', () => {
    const next = chapter('north-south-or-age')
    expect(frame(next.startMs - 1).skyline?.elevation).toBe(1)
    expect(frame(next.startMs + 1000).skyline).toBeUndefined()
  })

  it("waits for the guess where the split chapter's words end", () => {
    expect(programme.guessMs).toBe(chapter('your-split').spokenMs)
    const asking = programme.beats.findLast((beat) => (beat.endMs ?? 0) <= (programme.guessMs ?? 0))
    expect(asking?.id).toBe('split-4')
  })

  it('resumes at the start of the beat on screen, or from a pause between beats', () => {
    const beat = programme.beats[4]
    if (beat === undefined) throw new Error('too few beats')
    const middle = progressAt(programme, (beat.startMs + beat.endMs) / 2)
    expect(resumeMs(programme, middle)).toBeCloseTo(beat.startMs, 6)
    const tail = chapter('the-wall').spokenMs + 500
    expect(resumeMs(programme, progressAt(programme, tail))).toBeCloseTo(tail, 6)
  })

  it('skips to the next beat, or back to this one or the one before', () => {
    const [first, second, third] = programme.beats
    if (first === undefined || second === undefined || third === undefined) throw new Error()
    expect(beatAfter(programme, first.startMs)).toBe(second.startMs)
    expect(beatAfter(programme, programme.durationMs)).toBe(programme.durationMs)
    expect(beatBefore(programme, third.startMs + 3000)).toBe(third.startMs)
    expect(beatBefore(programme, third.startMs + 200)).toBe(second.startMs)
    expect(beatBefore(programme, 100)).toBe(0)
  })
})

describe('player states', () => {
  const guessMs = programme.guessMs ?? NaN

  it('plays from the poster, pauses and plays on from the same point', () => {
    expect(run(IDLE, { type: 'play' })).toEqual({ status: 'playing', from: 0 })
    expect(run(IDLE, { type: 'play' }, { type: 'pause', at: 4200 })).toEqual({
      status: 'paused',
      at: 4200,
    })
    expect(run({ status: 'paused', at: 4200 }, { type: 'play' })).toEqual({
      status: 'playing',
      from: 4200,
    })
  })

  it('keeps the same state on a tick that changes nothing', () => {
    const playing: PlayerState = { status: 'playing', from: 0 }
    expect(run(playing, { type: 'tick', at: 1000, locked: false })).toBe(playing)
    expect(run(IDLE, { type: 'tick', at: 1000, locked: false })).toBe(IDLE)
  })

  it('waits at the guess until it is locked or skipped, then plays on from there', () => {
    const playing: PlayerState = { status: 'playing', from: 0 }
    const waiting = run(playing, { type: 'tick', at: guessMs + 40, locked: false })
    expect(waiting).toEqual({ status: 'guess', at: guessMs })
    expect(run(waiting, { type: 'tick', at: guessMs + 900, locked: false })).toBe(waiting)
    expect(run(waiting, { type: 'pause', at: guessMs })).toBe(waiting)
    expect(run(waiting, { type: 'guessed' })).toEqual({ status: 'playing', from: guessMs })
    expect(run(waiting, { type: 'play' })).toEqual({ status: 'playing', from: guessMs })
  })

  it('plays through the guess point when the guess is already locked, or once past it', () => {
    const playing: PlayerState = { status: 'playing', from: 0 }
    expect(run(playing, { type: 'tick', at: guessMs + 40, locked: true })).toBe(playing)
    const after: PlayerState = { status: 'playing', from: guessMs }
    expect(run(after, { type: 'tick', at: guessMs + 40, locked: false })).toBe(after)
    expect(
      run(
        { status: 'guess', at: guessMs },
        { type: 'guessed' },
        { type: 'tick', at: guessMs + 5, locked: false },
      ),
    ).toEqual({ status: 'playing', from: guessMs })
  })

  it('ends at the end of the film, and plays again from the start', () => {
    const playing: PlayerState = { status: 'playing', from: guessMs }
    const ended = run(playing, { type: 'tick', at: programme.durationMs, locked: true })
    expect(ended).toEqual({ status: 'ended' })
    expect(run(ended, { type: 'play' })).toEqual({ status: 'playing', from: 0 })
  })

  it('hands over to the reader on any scroll, from every state', () => {
    const states: PlayerState[] = [
      IDLE,
      { status: 'playing', from: 0 },
      { status: 'paused', at: 10 },
      { status: 'guess', at: guessMs },
      { status: 'ended' },
    ]
    for (const state of states) expect(run(state, { type: 'scroll' })).toEqual({ status: 'manual' })
    const manual: PlayerState = { status: 'manual' }
    expect(run(manual, { type: 'scroll' })).toBe(manual)
    expect(run(manual, { type: 'play' })).toBe(manual)
    expect(run(manual, { type: 'tick', at: 5000, locked: false })).toBe(manual)
  })

  it("resumes from the beat at the reader's scroll position", () => {
    const beat = programme.beats.find((b) => b.id === 'wall-3')
    if (beat === undefined) throw new Error('no wall-3')
    const progress = progressAt(programme, beat.startMs + (beat.endMs - beat.startMs) * 0.6)
    const resumed = run({ status: 'manual' }, { type: 'resume', progress })
    expect(resumed.status).toBe('playing')
    expect(resumed.status === 'playing' ? resumed.from : NaN).toBeCloseTo(beat.startMs, 6)
    expect(run({ status: 'paused', at: 3 }, { type: 'resume', progress })).toEqual({
      status: 'paused',
      at: 3,
    })
  })

  it('does not wait for the guess again after resuming past it', () => {
    const progress = progressAt(programme, chapter('the-wall').startMs + 2000)
    const resumed = run({ status: 'manual' }, { type: 'resume', progress })
    expect(
      run(resumed, { type: 'tick', at: chapter('the-wall').startMs + 2100, locked: false }),
    ).toBe(resumed)
  })

  it('waits for the guess after resuming before it, unless it is locked', () => {
    const progress = progressAt(programme, chapter('your-split').startMs + 100)
    const resumed = run({ status: 'manual' }, { type: 'resume', progress })
    expect(run(resumed, { type: 'tick', at: guessMs, locked: false })).toEqual({
      status: 'guess',
      at: guessMs,
    })
  })

  it('seeks within a run, or to a paused point, clamped to the film', () => {
    const playing: PlayerState = { status: 'playing', from: 0 }
    const sought = run(playing, { type: 'seek', at: 9000 })
    expect(sought).toEqual({ status: 'playing', from: 9000 })
    expect(run(sought, { type: 'seek', at: 9000 })).not.toBe(sought)
    expect(run(IDLE, { type: 'seek', at: 9000 })).toEqual({ status: 'paused', at: 9000 })
    expect(run({ status: 'manual' }, { type: 'seek', at: -5 })).toEqual({ status: 'paused', at: 0 })
    expect(run({ status: 'ended' }, { type: 'seek', at: 1e9 })).toEqual({
      status: 'paused',
      at: programme.durationMs,
    })
  })

  it('maps the play button to pause, resume or play', () => {
    expect(toggleEvent({ status: 'playing', from: 0 }, 300, 0.1)).toEqual({
      type: 'pause',
      at: 300,
    })
    expect(toggleEvent({ status: 'manual' }, 300, 0.1)).toEqual({ type: 'resume', progress: 0.1 })
    expect(toggleEvent(IDLE, 0, 0)).toEqual({ type: 'play' })
    expect(toggleEvent({ status: 'guess', at: guessMs }, 0, 0)).toEqual({ type: 'play' })
  })
})

describe('a programme of recorded lengths', () => {
  it('times beats by their recordings', () => {
    const timings = new Map([['pour-1', { durationMs: 9000 }]])
    const recorded: Programme = buildProgramme(all, (id) =>
      chapterCues(orderedBeats(chapterOf(SCRIPT, id).beats, order), timings),
    )
    const first = recorded.beats[0]
    expect(first).toMatchObject({ id: 'pour-1', startMs: 0, endMs: 9000 })
  })
})
