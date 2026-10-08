/**
 * The map's real shapes from `shapes.bin`: every polygon of every area,
 * islands and holes included, with the triangles the pipeline cut. They
 * draw the map at rest, its hairlines, its inset and its extruded skyline.
 * Nothing here triangulates: it only unpacks and re-indexes. Pure, so
 * tests run without WebGL.
 */
import type { ShapesBundle } from '#/domain/bundle.ts'

export interface MapShapes {
  /** Packed [lon, lat] per vertex. */
  readonly lonLat: Float32Array
  /** Start offsets with a final end entry: ring to vertices, polygon to rings, area to polygons. */
  readonly rings: Uint32Array
  readonly polygons: Uint32Array
  readonly areas: Uint32Array
  /** Triangles over `lonLat`, three indices each, grouped by area. */
  readonly indices: Uint32Array
  /** Per area, its first triangle, with a final end entry. */
  readonly areaTriangles: Uint32Array
  /** Area index per vertex. */
  readonly areaOf: Uint32Array
}

const QUANTA = 65_535

/** Unpack a shapes bundle: vertices to degrees, triangles to indices over every vertex. */
export function mapShapes(bundle: ShapesBundle): MapShapes {
  const { xy, rings, polygons, areas, triangles, polygonTriangles } = bundle
  const [[west, south], [east, north]] = bundle.header.bounds
  const lonLat = new Float32Array(xy.length)
  const sx = (east - west) / QUANTA
  const sy = (north - south) / QUANTA
  for (let i = 0; i < xy.length; i += 2) {
    lonLat[i] = west + (xy[i] ?? 0) * sx
    lonLat[i + 1] = south + (xy[i + 1] ?? 0) * sy
  }
  const indices = new Uint32Array(triangles.length)
  for (let p = 0; p + 1 < polygons.length; p++) {
    const first = rings[polygons[p] ?? 0] ?? 0
    for (let t = (polygonTriangles[p] ?? 0) * 3; t < (polygonTriangles[p + 1] ?? 0) * 3; t++) {
      indices[t] = first + (triangles[t] ?? 0)
    }
  }
  const areaOf = new Uint32Array(lonLat.length / 2)
  for (let a = 0; a + 1 < areas.length; a++) {
    const from = rings[polygons[areas[a] ?? 0] ?? 0] ?? 0
    const to = rings[polygons[areas[a + 1] ?? 0] ?? 0] ?? 0
    areaOf.fill(a, from, to)
  }
  return {
    lonLat,
    rings: rings.slice(),
    polygons: polygons.slice(),
    areas: areas.slice(),
    indices,
    areaTriangles: Uint32Array.from(areas, (p) => polygonTriangles[p] ?? 0),
    areaOf,
  }
}

/** First and end vertex of an area. */
export function areaVertices(shapes: MapShapes, area: number): readonly [number, number] {
  const { rings, polygons, areas } = shapes
  return [
    rings[polygons[areas[area] ?? 0] ?? 0] ?? 0,
    rings[polygons[areas[area + 1] ?? 0] ?? 0] ?? 0,
  ]
}

/**
 * The shapes of some areas only, in the order given, with their own
 * offsets and indices. Area indices in `areaOf` stay the level's, so
 * colours and styles read the same per-area arrays.
 */
