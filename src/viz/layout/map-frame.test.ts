import { describe, expect, it } from 'vitest'
import { dataPath, parseAreasMeta } from '#/domain/contract.ts'
import { parseBundle } from '#/domain/bundle.ts'
import { fileSource, hasPulledRelease } from '#/data/testing/file-source.ts'
import { RELEASE } from '#/data/source.ts'
import { mapShapes } from '../engine/shapes.ts'
import {
  INSET_REGION,
  SEA_SLOTS,
  allIntoInset,
  boxOnStage,
  fitCameraIn,
  inRect,
  intoInset,
  mapFrame,
  type InsetFrame,
} from './map-frame.ts'
import { projectAll, type Bounds, type Rect } from './projection.ts'

// Great Britain and London as the release draws them.
const GB: Bounds = [
  [-8.65, 49.8825],
  [1.7637, 60.8454],
]
const LONDON: Bounds = [
  [-0.5104, 51.2868],
  [0.334, 51.6919],
]

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const inside = (inner: Rect, outer: Rect, slack = 0.5): boolean =>
  inner.x >= outer.x - slack &&
  inner.y >= outer.y - slack &&
  inner.x + inner.width <= outer.x + outer.width + slack &&
  inner.y + inner.height <= outer.y + outer.height + slack

describe('fitCameraIn', () => {
  it('centres the bounds in the rectangle and fills one of its sides', () => {
    const size = { width: 1000, height: 600 }
    const rect = { x: 100, y: 20, width: 400, height: 560 }

    const box = boxOnStage(fitCameraIn(GB, size, rect), size, GB)

    expect(box.x + box.width / 2).toBeCloseTo(300, 6)
    expect(box.y + box.height / 2).toBeCloseTo(300, 6)
    expect(Math.max(box.width / rect.width, box.height / rect.height)).toBeCloseTo(1, 6)
  })
})

describe('mapFrame', () => {
  it('puts the inset beside Great Britain on a wide stage, larger than the map draws London', () => {
    const size = { width: 960, height: 640 }

    const { camera, inset } = mapFrame(size, GB, LONDON, 16)

    expect(inset).toBeDefined()
    if (inset === undefined) return
    const land = boxOnStage(camera, size, GB)
    expect(overlaps(inset.rect, land)).toBe(false)
    expect(inside(inset.rect, { x: 16, y: 16, width: 928, height: 608 })).toBe(true)
    expect(inside(land, { x: 16, y: 16, width: 928, height: 608 })).toBe(true)
    expect(inset.scale).toBeGreaterThan(6)
    // The source frames London on the main map.
    expect(inside(boxOnStage(camera, size, LONDON), inset.source)).toBe(true)
  })

  it('puts the inset over open sea on a phone held upright', () => {
    const size = { width: 358, height: 600 }

    const { camera, inset } = mapFrame(size, GB, LONDON, 16)

    expect(inset).toBeDefined()
    if (inset === undefined) return
    const slots = SEA_SLOTS.map((slot) => boxOnStage(camera, size, slot))
    expect(slots.some((slot) => inside(inset.rect, slot))).toBe(true)
    expect(inset.scale).toBeGreaterThan(1.8)
  })

  it('gives London a third of a phone-wide stage, using the sea out to the stage edge', () => {
    const size = { width: 358, height: 608 }

    const { camera, inset } = mapFrame(size, GB, LONDON, 16)

    expect(inset).toBeDefined()
    if (inset === undefined) return
    expect(inset.rect.width).toBeGreaterThanOrEqual(326 / 3)
    expect(inside(inset.rect, { x: 16, y: 16, width: 326, height: 576 })).toBe(true)
    expect(overlaps(inset.rect, boxOnStage(camera, size, LONDON))).toBe(false)
  })

  it('draws the map alone without a region or room for a useful inset', () => {
    expect(mapFrame({ width: 800, height: 600 }, GB, undefined, 16).inset).toBeUndefined()
    expect(mapFrame({ width: 60, height: 60 }, GB, LONDON, 16).inset).toBeUndefined()
  })
})

describe('intoInset', () => {
  const inset: InsetFrame = {
    rect: { x: 500, y: 100, width: 200, height: 100 },
    source: { x: 50, y: 60, width: 20, height: 10 },
    scale: 10,
  }

  it('maps the source rectangle onto the inset rectangle', () => {
    expect(intoInset(inset, 50, 60)).toEqual([500, 100])
    expect(intoInset(inset, 70, 70)).toEqual([700, 200])
    expect(Array.from(allIntoInset(inset, Float32Array.of(60, 65)))).toEqual([600, 150])
    expect(inRect(inset.rect, 600, 150)).toBe(true)
    expect(inRect(inset.rect, 499, 150)).toBe(false)
  })
})

describe.skipIf(!hasPulledRelease)('the map frame over the pulled release', () => {
  for (const level of ['constituency', 'local-authority'] as const) {
    it(`keeps every ${level} out of the sea slots and frames London from the metadata`, async () => {
      const metaBody = await fileSource.json(dataPath.areas(RELEASE, level))
      if (!metaBody.ok) throw new Error('areas missing')
      const meta = parseAreasMeta(metaBody.value)
      if (!meta.ok) throw new Error('areas invalid')
      const body = await fileSource.bytes(dataPath.shapes(RELEASE, level))
      if (!body.ok) throw new Error('shapes missing')
      const parsed = parseBundle(body.value, meta.value.areaOrderHash)
      if (!parsed.ok || parsed.value.kind !== 'shapes') throw new Error('not a shapes bundle')
      const shapes = mapShapes(parsed.value)

      for (const [[west, south], [east, north]] of SEA_SLOTS) {
        for (let i = 0; i < shapes.lonLat.length; i += 2) {
          const lon = shapes.lonLat[i] ?? 0
          const lat = shapes.lonLat[i + 1] ?? 0
          expect(lon > west && lon < east && lat > south && lat < north).toBe(false)
        }
      }
      const london = meta.value.regions.find((region) => region.code === INSET_REGION)
      expect(london?.bounds).toBeDefined()
      const size = { width: 960, height: 640 }
      const frame = mapFrame(size, meta.value.bounds, london?.bounds, 16)
      const pixels = projectAll(frame.camera, size, shapes.lonLat)
      for (let i = 0; i < pixels.length; i += 2) {
        expect(
          inRect({ x: 15, y: 15, width: 930, height: 610 }, pixels[i] ?? 0, pixels[i + 1] ?? 0),
        ).toBe(true)
      }
    })
  }
})
