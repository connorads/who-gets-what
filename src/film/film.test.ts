import { describe, expect, it } from 'vitest'
import {
  BEAT_GAP_MS,
  captionAt,
  chapterCues,
  cuesDuration,
  estimateMs,
  orderedBeats,
  scrollClockMs,
} from './captions.ts'
import {
  dividers,
  EVEN_GUESS,
  fromDividers,
  guessSentence,
  moveDivider,
  parseStoredGuess,
  serialiseGuess,
  setShare,
} from './guess.ts'
import { lookupPostcode, normalisePostcode, parsePostcodeResponse } from './postcode.ts'
import { chapterOf, SCRIPT, type Beat, type ChapterId } from './script.ts'
import { classify, tierOverride, type DeviceHints } from './tier.ts'
import { BEAT_STARTS, frameAt, locate, phase, restProgress, spans } from './timeline.ts'

const all = spans(SCRIPT)
const context = { skylineOrder: ['pensioner', 'working-age'] } as const

/** The frame at a chapter's local progress. */
function frameIn(id: ChapterId, local: number) {
  const span = all.find((s) => s.id === id)
  if (span === undefined) throw new Error(`No span ${id}`)
  return frameAt(all, span.start + (span.end - span.start) * local, context)
}

describe('timeline', () => {
  it('splits progress between chapters by scroll length, end to end', () => {
    expect(all.map((span) => span.id)).toEqual(SCRIPT.chapters.map((chapter) => chapter.id))
    expect(all[0]?.start).toBe(0)
    expect(all.at(-1)?.end).toBe(1)
    const total = SCRIPT.chapters.reduce((sum, chapter) => sum + chapter.scroll, 0)
    all.forEach((span, i) => {
      expect(span.end - span.start).toBeCloseTo((SCRIPT.chapters[i]?.scroll ?? 0) / total, 9)
    })
    for (let i = 1; i < all.length; i++) expect(all[i]?.start).toBe(all[i - 1]?.end)
  })

  it('locates progress in a chapter, clamping outside 0 to 1', () => {
    const wall = all.find((span) => span.id === 'the-wall')
    expect(wall).toBeDefined()
    const middle = ((wall?.start ?? 0) + (wall?.end ?? 0)) / 2
    expect(locate(all, middle).span.id).toBe('the-wall')
    expect(locate(all, middle).local).toBeCloseTo(0.5, 9)
    expect(locate(all, -1)).toMatchObject({ index: 0, local: 0 })
    expect(locate(all, 2)).toMatchObject({ index: all.length - 1, local: 1 })
  })

  it('maps a phase linearly between its ends', () => {
    expect([phase(0, 0.25, 0.75), phase(0.5, 0.25, 0.75), phase(0.9, 0.25, 0.75)]).toEqual([
      0, 0.5, 1,
    ])
  })

  it('is a pure function of progress, so scrolling back retraces each frame', () => {
    const samples = Array.from({ length: 401 }, (_, i) => i / 400)
    const down = samples.map((p) => frameAt(all, p, context))
    const up = samples.toReversed().map((p) => frameAt(all, p, context))
    expect(up.toReversed()).toEqual(down)
  })

  it('holds still through every rest frame', () => {
    for (const span of all) {
      const at = (local: number) => span.start + (span.end - span.start) * local
      const rest = frameAt(all, at(span.rest + 0.001), context)
      const end = frameAt(all, at(0.999), context)
      expect({ ...end, local: 0 }).toEqual({ ...rest, local: 0 })
    }
  })

  it('pours from the poster into the heap, then sorts it into the wall', () => {
    const pour = all[0]
    expect(pour).toBeDefined()
    const start = frameAt(all, 0, context)
    expect(start.poster).toBe(1)
    expect(start.grains).toMatchObject({ from: 'poster', to: 'heap', t: 0 })
    const settled = frameAt(all, restProgress(pour ?? all[0]!), context)
    expect(settled.poster).toBe(0)
    expect(settled.grains?.t).toBe(1)
    const wall = all.find((span) => span.id === 'the-wall')
    const sorted = frameAt(all, restProgress(wall ?? all[0]!), context)
    expect(sorted.grains).toMatchObject({ from: 'heap', to: 'wall', t: 1, familyTint: 1, pan: 1 })
  })

  it('keeps grains continuous across chapter boundaries', () => {
    for (let i = 1; i < 4; i++) {
      const boundary = all[i]?.start ?? 0
      const before = frameAt(all, boundary - 1e-9, context).grains
      const after = frameAt(all, boundary, context).grains
      const position = (g: typeof before) =>
        g === undefined ? undefined : g.t === 1 ? g.to : g.from
      expect(position(after)).toBe(position(before))
    }
  })

  it('shows the skylines in the session order', () => {
    const skylines = all.find((span) => span.id === 'two-skylines')
    const p = restProgress(skylines ?? all[0]!)
    const reversed = frameAt(all, p, { skylineOrder: ['working-age', 'pensioner'] })
    expect(frameAt(all, p, context).skyline).toMatchObject({ first: 'pensioner', mix: 1 })
    expect(reversed.skyline).toMatchObject({ first: 'working-age', second: 'pensioner' })
  })
})