export function subsetShapes(shapes: MapShapes, picked: readonly number[]): MapShapes {
  let vertexCount = 0
  let ringCount = 0
  let polygonCount = 0
  let indexCount = 0
  const spans = picked.map((area) => {
    const [from, to] = areaVertices(shapes, area)
    const p0 = shapes.areas[area] ?? 0
    const p1 = shapes.areas[area + 1] ?? 0
    const r0 = shapes.polygons[p0] ?? 0
    const r1 = shapes.polygons[p1] ?? 0
    const t0 = shapes.areaTriangles[area] ?? 0
    const t1 = shapes.areaTriangles[area + 1] ?? 0
    vertexCount += to - from
    ringCount += r1 - r0
    polygonCount += p1 - p0
    indexCount += (t1 - t0) * 3
    return { area, from, to, p0, p1, r0, r1, t0, t1 }
  })
  const lonLat = new Float32Array(vertexCount * 2)
  const areaOf = new Uint32Array(vertexCount)
  const rings = new Uint32Array(ringCount + 1)
  const polygons = new Uint32Array(polygonCount + 1)
  const areas = new Uint32Array(picked.length + 1)
  const areaTriangles = new Uint32Array(picked.length + 1)
  const indices = new Uint32Array(indexCount)
  let v = 0
  let r = 0
  let p = 0
  let i = 0
  spans.forEach(({ area, from, to, p0, p1, r0, r1, t0, t1 }, k) => {
    areas[k] = p
    areaTriangles[k] = i / 3
    lonLat.set(shapes.lonLat.subarray(from * 2, to * 2), v * 2)
    areaOf.fill(area, v, v + (to - from))
    for (let q = p0; q < p1; q++) polygons[p++] = r + ((shapes.polygons[q] ?? 0) - r0)
    for (let q = r0; q < r1; q++) rings[r++] = v + ((shapes.rings[q] ?? 0) - from)
    for (let t = t0 * 3; t < t1 * 3; t++) indices[i++] = v + ((shapes.indices[t] ?? 0) - from)
    v += to - from
  })
  areas[picked.length] = p
  areaTriangles[picked.length] = i / 3
  polygons[polygonCount] = r
  rings[ringCount] = v
  return { lonLat, rings, polygons, areas, indices, areaTriangles, areaOf }
}

/** deck.gl binary path data: one closed path per ring, no per-path objects. */
export interface BinaryPaths {
  readonly length: number
  readonly startIndices: Uint32Array
  readonly attributes: { readonly getPath: { readonly value: Float32Array; readonly size: 2 } }
}

/** Every ring of `lonLat` (the shapes' own, or the same vertices placed elsewhere), closed. */
export function closedRings(shapes: MapShapes, lonLat: Float32Array = shapes.lonLat): BinaryPaths {
  const ringCount = shapes.rings.length - 1
  const value = new Float32Array((lonLat.length / 2 + ringCount) * 2)
  const startIndices = new Uint32Array(ringCount)
  let at = 0
  for (let r = 0; r < ringCount; r++) {
    const from = shapes.rings[r] ?? 0
    const to = shapes.rings[r + 1] ?? 0
    startIndices[r] = at
    value.set(lonLat.subarray(from * 2, to * 2), at * 2)
    at += to - from
    value[at * 2] = lonLat[from * 2] ?? 0
    value[at * 2 + 1] = lonLat[from * 2 + 1] ?? 0
    at += 1
  }
  return { length: ringCount, startIndices, attributes: { getPath: { value, size: 2 } } }
}

/** The ring index each ring belongs to, as its area. */
export function ringAreas(shapes: MapShapes): Uint32Array {
  const out = new Uint32Array(shapes.rings.length - 1)
  for (let a = 0; a + 1 < shapes.areas.length; a++) {
    const from = shapes.polygons[shapes.areas[a] ?? 0] ?? 0
    const to = shapes.polygons[shapes.areas[a + 1] ?? 0] ?? 0
    out.fill(shapes.areaOf[shapes.rings[from] ?? 0] ?? a, from, to)
  }
  return out
}

/**
 * Extrusion input for deck.gl's SolidPolygonLayer in binary form: every
 * ring closed and drawn as its own object, so each ring, holes included,
 * gets its walls; the pipeline's triangles, re-indexed for the closing
 * vertices, cap the tops.
 */
export interface Extrusion {
  readonly length: number
  readonly startIndices: Uint32Array
  readonly attributes: {
    readonly getPolygon: { readonly value: Float32Array; readonly size: 2 }
    readonly indices: Uint32Array
  }
  /** Area index per ring object, for per-area heights and colours. */
  readonly areaOfRing: Uint32Array
}

export function extrusion(shapes: MapShapes, lonLat: Float32Array = shapes.lonLat): Extrusion {
  const paths = closedRings(shapes, lonLat)
  // Each ring adds one closing vertex, so a vertex moves up by its ring's index.
  const shift = new Uint32Array(shapes.lonLat.length / 2)
  for (let r = 0; r + 1 < shapes.rings.length; r++) {
    shift.fill(r, shapes.rings[r] ?? 0, shapes.rings[r + 1] ?? 0)
  }
  const indices = Uint32Array.from(shapes.indices, (v) => v + (shift[v] ?? 0))
  return {
    length: paths.length,
    startIndices: paths.startIndices,
    attributes: { getPolygon: paths.attributes.getPath, indices },
    areaOfRing: ringAreas(shapes),
  }
}

