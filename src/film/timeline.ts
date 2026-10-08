/**
 * The film as pure functions of one number. Scroll maps to `progress`, from 0
 * at the first frame to 1 at the last; each chapter owns a span of it sized by
 * its scroll length, and `frameAt` turns progress into everything the canvas
 * draws. Nothing here keeps state, so a frame is the same whether the reader
 * scrolls down to it or back up to it, and `?frame=` can pin any one.
 */
import type { SceneId } from './grains/scenes.ts'
import type { ChapterId, Script, SkylineId } from './script.ts'

export interface Span {
  readonly id: ChapterId
  readonly start: number
  readonly end: number
  /** Local progress where the chapter's rest frame begins: its last 0.3 viewport heights hold still. */
  readonly rest: number
}

/** Viewport heights of still scroll that end every chapter. */
export const REST_HEIGHTS = 0.3

export function spans(script: Script): readonly Span[] {
  const total = script.chapters.reduce((sum, chapter) => sum + chapter.scroll, 0)
  let at = 0
  return script.chapters.map((chapter) => {
    const start = at / total
    at += chapter.scroll
    return {
      id: chapter.id,
      start,
      end: at / total,
      rest: Math.max(0, (chapter.scroll - REST_HEIGHTS) / chapter.scroll),
    }
  })
}

export interface Located {
  readonly index: number
  readonly span: Span
  /** 0 to 1 through the chapter. */
  readonly local: number
}

export function locate(all: readonly Span[], progress: number): Located {
  const p = Math.min(Math.max(progress, 0), 1)
  let index = all.findIndex((span) => p < span.end)
  if (index < 0) index = all.length - 1
  const span = all[index]
  if (span === undefined) throw new Error('A film needs at least one chapter')
  return { index, span, local: (p - span.start) / (span.end - span.start || 1) }
}

/** Progress at which a chapter's rest frame begins: where a hash link or the stepper lands. */
export function restProgress(span: Span): number {
  return span.start + (span.end - span.start) * span.rest
}

/** 0 before `a`, 1 after `b`, linear between. */
export function phase(t: number, a: number, b: number): number {
  if (t <= a) return 0
  if (t >= b) return 1
  return (t - a) / (b - a)
}

export type AreaLayoutId = 'shape' | 'swarm-latitude' | 'swarm-age'

/** A grain scene, or `land`: the reader's shape, the real map or equal-size areas. */
export type GrainTarget = SceneId | 'land'

export interface GrainFrame {
  readonly from: GrainTarget
  readonly to: GrainTarget
  /** 0 to 1 through the move; each grain starts after a delay set by its key. */
  readonly t: number
  /** Share of the move spent staggering starts. */
  readonly stagger: number
  /** Peak height of each grain's arc, as a share of the stage height. */
  readonly arc: number
  /** Accelerate like a fall rather than ease in and out. */
  readonly fall: boolean
  readonly opacity: number
  /** Colour by the reader's guess (0 to 1). */
  readonly guessTint: number
  /** Colour by benefit family (0 to 1); otherwise brass. */
  readonly familyTint: number
  /** 0 with the wall's start in view, 1 with its end in view. */
  readonly pan: number
}

export interface AreaFrame {
  readonly from: AreaLayoutId
  readonly to: AreaLayoutId
  readonly t: number
  readonly opacity: number
}

export interface SkylineFrame {
  readonly first: SkylineId
  readonly second: SkylineId
  /** 0 shows the first skyline, 1 the second; a wipe runs west to east between. */
  readonly mix: number
  readonly elevation: number
  /** 0 flat to 1 fully tilted. */
  readonly tilt: number
}

export interface FilmFrame {
  readonly chapter: ChapterId
  readonly local: number
  /** Opacity of the server-rendered poster figure. */
  readonly poster: number
  readonly grains: GrainFrame | undefined
  readonly areas: AreaFrame | undefined
  readonly skyline: SkylineFrame | undefined
}

export interface FrameContext {
  readonly skylineOrder: readonly [SkylineId, SkylineId]
}

const GRAINS_AT_REST: GrainFrame = {
  from: 'heap',
  to: 'heap',
  t: 1,
  stagger: 0,
  arc: 0,
  fall: false,
  opacity: 1,
  guessTint: 0,
  familyTint: 0,
  pan: 0,
}