describe('captions', () => {
  const beats: readonly Beat[] = [
    { id: 'a', narration: '[calm] One two three.' },
    { id: 'b', narration: 'Four five.' },
  ]

  it('lays beats end to end with a gap, timing recorded beats from the manifest', () => {
    const timings = new Map([
      [
        'a',
        {
          durationMs: 1000,
          words: [
            { text: 'One', startMs: 0, endMs: 300 },
            { text: 'two', startMs: 350, endMs: 600 },
            { text: 'three.', startMs: 650, endMs: 1000 },
          ],
        },
      ],
    ])
    const cues = chapterCues(beats, timings)
    expect(cues[0]).toMatchObject({ text: 'One two three.', startMs: 0, endMs: 1000 })
    expect(cues[1]?.startMs).toBe(1000 + BEAT_GAP_MS)
    expect(cues[1]?.endMs).toBe(1000 + BEAT_GAP_MS + estimateMs('Four five.'))
    expect(cuesDuration(cues)).toBe(cues[1]?.endMs)
  })

  it('shows the beat being read and counts the words spoken', () => {
    const cues = chapterCues(beats, new Map())
    expect(captionAt(cues, -1)).toBeUndefined()
    expect(captionAt(cues, 0)).toMatchObject({ cue: { beat: 'a' }, spoken: 1 })
    const second = cues[1]
    expect(second).toBeDefined()
    expect(captionAt(cues, (second?.startMs ?? 0) - 1)?.cue.beat).toBe('a')
    expect(captionAt(cues, second?.endMs ?? 0)).toMatchObject({ cue: { beat: 'b' }, spoken: 2 })
  })

  it('runs the scroll clock over the moving part and finishes before the rest frame', () => {
    const cues = chapterCues(beats, new Map())
    const end = cuesDuration(cues)
    expect(scrollClockMs(0, 0.9, cues)).toBe(0)
    expect(scrollClockMs(0.9 * 0.92, 0.9, cues)).toBeCloseTo(end)
    expect(scrollClockMs(0.95, 0.9, cues)).toBe(end)
  })

  it('starts each cue at its given progress and keeps the clock moving forwards', () => {
    const cues = chapterCues(beats, new Map())
    const starts = [0, 0.6]
    expect(scrollClockMs(0.6, 0.9, cues, starts)).toBeCloseTo(cues[1]?.startMs ?? -1)
    expect(captionAt(cues, scrollClockMs(0.59, 0.9, cues, starts))?.cue.beat).toBe('a')
    expect(scrollClockMs(0.95, 0.9, cues, starts)).toBe(cuesDuration(cues))
    const clocks = Array.from({ length: 101 }, (_, i) => scrollClockMs(i / 100, 0.9, cues, starts))
    expect(clocks.every((ms, i) => i === 0 || ms >= (clocks[i - 1] ?? 0))).toBe(true)
  })

  it('times the beats of every listed chapter inside its moving part, in order', () => {
    for (const [id, starts] of Object.entries(BEAT_STARTS)) {
      const span = all.find((s) => s.id === id)
      const chapter = SCRIPT.chapters.find((c) => c.id === id)
      expect(starts).toHaveLength(chapter?.beats.length ?? -1)
      expect(starts[0]).toBe(0)
      expect(starts.every((at, i) => i === 0 || at > (starts[i - 1] ?? 1))).toBe(true)
      expect(starts.at(-1)).toBeLessThan((span?.rest ?? 0) * 0.92)
    }
  })

  it('puts the narrated swarm and skyline beats on the scenes they describe', () => {
    const swarm = BEAT_STARTS['north-south-or-age'] ?? []
    expect(frameIn('north-south-or-age', swarm[1] ?? 0).areas).toMatchObject({
      to: 'swarm-latitude',
    })
    expect(frameIn('north-south-or-age', swarm[2] ?? 0).areas).toMatchObject({ to: 'swarm-age' })
    const skyline = BEAT_STARTS['two-skylines'] ?? []
    expect(frameIn('two-skylines', skyline[1] ?? 0).skyline?.mix).toBe(0)
    expect(frameIn('two-skylines', skyline[3] ?? 0).skyline?.mix).toBe(1)
  })

  it('plays the skyline beats in the session order', () => {
    const chapter = chapterOf(SCRIPT, 'two-skylines')
    const ids = (order: readonly ['pensioner' | 'working-age', 'pensioner' | 'working-age']) =>
      orderedBeats(chapter.beats, order).map((beat) => beat.id)
    expect(ids(['pensioner', 'working-age'])).toEqual([
      'skyline-1',
      'skyline-pensioner',
      'skyline-working-age',
      'skyline-4',
    ])
    expect(ids(['working-age', 'pensioner'])).toEqual([
      'skyline-1',
      'skyline-working-age',
      'skyline-pensioner',
      'skyline-4',
    ])
  })
})

