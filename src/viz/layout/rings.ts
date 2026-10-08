/**
 * Every mark is one closed ring of the same number of points, starting at its
 * top and running clockwise on screen, as `rings.bin` stores boundaries. Any
 * two rings then morph vertex by vertex without twisting.
 *
 * Rings are packed: area `i`, point `k` is at `(i * points + k) * 2` in a
 * Float32Array of x, y pairs.
 */

/** Resample a closed polygon (packed x, y) to `points` points of equal arc length from its first vertex. */
export function resampleClosed(
  polygon: readonly number[],
  points: number,
  out: Float32Array,
  offset: number,
): void {
  const n = polygon.length / 2
  const lengths: number[] = []
  let perimeter = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const dx = (polygon[j * 2] ?? 0) - (polygon[i * 2] ?? 0)
    const dy = (polygon[j * 2 + 1] ?? 0) - (polygon[i * 2 + 1] ?? 0)
    const length = Math.hypot(dx, dy)
    lengths.push(length)
    perimeter += length
  }
  let edge = 0
  let walked = 0
  for (let k = 0; k < points; k++) {
    const target = (perimeter * k) / points
    while (edge < n - 1 && walked + (lengths[edge] ?? 0) < target) {
      walked += lengths[edge] ?? 0
      edge += 1
    }
    const length = lengths[edge] ?? 0
    const t = length === 0 ? 0 : (target - walked) / length
    const j = (edge + 1) % n
    const x0 = polygon[edge * 2] ?? 0
    const y0 = polygon[edge * 2 + 1] ?? 0
    out[offset + k * 2] = x0 + ((polygon[j * 2] ?? 0) - x0) * t
    out[offset + k * 2 + 1] = y0 + ((polygon[j * 2 + 1] ?? 0) - y0) * t
  }
}

const SIN60 = Math.sqrt(3) / 2

/** A pointy-top hexagon of circumradius `r`, from its top vertex, clockwise. */
export function hexRing(
  cx: number,
  cy: number,
  r: number,
  points: number,
  out: Float32Array,
  offset: number,
): void {
  const w = r * SIN60
  resampleClosed(
    [
      cx,
      cy - r,
      cx + w,
      cy - r / 2,
      cx + w,
      cy + r / 2,
      cx,
      cy + r,
      cx - w,
      cy + r / 2,
      cx - w,
      cy - r / 2,
    ],
    points,
    out,
    offset,
  )
}

const unitCircles = new Map<number, Float64Array>()

/** Packed [sin, cos] for `points` angles from the top, clockwise; built once per point count. */
function unitCircle(points: number): Float64Array {
  const cached = unitCircles.get(points)
  if (cached !== undefined) return cached
  const table = new Float64Array(points * 2)
  for (let k = 0; k < points; k++) {
    const angle = (2 * Math.PI * k) / points
    table[k * 2] = Math.sin(angle)
    table[k * 2 + 1] = Math.cos(angle)
  }
  unitCircles.set(points, table)
  return table
}

/** A circle of radius `r`, from its top, clockwise. */
export function circleRing(
  cx: number,
  cy: number,
  r: number,
  points: number,
  out: Float32Array,
  offset: number,
): void {
  const table = unitCircle(points)
  for (let k = 0; k < points; k++) {
    out[offset + k * 2] = cx + r * (table[k * 2] ?? 0)
    out[offset + k * 2 + 1] = cy - r * (table[k * 2 + 1] ?? 0)
  }
}

/**
 * A rectangle from the middle of its top edge, clockwise, with its corners
 * as vertices at an eighth, three eighths, five eighths and seven eighths of
 * the ring, where a circle ring has its diagonals. The other points sit
 * evenly along each edge, so a thin bar keeps square ends instead of the
 * chamfers an equal arc-length resample cuts.
 */
export function rectRing(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  points: number,
  out: Float32Array,
  offset: number,
): void {
  const left = Math.min(x0, x1)
  const right = Math.max(x0, x1)
  const top = Math.min(y0, y1)
  const bottom = Math.max(y0, y1)
  const cx = (left + right) / 2
  // Corner k sits at index corners[k]; the ring closes back to index `points`.
  const corners = [1, 3, 5, 7].map((eighth) => Math.round((points * eighth) / 8))
  const stops: readonly (readonly [number, number, number])[] = [
    [0, cx, top],
    [corners[0] ?? 0, right, top],
    [corners[1] ?? 0, right, bottom],
    [corners[2] ?? 0, left, bottom],
    [corners[3] ?? 0, left, top],
    [points, cx, top],
  ]
  for (let s = 0; s < stops.length - 1; s++) {
    const [k0, xa, ya] = stops[s] ?? [0, 0, 0]
    const [k1, xb, yb] = stops[s + 1] ?? [0, 0, 0]
    for (let k = k0; k < k1; k++) {
      const t = (k - k0) / (k1 - k0)
      out[offset + k * 2] = k === k0 ? xa : xa + (xb - xa) * t
      out[offset + k * 2 + 1] = k === k0 ? ya : ya + (yb - ya) * t
    }
  }
}

/** Mean of a ring's points: its label and tooltip anchor. */
export function ringCentre(rings: Float32Array, area: number, points: number): [number, number] {
  let x = 0
  let y = 0
  const start = area * points * 2
  for (let k = 0; k < points; k++) {
    x += rings[start + k * 2] ?? 0
    y += rings[start + k * 2 + 1] ?? 0
  }
  return [x / points, y / points]
}

/** Whether (x, y) falls inside area `area`'s ring (even-odd rule). */
export function ringContains(
  rings: Float32Array,
  area: number,
  points: number,
  x: number,
  y: number,
): boolean {
  const start = area * points * 2
  let inside = false
  for (let i = 0, j = points - 1; i < points; j = i++) {
    const xi = rings[start + i * 2] ?? 0
    const yi = rings[start + i * 2 + 1] ?? 0
    const xj = rings[start + j * 2] ?? 0
    const yj = rings[start + j * 2 + 1] ?? 0
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** The topmost area whose ring holds (x, y), or -1. Later areas draw on top. */
export function hitTest(
  rings: Float32Array,
  areaCount: number,
  points: number,
  x: number,
  y: number,
): number {
  for (let area = areaCount - 1; area >= 0; area--) {
    if (ringContains(rings, area, points, x, y)) return area
  }
  return -1
}

/** mix(from, to, t) for packed arrays of equal length, into `out`. */
export function mixInto(out: Float32Array, from: Float32Array, to: Float32Array, t: number): void {
  for (let i = 0; i < out.length; i++) {
    const a = from[i] ?? 0
    out[i] = a + ((to[i] ?? 0) - a) * t
  }
}
