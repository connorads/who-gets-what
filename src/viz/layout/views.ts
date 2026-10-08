/**
 * The four explorer views as pure layouts: each returns one ring per area, in
 * area order, in CSS pixels inside the stage. The same area keeps the same
 * index in every view, so the engine morphs marks and never remounts them.
 */
import { circleRing, hexRing, rectRing } from './rings.ts'
import { projectAll, type Camera, type Rect, type Size } from './projection.ts'

export interface HexCell {
  readonly q: number
  readonly r: number
}

export interface ViewLayout {
  /** Packed rings: area `i`, point `k` at `(i * points + k) * 2`. */
  readonly rings: Float32Array
  /** Packed [x, y] anchor per area, for tooltips and the skyline. */
  readonly centres: Float32Array
}

export interface HexLayout extends ViewLayout {
  /** Circumradius of one hex cell before the gap, in pixels. */
  readonly cellRadius: number
}

/** Fraction of a hex cell or swarm circle drawn, leaving a paper gap between marks. */
export const MARK_FILL = 0.9

/**
 * Open Innovations hexjson cells (`odd-r`, pointy top, row `r` increasing
 * northwards), scaled to fit the stage and centred in it.
 */
export function hexLayout(cells: readonly HexCell[], stage: Rect, points: number): HexLayout {
  const xs = cells.map((cell) => cell.q + ((cell.r & 1) === 1 ? 0.5 : 0))
  const rs = cells.map((cell) => cell.r)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minR = Math.min(...rs)
  const maxR = Math.max(...rs)
  const sqrt3 = Math.sqrt(3)
  // Width in units of the circumradius s: sqrt3 * (columns span + 1); height: 1.5 * rows span + 2.
  const unitWidth = sqrt3 * (maxX - minX + 1)
  const unitHeight = 1.5 * (maxR - minR) + 2
  const s = Math.min(stage.width / unitWidth, stage.height / unitHeight)
  const left = stage.x + (stage.width - unitWidth * s) / 2 + (sqrt3 * s) / 2
  const top = stage.y + (stage.height - unitHeight * s) / 2 + s
  const rings = new Float32Array(cells.length * points * 2)
  const centres = new Float32Array(cells.length * 2)
  cells.forEach((cell, i) => {
    const cx = left + sqrt3 * s * ((xs[i] ?? 0) - minX)
    const cy = top + 1.5 * s * (maxR - cell.r)
    centres[i * 2] = cx
    centres[i * 2 + 1] = cy
    hexRing(cx, cy, s * MARK_FILL, points, rings, i * points * 2)
  })
  return { rings, centres, cellRadius: s }
}

/**
 * The swarm's value axis in pixels: domain 0 at `start` and 1 at `end`, along
 * x at height `cross` when horizontal, or along y (bottom to top) at `cross`
 * when vertical.
 */
export interface SwarmAxis {
  readonly vertical: boolean
  readonly start: number
  readonly end: number
  readonly cross: number
}

export interface SwarmLayout extends ViewLayout {
  readonly axis: SwarmAxis
  /** Circle radius in pixels. */
  readonly radius: number
}

/**
 * A precomputed beeswarm (`xy` for one period: x from 0 to 1 across the
 * domain, y offset in the same units). Areas with no value sit in a tray at
 * the stage's edge, so no mark is ever removed. A tall stage (a phone held
 * upright) runs the value axis up the stage instead of across it.
 */
export function swarmLayout(
  xy: Float32Array,
  radius: number,
  stage: Rect,
  points: number,
  vertical = false,
): SwarmLayout {
  const areaCount = xy.length / 2
  const length = vertical ? stage.height : stage.width
  const r = Math.max(radius * length * MARK_FILL, 1)
  const step = r * 2.6
  const trayDepth = 2 * step
  const breadth = (vertical ? stage.width : stage.height) - trayDepth
  const cross = vertical ? stage.x + breadth / 2 : stage.y + breadth / 2
  const perLine = Math.max(Math.floor(length / step), 1)
  const rings = new Float32Array(areaCount * points * 2)
  const centres = new Float32Array(areaCount * 2)
  let tray = 0
  for (let i = 0; i < areaCount; i++) {
    const x = xy[i * 2] ?? Number.NaN
    const dy = xy[i * 2 + 1] ?? Number.NaN
    let cx: number
    let cy: number
    if (Number.isNaN(x) || Number.isNaN(dy)) {
      const along = r * 1.3 + (tray % perLine) * step
      const across = r * 1.3 + Math.floor(tray / perLine) * step
      cx = vertical ? stage.x + stage.width - across : stage.x + along
      cy = vertical ? stage.y + along : stage.y + stage.height - across
      tray += 1
    } else if (vertical) {
      cx = cross + dy * length
      cy = stage.y + stage.height - x * length
    } else {
      cx = stage.x + x * length
      cy = cross - dy * length
    }
    centres[i * 2] = cx
    centres[i * 2 + 1] = cy
    circleRing(cx, cy, r, points, rings, i * points * 2)
  }
  const axis: SwarmAxis = vertical
    ? { vertical, start: stage.y + stage.height, end: stage.y, cross }
    : { vertical, start: stage.x, end: stage.x + stage.width, cross }
  return { rings, centres, axis, radius: r }
}

