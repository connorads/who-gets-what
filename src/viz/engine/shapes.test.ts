import { describe, expect, it } from 'vitest'
import { BundleHeader, type ShapesBundle } from '#/domain/bundle.ts'
import { AreaOrderHash, dataPath, parseAreasMeta } from '#/domain/contract.ts'
import { parseBundle } from '#/domain/bundle.ts'
import { fileSource, hasPulledRelease } from '#/data/testing/file-source.ts'
import { RELEASE } from '#/data/source.ts'
import {
  areaBoxes,
  closedRings,
  extrusion,
  hitShapes,
  mapShapes,
  shapeColours,
  shapeMeta,
  subsetShapes,
} from './shapes.ts'

const header = BundleHeader.parse({
  kind: 'shapes',
  release: '2026-10-07.1',
  level: 'constituency',
  areaCount: 2,
  areaOrderHash: AreaOrderHash.parse('43d588a123b537d8'),
  bounds: [
    [0, 0],
    [65.535, 65.535],
  ],
  sections: [],
})
if (header.kind !== 'shapes') throw new Error('shapes header')

/**
 * Area 0: a 10 by 10 square with a 2 by 2 hole. Area 1: a triangle and a
 * square island. Coordinates are in thousandths, so xy steps are 0.001.
 */
const bundle: ShapesBundle = {
  kind: 'shapes',
  header,
  // Square, hole, triangle, island.
  xy: Uint16Array.from(
    [
      [0, 0, 10_000, 0, 10_000, 10_000, 0, 10_000],
      [4000, 4000, 4000, 6000, 6000, 6000, 6000, 4000],
      [20_000, 0, 30_000, 0, 20_000, 10_000],
      [40_000, 0, 42_000, 0, 42_000, 2000, 40_000, 2000],
    ].flat(),
  ),
  rings: Uint32Array.of(0, 4, 8, 11, 15),
  polygons: Uint32Array.of(0, 2, 3, 4),
  areas: Uint32Array.of(0, 1, 3),
  // The holed square in eight triangles; local indices.
  triangles: Uint16Array.from(
    [
      [0, 1, 7, 0, 7, 4, 0, 4, 5, 0, 5, 3, 1, 2, 6, 1, 6, 7, 2, 3, 5, 2, 5, 6],
      [0, 1, 2],
      [0, 1, 2, 0, 2, 3],
    ].flat(),
  ),
  polygonTriangles: Uint32Array.of(0, 8, 9, 11),
}

