/**
 * Where each scene sits on the stage, and the one function that turns a film
 * frame into what the canvas draws. Scene buffers are in unit frames; these
 * rectangles place them in pixels for the current stage size, so a resize
 * moves the frames and never rebuilds a buffer (the poster aside, which is
 * sampled from the figure as drawn).
 */
import type { Camera, Rect, Size } from '#/viz/layout/projection.ts'
import type { CameraPose, FilmDraw, SkylineDraw } from '#/viz/engine/film-engine.ts'
import type { PixelFrame } from '#/viz/engine/grain-layer.ts'
import { dividers, type Shares } from './guess.ts'
import type { SkylineId } from './script.ts'
import type { FilmFrame, GrainFrame, GrainTarget, SkylineFrame } from './timeline.ts'
import type { SceneId } from './grains/scenes.ts'

const frameOf = (rect: Rect): PixelFrame => [rect.x, rect.y, rect.width, rect.height]

/** The heap: a wide mound resting a little above the bottom of the stage. */
export function heapRect(size: Size): Rect {
  const width = Math.min(size.width * 0.86, size.height * 1.7)
  const height = Math.min(width * 0.38, size.height * 0.5)
  return {
    x: (size.width - width) / 2,
    y: size.height * 0.86 - height,
    width,
    height,
  }
}

/** Grains per column on the wall. */
export const WALL_ROWS = 100

/** The wall: a band across the middle of the stage, panned so `pan` 0 shows its start and 1 its end. */
export function wallRect(size: Size, columns: number, pan: number): Rect {
  // Whole-pixel cells keep the wall's rows and columns from beating against the pixel grid.
  const pitch = Math.max(Math.floor((size.height * 0.4) / WALL_ROWS), 2)
  const height = pitch * WALL_ROWS
  const width = columns * pitch
  const margin = size.width * 0.08
  const start = margin
  const end = Math.min(size.width - margin - width, start)
  const fits = width <= size.width - 2 * margin
  return {
    x: Math.round(fits ? (size.width - width) / 2 : start + (end - start) * pan),
    y: Math.round(size.height * 0.4),
    width,
    height,
  }
}

/** A grain radius that fills the heap without hiding the grains, in CSS pixels. */
export function grainRadius(size: Size, count: number): number {
  const heap = heapRect(size)
  // The mound covers about 58% of its rectangle; grains overlap a little, like sand.
  const area = heap.width * heap.height * 0.58
  const r = Math.sqrt((area * 1.25) / (Math.PI * Math.max(count, 1)))
  return Math.min(Math.max(r, 0.85), 3.6)
}

export interface SkylineData {
  /** 0 to 1 per area. */
  readonly heights: Float32Array
  /** RGBA bytes per area. */
  readonly colours: Uint8Array
}

export interface StageContext {
  readonly size: Size
  readonly home: Camera
  readonly hexFrame: Rect
  /** The level's bounds on the stage at the resting camera: the map scene's frame. */
  readonly mapFrame: Rect
  /** The reader's shape: 0 equal-size areas, 1 the real map, between while it tweens. */
  readonly shapeMix: number
  readonly wallColumns: number
  readonly grainCount: number
  readonly guess: Shares
  readonly selected: number
  readonly skylines: Readonly<Record<SkylineId, SkylineData>> | undefined
  /** Each area's west-to-east place (0 to 1) on the reader's shape, for the skyline wipe. */
  readonly areaX: Float32Array
  /** The landing's camera, while it flies; otherwise the film's own. */
  readonly camera: CameraPose | undefined
  /** Boundary hairlines: 1 when the marks are real land and at rest. */
  readonly outline: number
}

/** Width of the skyline wipe, as a share of the stage's breadth. */
const WIPE = 0.5

/** Each area's mix from the first skyline to the second: a wipe from west to east. */
export function wipe(mix: number, x: number): number {
  return Math.min(Math.max(mix * (1 + WIPE) - x * WIPE, 0), 1)
}