describe('guess', () => {
  it('keeps shares whole and summing to 100 as one moves', () => {
    expect(setShare([34, 33, 33], 0, 50)).toEqual([50, 25, 25])
    expect(setShare([20, 60, 20], 1, 80)).toEqual([10, 80, 10])
    expect(setShare([50, 50, 0], 0, 120)).toEqual([100, 0, 0])
    expect(setShare([100, 0, 0], 0, 40)).toEqual([40, 30, 30])
    for (let v = 0; v <= 100; v += 7) {
      const shares = setShare(EVEN_GUESS, 2, v)
      expect(shares.reduce((s, x) => s + x, 0)).toBe(100)
      expect(shares[2]).toBe(v)
    }
  })

  it('round-trips divider positions and never lets one pass the other', () => {
    expect(dividers([20, 30, 50])).toEqual([20, 50])
    expect(fromDividers(20, 50)).toEqual([20, 30, 50])
    expect(moveDivider([20, 30, 50], 0, 70)).toEqual([50, 0, 50])
    expect(moveDivider([20, 30, 50], 1, 5)).toEqual([20, 0, 80])
  })

  it('compares without an adjective', () => {
    expect(guessSentence(33, 51.5)).toBe('You guessed 33%. The real figure is 51.5%.')
  })

  it('reads back only a well-formed stored guess', () => {
    const stored = { shares: [40, 20, 40], locked: true } as const
    expect(parseStoredGuess(serialiseGuess(stored))).toEqual(stored)
    expect(parseStoredGuess(null)).toBeUndefined()
    expect(parseStoredGuess('{"shares":[50,50,1]}')).toBeUndefined()
    expect(parseStoredGuess('not json')).toBeUndefined()
  })
})

describe('tier', () => {
  const desktop: DeviceHints = {
    renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)',
    maxTextureSize: 16_384,
    coarsePointer: false,
    deviceMemory: 8,
    cores: 12,
  }

  it('gives a capable desktop GPU £1m grains and everything else £10m', () => {
    expect(classify(desktop)).toBe('full')
    expect(classify({ ...desktop, coarsePointer: true })).toBe('light')
    expect(classify({ ...desktop, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader))' })).toBe(
      'light',
    )
    expect(classify({ ...desktop, renderer: '' })).toBe('light')
    expect(classify({ ...desktop, deviceMemory: 4 })).toBe('light')
    expect(classify({ ...desktop, saveData: true })).toBe('light')
  })

  it('lets a URL parameter pick the tier', () => {
    expect([tierOverride('1m'), tierOverride('10m'), tierOverride('5m')]).toEqual([
      'full',
      'light',
      undefined,
    ])
  })
})

const body = (code: string, country: string) => ({
  result: {
    country,
    parliamentary_constituency_2024: 'Cities of London and Westminster',
    codes: { parliamentary_constituency_2024: code },
  },
})

describe('postcode', () => {
  it('normalises spacing and case and rejects what cannot be a postcode', () => {
    expect(normalisePostcode(' sw1a1aa ')).toBe('SW1A 1AA')
    expect(normalisePostcode('M1 1AE')).toBe('M1 1AE')
    expect(normalisePostcode('12345')).toBeUndefined()
  })

  it('reads the 2024 constituency code and reports Northern Ireland as not covered', () => {
    expect(parsePostcodeResponse('SW1A 1AA', 200, body('E14001172', 'England'))).toEqual({
      kind: 'found',
      postcode: 'SW1A 1AA',
      code: 'E14001172',
      name: 'Cities of London and Westminster',
    })
    expect(parsePostcodeResponse('BT1 1AA', 200, body('N05000003', 'Northern Ireland'))).toEqual({
      kind: 'not-covered',
      postcode: 'BT1 1AA',
      country: 'Northern Ireland',
    })
    expect(parsePostcodeResponse('ZZ1 1ZZ', 404, undefined).kind).toBe('not-found')
    expect(parsePostcodeResponse('SW1A 1AA', 500, undefined).kind).toBe('unavailable')
  })

  it('asks api.postcodes.io once, and reports a failed call as unavailable', async () => {
    const asked: string[] = []
    const ok = await lookupPostcode('sw1a1aa', async (url) => {
      asked.push(url)
      await Promise.resolve()
      return Response.json({ result: { codes: { parliamentary_constituency_2024: 'E14001172' } } })
    })
    expect(asked).toEqual(['https://api.postcodes.io/postcodes/SW1A%201AA'])
    expect(ok.kind).toBe('found')
    const failed = await lookupPostcode('SW1A 1AA', () => Promise.reject(new Error('offline')))
    expect(failed.kind).toBe('unavailable')
    expect((await lookupPostcode('nope', () => Promise.reject(new Error('unused')))).kind).toBe(
      'invalid',
    )
  })
})