export interface RankLayout extends ViewLayout {
  /** Area indices, highest value first; areas with no value last. */
  readonly order: Int32Array
  /** Pixel y of zero and the value domain the bars span. */
  readonly baseline: number
  readonly domain: readonly [number, number]
  /** Pixels per bar slot. */
  readonly slot: number
}

/** Area indices by value, highest first; NaN values last, in area order. */
export function rankOrder(values: Float32Array): Int32Array {
  const indices = Array.from({ length: values.length }, (_, i) => i)
  indices.sort((a, b) => {
    const va = values[a] ?? Number.NaN
    const vb = values[b] ?? Number.NaN
    const na = Number.isNaN(va)
    const nb = Number.isNaN(vb)
    if (na || nb) return na === nb ? a - b : na ? 1 : -1
    return vb - va || a - b
  })
  return Int32Array.from(indices)
}

export interface RankBar {
  readonly area: number
  readonly x0: number
  readonly x1: number
  /** Top and bottom in pixels; a bar with no value is one pixel tall on the baseline. */
  readonly y0: number
  readonly y1: number
}

export interface RankBars {
  readonly bars: readonly RankBar[]
  readonly order: Int32Array
  readonly baseline: number
  readonly domain: readonly [number, number]
  readonly slot: number
}

/**
 * One bar per area, highest first from the left. Bars rise from zero, so a
 * metric with negative values (actual less modelled) hangs below the line.
 */
export function rankBars(values: Float32Array, stage: Rect): RankBars {
  const order = rankOrder(values)
  let min = 0
  let max = 0
  for (const value of values) {
    if (Number.isNaN(value)) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  if (max === min) max = min + 1
  const yOf = (value: number): number => stage.y + ((max - value) / (max - min)) * stage.height
  const baseline = yOf(0)
  const slot = stage.width / Math.max(values.length, 1)
  const gap = slot > 3 ? slot * 0.18 : 0
  const bars = Array.from(order, (area, position): RankBar => {
    const value = values[area] ?? Number.NaN
    const x0 = stage.x + position * slot + gap / 2
    const x1 = x0 + Math.max(slot - gap, 0.6)
    if (Number.isNaN(value)) return { area, x0, x1, y0: baseline - 1, y1: baseline }
    const y = yOf(value)
    return value < 0
      ? { area, x0, x1, y0: baseline, y1: Math.max(y, baseline + 1) }
      : { area, x0, x1, y0: Math.min(y, baseline - 1), y1: baseline }
  })
  return { bars, order, baseline, domain: [min, max], slot }
}

/** Rank bars as rings, for the morph. */
export function rankLayout(values: Float32Array, stage: Rect, points: number): RankLayout {
  const { bars, order, baseline, domain, slot } = rankBars(values, stage)
  const rings = new Float32Array(values.length * points * 2)
  const centres = new Float32Array(values.length * 2)
  for (const bar of bars) {
    rectRing(bar.x0, bar.y0, bar.x1, bar.y1, points, rings, bar.area * points * 2)
    centres[bar.area * 2] = (bar.x0 + bar.x1) / 2
    centres[bar.area * 2 + 1] = (values[bar.area] ?? 0) < 0 ? bar.y1 : bar.y0
  }
  return { rings, centres, order, baseline, domain, slot }
}

/** Boundary rings from `rings.bin` (longitude, latitude) in pixels for this camera. */
export function mapLayout(
  lonLat: Float32Array,
  camera: Camera,
  size: Size,
  areaCount: number,
  points: number,
): ViewLayout {
  const rings = projectAll(camera, size, lonLat)
  const centres = new Float32Array(areaCount * 2)
  for (let i = 0; i < areaCount; i++) {
    let x = 0
    let y = 0
    for (let k = 0; k < points; k++) {
      x += rings[(i * points + k) * 2] ?? 0
      y += rings[(i * points + k) * 2 + 1] ?? 0
    }
    centres[i * 2] = x / points
    centres[i * 2 + 1] = y / points
  }
  return { rings, centres }
}
