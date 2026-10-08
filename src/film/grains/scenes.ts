/**
 * Baked grain positions, one buffer per scene. Each scene places every grain
 * in its own unit frame (x and y from 0 to 1, y down), quantised to 16 bits,
 * so a buffer is independent of the screen size: the shader maps a frame to
 * pixels with one rectangle per scene. Buffers are built from a seeded random
 * source, so a scene is the same on every load.
 */
import type { HexCell } from '#/viz/layout/views.ts'
import { MARK_FILL } from '#/viz/layout/views.ts'
import type { Rect } from '#/viz/layout/projection.ts'
import type { GrainSet } from './allocate.ts'
import { random, seedOf } from './random.ts'

export type SceneId = 'poster' | 'heap' | 'wall' | 'hex' | 'map'

/** Packed [x, y] per grain, each 0 to 65535 across the scene's frame. */
export type SceneBuffer = Uint16Array

const MAX = 65_535

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export function quantise(unit: number): number {
  return Math.round(clamp01(unit) * MAX)
}

export function dequantise(value: number): number {
  return value / MAX
}

/** The height of the heap at x (0 to 1) as a share of its frame: a smooth mound, 0 at both ends. */
export function heapProfile(x: number): number {
  if (x <= 0 || x >= 1) return 0
  return Math.cos(Math.PI * (x - 0.5)) ** 1.4
}

/**
 * One mound. Points are sampled evenly under the profile, then handed out
 * bottom first in key order, so grains that fall first land lowest.
 */
export function heapScene(grains: GrainSet): SceneBuffer {
  const n = grains.count
  const next = random(seedOf(`heap|${n}`))
  const xs = new Float32Array(n)
  const ys = new Float32Array(n)
  for (let i = 0; i < n;) {
    const x = next()
    const h = next()
    if (h > heapProfile(x)) continue
    xs[i] = x
    ys[i] = 1 - h
    i += 1
  }
  const byHeight = Uint32Array.from({ length: n }, (_, i) => i).toSorted(
    (a, b) => (ys[b] ?? 0) - (ys[a] ?? 0),
  )
  const byKey = Uint32Array.from({ length: n }, (_, i) => i).toSorted(
    (a, b) => (grains.key[a] ?? 0) - (grains.key[b] ?? 0) || a - b,
  )
  const out = new Uint16Array(n * 2)
  for (let k = 0; k < n; k++) {
    const grain = byKey[k] ?? 0
    const point = byHeight[k] ?? 0
    out[grain * 2] = quantise(xs[point] ?? 0)
    out[grain * 2 + 1] = quantise(ys[point] ?? 0)
  }
  return out
}

export interface WallSpan {
  readonly start: number
  readonly end: number
}

export interface WallLayout {
  /** Grains per column. */
  readonly rows: number
  /** Width of the wall in columns, gaps included. */
  readonly columns: number
  /** Each block's span in columns, parallel to `grains.blocks`. */
  readonly blocks: readonly WallSpan[]
}

/** Gap between benefit families and between groups, in columns. */
export const WALL_GAP = { family: 1, group: 4 } as const

/** Where each block of grains sits on the wall: whole columns from the bottom, a gap between blocks. */
export function wallLayout(grains: GrainSet, rows: number): WallLayout {
  let x = 0
  const blocks = grains.blocks.map((block, i) => {
    const previous = grains.blocks[i - 1]
    if (previous !== undefined) {
      x += previous.group === block.group ? WALL_GAP.family : WALL_GAP.group
    }
    const start = x
    x += Math.ceil(block.count / rows)
    return { start, end: x }
  })
  return { rows, columns: x, blocks }
}

/** Grains stacked into the wall, column by column, bottom to top. */
export function wallScene(grains: GrainSet, layout: WallLayout): SceneBuffer {
  const out = new Uint16Array(grains.count * 2)
  grains.blocks.forEach((block, b) => {
    const span = layout.blocks[b]
    if (span === undefined) return
    for (let k = 0; k < block.count; k++) {
      const grain = block.start + k
      const column = span.start + Math.floor(k / layout.rows)
      const row = k % layout.rows
      out[grain * 2] = quantise((column + 0.5) / layout.columns)
      out[grain * 2 + 1] = quantise(1 - (row + 0.5) / layout.rows)
    }
  })
  return out
}

/** Open Innovations `odd-r` cells measured in hex circumradii, as `hexLayout` places them. */
export interface HexGrid {
  readonly width: number
  readonly height: number
  /** Packed [x, y] cell centres in circumradii from the grid's top left. */
  readonly centres: Float32Array
}

const SQRT3 = Math.sqrt(3)

export function hexGrid(cells: readonly HexCell[]): HexGrid {
  const xs = cells.map((cell) => cell.q + ((cell.r & 1) === 1 ? 0.5 : 0))
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minR = Math.min(...cells.map((cell) => cell.r))
  const maxR = Math.max(...cells.map((cell) => cell.r))
  const centres = new Float32Array(cells.length * 2)
  cells.forEach((cell, i) => {
    centres[i * 2] = SQRT3 / 2 + SQRT3 * ((xs[i] ?? 0) - minX)
    centres[i * 2 + 1] = 1 + 1.5 * (maxR - cell.r)
  })
  return { width: SQRT3 * (maxX - minX + 1), height: 1.5 * (maxR - minR) + 2, centres }
}