describe('mapShapes', () => {
  const shapes = mapShapes(bundle)

  it('turns 16-bit steps into degrees and local triangles into global ones', () => {
    expect(shapes.lonLat[2]).toBeCloseTo(10, 5)
    expect(shapes.lonLat[17]).toBeCloseTo(0, 5)
    expect(Array.from(shapes.indices.subarray(24, 27))).toEqual([8, 9, 10])
    expect(Array.from(shapes.indices.subarray(27))).toEqual([11, 12, 13, 11, 13, 14])
    expect(Array.from(shapes.areaTriangles)).toEqual([0, 8, 11])
    expect(Array.from(shapes.areaOf)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1])
  })

  it('keeps one area alone with its own offsets and the level’s area index', () => {
    const one = subsetShapes(shapes, [1])

    expect(Array.from(one.rings)).toEqual([0, 3, 7])
    expect(Array.from(one.polygons)).toEqual([0, 1, 2])
    expect(Array.from(one.areas)).toEqual([0, 2])
    expect(Array.from(one.indices)).toEqual([0, 1, 2, 3, 4, 5, 3, 5, 6])
    expect(Array.from(one.areaOf)).toEqual([1, 1, 1, 1, 1, 1, 1])
    expect(one.lonLat[0]).toBeCloseTo(20, 5)
  })

  it('closes every ring for hairlines, holes included', () => {
    const paths = closedRings(shapes)

    expect(paths.length).toBe(4)
    expect(Array.from(paths.startIndices)).toEqual([0, 5, 10, 14])
    const value = paths.attributes.getPath.value
    expect([value[8], value[9]]).toEqual([value[0], value[1]])
  })

  it('shifts triangle indices past each closing vertex for extrusion', () => {
    const solid = extrusion(shapes)

    expect(solid.length).toBe(4)
    expect(Array.from(solid.areaOfRing)).toEqual([0, 0, 1, 1])
    // Vertex 8 (the triangle's first) sits after two closed rings of five.
    expect(Array.from(solid.attributes.indices.subarray(24, 27))).toEqual([10, 11, 12])
    expect(Array.from(solid.attributes.indices.subarray(27, 30))).toEqual([14, 15, 16])
    const value = solid.attributes.getPolygon.value
    for (const index of solid.attributes.indices) {
      expect(index).toBeLessThan(value.length / 2)
    }
  })

  it('finds an area under a pixel, but not in its hole', () => {
    // Pixels: x right, y down; here one pixel per degree, flipped.
    const pixels = Float32Array.from(shapes.lonLat, (v, i) => (i % 2 === 0 ? v : 100 - v))
    const boxes = areaBoxes(shapes, pixels)

    expect(hitShapes(shapes, pixels, boxes, 1, 99)).toBe(0)
    expect(hitShapes(shapes, pixels, boxes, 5, 95)).toBe(-1)
    expect(hitShapes(shapes, pixels, boxes, 41, 99)).toBe(1)
    expect(hitShapes(shapes, pixels, boxes, 35, 99)).toBe(-1)
  })

  it('spreads per-area colours and styles to every vertex', () => {
    const colours = shapeColours(Uint8Array.of(1, 2, 3, 255, 9, 9, 9, 255), shapes.areaOf)

    expect(Array.from(colours.subarray(28, 36))).toEqual([1, 2, 3, 255, 9, 9, 9, 255])
    expect(Array.from(shapeMeta(Uint8Array.of(0, 2), shapes.areaOf).subarray(14, 18))).toEqual([
      0, 0, 1, 2,
    ])
  })
})

describe.skipIf(!hasPulledRelease)('shapes over the pulled release', () => {
  it('cover every constituency and keep London’s 75 seats together for the inset', async () => {
    const metaBody = await fileSource.json(dataPath.areas(RELEASE, 'constituency'))
    if (!metaBody.ok) throw new Error('areas missing')
    const meta = parseAreasMeta(metaBody.value)
    if (!meta.ok) throw new Error('areas invalid')
    const body = await fileSource.bytes(dataPath.shapes(RELEASE, 'constituency'))
    if (!body.ok) throw new Error('shapes missing')
    const parsed = parseBundle(body.value, meta.value.areaOrderHash)
    if (!parsed.ok || parsed.value.kind !== 'shapes') throw new Error('not a shapes bundle')
    const shapes = mapShapes(parsed.value)

    const london = meta.value.areas.flatMap((area, i) => (area.region === 'E12000007' ? [i] : []))
    const inset = subsetShapes(shapes, london)

    expect(london).toHaveLength(75)
    expect(new Set(inset.areaOf)).toEqual(new Set(london))
    expect(Math.max(...inset.indices)).toBeLessThan(inset.lonLat.length / 2)
    const [[west, south], [east, north]] = meta.value.regions.find(
      (region) => region.code === 'E12000007',
    )?.bounds ?? [
      [0, 0],
      [0, 0],
    ]
    for (let i = 0; i < inset.lonLat.length; i += 2) {
      expect(inset.lonLat[i]).toBeGreaterThan(west - 0.001)
      expect(inset.lonLat[i]).toBeLessThan(east + 0.001)
      expect(inset.lonLat[i + 1]).toBeGreaterThan(south - 0.001)
      expect(inset.lonLat[i + 1]).toBeLessThan(north + 0.001)
    }
  })
})
