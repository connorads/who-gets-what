/**
 * CPU-side geometry for the morph layer: one triangulation per area, fixed
 * for the life of the area order, and per-vertex expansion of per-area
 * colours and styles. Pure, so tests run without WebGL.
 */
import earcut from 'earcut'

/**
 * Triangle indices over every area's ring. Each ring is cut once from its
 * boundary shape; any full triangulation of a ring stays valid for the
 * convex hex, circle and bar the same ring becomes in other views. A
 * resampled coastline can cross itself, and earcut then leaves some points
 * out: each run of skipped points is fanned from the point before it, which
 * covers no area on the boundary and closes the gap in the convex shapes.
 */
export function triangulate(
  boundaries: Float32Array,
  areaCount: number,
  points: number,
): Uint32Array {
  const full = (points - 2) * 3
  const out = new Uint32Array(areaCount * full)
  const ring = new Float64Array(points * 2)
  const used = new Uint8Array(points)
  for (let area = 0; area < areaCount; area++) {
    for (let k = 0; k < points * 2; k++) ring[k] = boundaries[area * points * 2 + k] ?? 0
    const cut = earcut(ring)
    const base = area * points
    const at = area * full
    const triangles = cut.length > 0 ? cut : fan(points)
    used.fill(0)
    for (const index of triangles) used[index] = 1
    const all = untangle([...triangles, ...skipped(used)], points).slice(0, full)
    // Unfilled slots stay degenerate triangles on the area's first point.
    for (let i = 0; i < full; i++) out[at + i] = base + (all[i] ?? 0)
  }
  return out
}

/** Whether two chords of a ring, each given as [low, high] point indices, cross. */
const crosses = ([a, b]: readonly [number, number], [c, d]: readonly [number, number]): boolean =>
  (a < c && c < b && b < d) || (c < a && a < d && d < b)

/**
 * A triangulation of the ring's points in ring order, from as many of the
 * given triangles' diagonals as do not cross. A self-crossing ring can
 * leave earcut's triangles crossing each other once the ring is convex:
 * they then overlap in one place and leave a sliver of paper in another.
 * Any set of non-crossing diagonals splits a convex ring into convex
 * faces, and each face left without one is fanned.
 */
function untangle(triangles: readonly number[], points: number): number[] {
  const side = (a: number, b: number) => b - a === 1 || b - a === points - 1
  const diagonals: [number, number][] = []
  for (let t = 0; t < triangles.length; t += 3) {
    const corners = [triangles[t] ?? 0, triangles[t + 1] ?? 0, triangles[t + 2] ?? 0]
    for (let e = 0; e < 3; e++) {
      const x = corners[e] ?? 0
      const y = corners[(e + 1) % 3] ?? 0
      const edge: [number, number] = x < y ? [x, y] : [y, x]
      if (x === y || side(edge[0], edge[1])) continue
      if (diagonals.some((d) => (d[0] === edge[0] && d[1] === edge[1]) || crosses(d, edge)))
        continue
      diagonals.push(edge)
    }
  }
  const out: number[] = []
  const split = (face: readonly number[]): void => {
    for (const [a, b] of diagonals) {
      const i = Math.min(face.indexOf(a), face.indexOf(b))
      const j = Math.max(face.indexOf(a), face.indexOf(b))
      if (i < 0 || j - i === 1 || j - i === face.length - 1) continue
      split(face.slice(i, j + 1))
      split([...face.slice(j), ...face.slice(0, i + 1)])
      return
    }
    for (let k = 1; k < face.length - 1; k++) out.push(face[0] ?? 0, face[k] ?? 0, face[k + 1] ?? 0)
  }
  split(Array.from({ length: points }, (_, k) => k))
  return out
}

/** A fan from the first point: the cut for a ring earcut finds no triangle in. */
function fan(points: number): number[] {
  return Array.from({ length: points - 2 }, (_, t) => [0, t + 1, t + 2]).flat()
}

/** Triangles fanning each run of unused ring points from the used point before it. */
function skipped(used: Uint8Array): number[] {
  const points = used.length
  const first = used.indexOf(1)
  if (first < 0) return []
  const out: number[] = []
  let anchor = first
  let run: number[] = []
  for (let step = 1; step <= points; step++) {
    const k = (first + step) % points
    if (used[k] === 0) {
      run.push(k)
      continue
    }
    const chain = [...run, k]
    for (let i = 0; i < run.length; i++) out.push(anchor, chain[i] ?? k, chain[i + 1] ?? k)
    anchor = k
    run = []
  }
  return out
}

/** Per-area RGBA bytes repeated for each of the area's ring points. */
export function perVertexColours(areaColours: Uint8Array, points: number): Uint8Array {
  const areaCount = areaColours.length / 4
  // One 32-bit word per vertex: no per-vertex views, so a recolour of every ring stays cheap.
  const words = new Uint32Array(areaCount * points)
  const source = new Uint32Array(areaColours.buffer, areaColours.byteOffset, areaCount)
  for (let area = 0; area < areaCount; area++) {
    words.fill(source[area] ?? 0, area * points, (area + 1) * points)
  }
  return new Uint8Array(words.buffer)
}

/** Per vertex [area index, style bits]. */
export function perVertexMeta(styles: Uint8Array, points: number): Float32Array {
  const out = new Float32Array(styles.length * points * 2)
  for (let area = 0; area < styles.length; area++) {
    for (let k = 0; k < points; k++) {
      out[(area * points + k) * 2] = area
      out[(area * points + k) * 2 + 1] = styles[area] ?? 0
    }
  }
  return out
}

/** mix(from, to, t) for byte arrays, rounded, into `out`. */
export function mixBytesInto(out: Uint8Array, from: Uint8Array, to: Uint8Array, t: number): void {
  for (let i = 0; i < out.length; i++) {
    const a = from[i] ?? 0
    out[i] = Math.round(a + ((to[i] ?? 0) - a) * t)
  }
}