/** The pixel frame `hexLayout` fits the grid into inside `stage`. */
export function hexFrame(grid: HexGrid, stage: Rect): Rect {
  const s = Math.min(stage.width / grid.width, stage.height / grid.height)
  return {
    x: stage.x + (stage.width - grid.width * s) / 2,
    y: stage.y + (stage.height - grid.height * s) / 2,
    width: grid.width * s,
    height: grid.height * s,
  }
}

/** Is (x, y) inside a pointy-top hexagon of circumradius r centred on the origin? */
function inHex(x: number, y: number, r: number): boolean {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  return ax <= (SQRT3 / 2) * r && ay <= r - ax / SQRT3
}

/** Each grain inside its own area's hexagon, scattered evenly. */
export function hexScene(grains: GrainSet, grid: HexGrid): SceneBuffer {
  const out = new Uint16Array(grains.count * 2)
  const next = random(seedOf(`hex|${grains.count}`))
  const r = MARK_FILL * 0.94
  for (let grain = 0; grain < grains.count; grain++) {
    const area = grains.area[grain] ?? 0
    const cx = grid.centres[area * 2] ?? 0
    const cy = grid.centres[area * 2 + 1] ?? 0
    let dx = 0
    let dy = 0
    do {
      dx = (next() * 2 - 1) * r
      dy = (next() * 2 - 1) * r
    } while (!inHex(dx, dy, r))
    out[grain * 2] = quantise((cx + dx) / grid.width)
    out[grain * 2 + 1] = quantise((cy + dy) / grid.height)
  }
  return out
}

/**
 * Each grain inside its own area's boundary ring on the real map, scattered
 * evenly. `rings` holds every area's ring of `points` vertices in the map's
 * unit frame (x and y from 0 to 1 across the level's bounds, y down), so the
 * shader maps the scene to the map as drawn with one rectangle.
 */
export function landScene(grains: GrainSet, rings: Float32Array, points: number): SceneBuffer {
  const out = new Uint16Array(grains.count * 2)
  const next = random(seedOf(`map|${grains.count}`))
  const areaCount = rings.length / (points * 2)
  const boxes = new Float32Array(areaCount * 4)
  for (let area = 0; area < areaCount; area++) {
    let minX = 1
    let minY = 1
    let maxX = 0
    let maxY = 0
    for (let k = 0; k < points; k++) {
      const x = rings[(area * points + k) * 2] ?? 0
      const y = rings[(area * points + k) * 2 + 1] ?? 0
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    boxes.set([minX, minY, maxX, maxY], area * 4)
  }
  const inside = (area: number, x: number, y: number): boolean => {
    let hit = false
    const start = area * points * 2
    for (let i = 0, j = points - 1; i < points; j = i++) {
      const xi = rings[start + i * 2] ?? 0
      const yi = rings[start + i * 2 + 1] ?? 0
      const xj = rings[start + j * 2] ?? 0
      const yj = rings[start + j * 2 + 1] ?? 0
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
    }
    return hit
  }
  for (let grain = 0; grain < grains.count; grain++) {
    const area = grains.area[grain] ?? 0
    const b = area * 4
    const x0 = boxes[b] ?? 0
    const y0 = boxes[b + 1] ?? 0
    const w = (boxes[b + 2] ?? 0) - x0
    const h = (boxes[b + 3] ?? 0) - y0
    let x = x0 + w / 2
    let y = y0 + h / 2
    // A ring that crosses itself can leave little inside; after enough misses the grain takes the box's centre.
    for (let tries = 0; tries < 200; tries++) {
      const cx = x0 + next() * w
      const cy = y0 + next() * h
      if (inside(area, cx, cy)) {
        x = cx
        y = cy
        break
      }
    }
    out[grain * 2] = quantise(x)
    out[grain * 2 + 1] = quantise(y)
  }
  return out
}

/**
 * Grains sampled from the inked pixels of a mask (the poster figure drawn to
 * a canvas), with sub-pixel jitter, in the mask's unit frame. Every grain
 * starts inside a glyph, so the figure seems to dissolve into them.
 */
export function maskScene(
  grains: GrainSet,
  alpha: Uint8Array,
  width: number,
  height: number,
): SceneBuffer {
  const inked: number[] = []
  for (let i = 0; i < alpha.length; i++) if ((alpha[i] ?? 0) > 127) inked.push(i)
  const out = new Uint16Array(grains.count * 2)
  const next = random(seedOf(`poster|${grains.count}|${width}x${height}`))
  for (let grain = 0; grain < grains.count; grain++) {
    const pixel = inked.length === 0 ? 0 : (inked[Math.floor(next() * inked.length)] ?? 0)
    // Jitter stays clear of the pixel's edges, so quantising never moves a grain off its pixel.
    const x = (pixel % width) + 0.05 + next() * 0.9
    const y = Math.floor(pixel / width) + 0.05 + next() * 0.9
    out[grain * 2] = quantise(inked.length === 0 ? next() : x / width)
    out[grain * 2 + 1] = quantise(inked.length === 0 ? next() : y / height)
  }
  return out
}