const SHAPE: AreaFrame = { from: 'shape', to: 'shape', t: 1, opacity: 1 }

type Scene = (l: number, context: FrameContext) => Omit<FilmFrame, 'chapter' | 'local'>

const NONE = { poster: 0, grains: undefined, areas: undefined, skyline: undefined } as const

/** Each chapter's scene: local progress (0 to 1) to what the canvas draws. */
const SCENES: Readonly<Record<ChapterId, Scene>> = {
  'the-pour': (l) => ({
    ...NONE,
    poster: 1 - phase(l, 0.02, 0.22),
    grains: {
      ...GRAINS_AT_REST,
      from: 'poster',
      to: 'heap',
      t: phase(l, 0.04, 0.72),
      stagger: 0.55,
      fall: true,
    },
  }),
  'your-split': (l) => ({
    ...NONE,
    grains: { ...GRAINS_AT_REST, guessTint: phase(l, 0.05, 0.2) },
  }),
  'the-wall': (l) => ({
    ...NONE,
    grains: {
      ...GRAINS_AT_REST,
      to: 'wall',
      t: phase(l, 0, 0.3),
      stagger: 0.6,
      arc: 0.08,
      guessTint: 1 - phase(l, 0, 0.18),
      familyTint: phase(l, 0.05, 0.3),
      pan: phase(l, 0.34, 0.92),
    },
  }),
  'the-rain': (l) => ({
    ...NONE,
    grains: {
      ...GRAINS_AT_REST,
      from: 'wall',
      to: 'land',
      t: phase(l, 0.02, 0.5),
      stagger: 0.7,
      arc: 0.35,
      familyTint: 1,
      pan: 1,
      opacity: 1 - phase(l, 0.5, 0.62),
    },
    areas: { ...SHAPE, opacity: phase(l, 0.42, 0.56) },
  }),
  'two-skylines': (l, { skylineOrder: [first, second] }) => ({
    ...NONE,
    areas: SHAPE,
    skyline: {
      first,
      second,
      mix: phase(l, 0.42, 0.66),
      elevation: phase(l, 0.08, 0.3),
      tilt: phase(l, 0, 0.18),
    },
  }),
  'north-south-or-age': (l, { skylineOrder: [first, second] }) => {
    // The skylines fall within the first words, so the 3D map leaves as the narration moves on.
    const flatten = 1 - phase(l, 0, 0.04)
    return {
      ...NONE,
      areas:
        l < 0.46
          ? { from: 'shape', to: 'swarm-latitude', t: phase(l, 0.14, 0.36), opacity: 1 }
          : { from: 'swarm-latitude', to: 'swarm-age', t: phase(l, 0.56, 0.78), opacity: 1 },
      skyline:
        flatten > 0 ? { first, second, mix: 1, elevation: flatten, tilt: flatten } : undefined,
    }
  },
  'the-landing': (l) => ({
    ...NONE,
    areas: { from: 'swarm-age', to: 'shape', t: phase(l, 0, 0.4), opacity: 1 },
  }),
}

/**
 * Local progress at which each beat's caption starts when scroll drives the
 * captions, in playing order, so the words arrive with the scene they
 * describe. Chapters not listed spread their beats evenly.
 */
export const BEAT_STARTS: Partial<Record<ChapterId, readonly number[]>> = {
  // Stacking, then State Pension, then the disability and Universal Credit blocks, then the whole.
  'the-wall': [0, 0.32, 0.62, 0.84],
  // The fall, the hexagons settling, the shape switch.
  'the-rain': [0, 0.45, 0.66],
  // The tilt, the first skyline rising, the wipe to the second, the comparison.
  'two-skylines': [0, 0.12, 0.44, 0.68],
  // Dots on the map, the latitude swarm, the age swarm, the reason.
  'north-south-or-age': [0, 0.34, 0.56, 0.8],
}

export function frameAt(all: readonly Span[], progress: number, context: FrameContext): FilmFrame {
  const { span, local } = locate(all, progress)
  return { chapter: span.id, local, ...SCENES[span.id](local, context) }
}