/** Pixel bounding box per area, packed [minX, minY, maxX, maxY], for quick hit tests. */
export function areaBoxes(shapes: MapShapes, pixels: Float32Array): Float32Array {
  const count = shapes.areas.length - 1
  const out = new Float32Array(count * 4)
  for (let k = 0; k < count; k++) {
    const [from, to] = areaVertices(shapes, k)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let v = from; v < to; v++) {
      const x = pixels[v * 2] ?? 0
      const y = pixels[v * 2 + 1] ?? 0
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    out.set([minX, minY, maxX, maxY], k * 4)
  }
  return out
}

/**
 * The area whose shape holds pixel (x, y), or -1. `pixels` are the shapes'
 * vertices on screen and `boxes` their `areaBoxes`. Every ring of an area
 * counts under the even-odd rule, so a hole is not part of its area.
 */
export function hitShapes(
  shapes: MapShapes,
  pixels: Float32Array,
  boxes: Float32Array,
  x: number,
  y: number,
): number {
  const count = shapes.areas.length - 1
  for (let k = count - 1; k >= 0; k--) {
    const b = k * 4
    if (x < (boxes[b] ?? 0) || y < (boxes[b + 1] ?? 0)) continue
    if (x > (boxes[b + 2] ?? 0) || y > (boxes[b + 3] ?? 0)) continue
    let inside = false
    const r0 = shapes.polygons[shapes.areas[k] ?? 0] ?? 0
    const r1 = shapes.polygons[shapes.areas[k + 1] ?? 0] ?? 0
    for (let r = r0; r < r1; r++) {
      const start = shapes.rings[r] ?? 0
      const length = (shapes.rings[r + 1] ?? 0) - start
      for (let i = 0, j = length - 1; i < length; j = i++) {
        const xi = pixels[(start + i) * 2] ?? 0
        const yi = pixels[(start + i) * 2 + 1] ?? 0
        const xj = pixels[(start + j) * 2] ?? 0
        const yj = pixels[(start + j) * 2 + 1] ?? 0
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
      }
    }
    if (inside) return shapes.areaOf[shapes.rings[r0] ?? 0] ?? k
  }
  return -1
}

/** Per-vertex RGBA bytes from per-area RGBA bytes. */
export function shapeColours(areaColours: Uint8Array, areaOf: Uint32Array): Uint8Array {
  const words = new Uint32Array(areaOf.length)
  const source = new Uint32Array(
    areaColours.buffer,
    areaColours.byteOffset,
    areaColours.byteLength / 4,
  )
  for (let v = 0; v < areaOf.length; v++) words[v] = source[areaOf[v] ?? 0] ?? 0
  return new Uint8Array(words.buffer)
}

/** Per vertex [area index, style bits], as the morph layer reads them. */
export function shapeMeta(styles: Uint8Array, areaOf: Uint32Array): Float32Array {
  const out = new Float32Array(areaOf.length * 2)
  for (let v = 0; v < areaOf.length; v++) {
    const area = areaOf[v] ?? 0
    out[v * 2] = area
    out[v * 2 + 1] = styles[area] ?? 0
  }
  return out
}

/** Mean of an area's outer-ring vertices of its first polygon, in `pixels`: a label anchor. */
export function areaAnchor(shapes: MapShapes, pixels: Float32Array, k: number): [number, number] {
  // The largest polygon by vertex count stands in for the mainland part.
  let best = shapes.areas[k] ?? 0
  let most = -1
  for (let p = shapes.areas[k] ?? 0; p < (shapes.areas[k + 1] ?? 0); p++) {
    const ring = shapes.polygons[p] ?? 0
    const size = (shapes.rings[ring + 1] ?? 0) - (shapes.rings[ring] ?? 0)
    if (size > most) {
      most = size
      best = p
    }
  }
  const ring = shapes.polygons[best] ?? 0
  const from = shapes.rings[ring] ?? 0
  const to = shapes.rings[ring + 1] ?? 0
  let x = 0
  let y = 0
  for (let v = from; v < to; v++) {
    x += pixels[v * 2] ?? 0
    y += pixels[v * 2 + 1] ?? 0
  }
  const n = Math.max(to - from, 1)
  return [x / n, y / n]
}