function skylineDraw(frame: SkylineFrame, context: StageContext): SkylineDraw | undefined {
  const first = context.skylines?.[frame.first]
  const second = context.skylines?.[frame.second]
  if (first === undefined || second === undefined) return undefined
  const n = first.heights.length
  const heights = new Float32Array(n)
  const colours = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const w = wipe(frame.mix, context.areaX[i] ?? 0)
    const a = first.heights[i] ?? 0
    const b = second.heights[i] ?? 0
    heights[i] = a + (b - a) * w
    for (let k = 0; k < 4; k++) {
      const ca = first.colours[i * 4 + k] ?? 0
      colours[i * 4 + k] = Math.round(ca + ((second.colours[i * 4 + k] ?? 0) - ca) * w)
    }
  }
  return { layout: 'shape', heights, colours, elevation: frame.elevation }
}

/**
 * A wall grain's radius as a share of its cell: past half the cell's diagonal
 * (0.71), so neighbours cover the corners and the paper never shows through.
 */
const WALL_COVER = 0.75

/** Grain radius in a scene: on the wall each grain fills its cell, so the blocks read as solid. */
export function sceneRadius(scene: SceneId, context: StageContext): number {
  const base = grainRadius(context.size, context.grainCount)
  if (scene !== 'wall') return base
  const pitch = wallRect(context.size, context.wallColumns, 0).height / WALL_ROWS
  return Math.max(base, pitch * WALL_COVER)
}

export function sceneFrame(scene: SceneId, context: StageContext, pan: number): PixelFrame {
  const { size } = context
  if (scene === 'poster') return [0, 0, size.width, size.height]
  if (scene === 'heap') return frameOf(heapRect(size))
  if (scene === 'wall') return frameOf(wallRect(size, context.wallColumns, pan))
  if (scene === 'map') return frameOf(context.mapFrame)
  return frameOf(context.hexFrame)
}

/** The grain scene `land` stands for: whichever shape the reader has more of. */
const landOf = (target: GrainTarget, mix: number): SceneId =>
  target !== 'land' ? target : mix >= 0.5 ? 'map' : 'hex'

/**
 * Grains with `land` resolved to a scene. Grains at rest on the land follow
 * the reader's shape switch, moving from the hexes to the map by its mix.
 */
export function resolveLand(
  grains: GrainFrame,
  mix: number,
): GrainFrame & {
  readonly from: SceneId
  readonly to: SceneId
} {
  const atRest = grains.t === 1 && grains.to === 'land'
  if (atRest && mix > 0 && mix < 1) {
    return { ...grains, from: 'hex', to: 'map', t: mix, stagger: 0, arc: 0, fall: false }
  }
  return { ...grains, from: landOf(grains.from, mix), to: landOf(grains.to, mix) }
}

/** Everything the canvas draws for one frame of the film. */
export function drawFor(frame: FilmFrame, context: StageContext): FilmDraw {
  const tilt = frame.skyline?.tilt ?? 0
  const camera: CameraPose = context.camera ?? {
    ...context.home,
    pitch: 52 * tilt,
    bearing: -14 * tilt,
  }
  const { areas, skyline } = frame
  const grains =
    frame.grains === undefined ? undefined : resolveLand(frame.grains, context.shapeMix)
  const [first, second] = dividers(context.guess)
  const skylineDrawn = skyline === undefined ? undefined : skylineDraw(skyline, context)
  return {
    camera,
    ...(grains === undefined
      ? {}
      : {
          grains: {
            from: grains.from,
            to: grains.to,
            // The wall pans only while grains rest on it; a move onto it lands on its first view.
            fromFrame: sceneFrame(grains.from, context, grains.from === 'wall' ? grains.pan : 0),
            toFrame: sceneFrame(grains.to, context, grains.pan),
            t: grains.t,
            stagger: grains.stagger,
            arc: grains.arc * context.size.height,
            fall: grains.fall,
            fade: grains.opacity,
            radius:
              sceneRadius(grains.from, context) +
              (sceneRadius(grains.to, context) - sceneRadius(grains.from, context)) * grains.t,
            guess: [first / 100, second / 100],
            guessTint: grains.guessTint,
            familyTint: grains.familyTint,
          },
        }),
    ...(areas === undefined
      ? {}
      : {
          areas: {
            from: areas.from,
            to: areas.to,
            t: areas.t,
            opacity: areas.opacity,
            outline:
              areas.t === 1 && areas.to === 'shape' && skyline === undefined ? context.outline : 0,
            selected: context.selected,
          },
        }),
    ...(skylineDrawn === undefined ? {} : { skyline: skylineDrawn }),
  }
}
