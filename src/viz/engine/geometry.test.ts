import { describe, expect, it } from 'vitest'
import { RELEASE } from '#/data/source.ts'
import { fileSource, hasPulledRelease } from '#/data/testing/file-source.ts'
import { parseBundle } from '#/domain/bundle.ts'
import { dataPath, parseAreasMeta } from '#/domain/contract.ts'
import { GeoLevel } from '#/domain/geography.ts'
import { circleRing, rectRing } from '../layout/rings.ts'
import { MOTION, rulersTimeline, stagePlan } from '../motion.ts'
import { mixBytesInto, perVertexColours, perVertexMeta, triangulate } from './geometry.ts'

const POINTS = 16

/** Total unsigned area of the triangles over packed pixel rings. */
function triangleArea(indices: Uint32Array, rings: Float32Array): number {
  let total = 0
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0]
    const ax = rings[a * 2] ?? 0
    const ay = rings[a * 2 + 1] ?? 0
    const cross =
      ((rings[b * 2] ?? 0) - ax) * ((rings[c * 2 + 1] ?? 0) - ay) -
      ((rings[c * 2] ?? 0) - ax) * ((rings[b * 2 + 1] ?? 0) - ay)
    total += Math.abs(cross) / 2
  }
  return total
}

describe('triangulate', () => {
  it('cuts each ring into points minus two triangles over its own vertices', () => {
    const rings = new Float32Array(2 * POINTS * 2)
    rectRing(0, 0, 10, 10, POINTS, rings, 0)
    circleRing(30, 30, 5, POINTS, rings, POINTS * 2)
    const indices = triangulate(rings, 2, POINTS)

    expect(indices).toHaveLength(2 * (POINTS - 2) * 3)
    expect(Math.max(...indices.subarray(0, (POINTS - 2) * 3))).toBeLessThan(POINTS)
    expect(Math.min(...indices.subarray((POINTS - 2) * 3))).toBeGreaterThanOrEqual(POINTS)
  })

  it('keeps a boundary triangulation valid once the ring becomes a circle', () => {
    const boundary = new Float32Array(POINTS * 2)
    // An L-shaped, concave boundary.
    const l = [0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10]
    for (let k = 0; k < POINTS; k++) {
      const v = Math.floor((k * 6) / POINTS)
      boundary[k * 2] = l[v * 2] ?? 0
      boundary[k * 2 + 1] = l[v * 2 + 1] ?? 0
    }
    const indices = triangulate(boundary, 1, POINTS)
    const circle = new Float32Array(POINTS * 2)
    circleRing(0, 0, 10, POINTS, circle, 0)
    const polygonArea = (POINTS / 2) * 100 * Math.sin((2 * Math.PI) / POINTS)

    expect(triangleArea(indices, circle)).toBeCloseTo(polygonArea, 3)
  })

  it('keeps a self-crossing boundary inside its outline and whole as a circle', () => {
    // An L of 10 by 10 less a 6 by 6 notch (area 64), with a small twist in its
    // bottom edge, as a resampled coastline can have. A fan from one point
    // would reach across the notch.
    const boundary = Float32Array.from([
      0, 0, 4, 0, 6, 1, 6, -1, 5, 1, 10, 0, 10, 2, 10, 4, 7, 4, 4, 4, 4, 7, 4, 10, 2, 10, 0, 10, 0,
      7, 0, 3,
    ])
    const indices = triangulate(boundary, 1, POINTS)
    const circle = new Float32Array(POINTS * 2)
    circleRing(0, 0, 10, POINTS, circle, 0)
    const polygonArea = (POINTS / 2) * 100 * Math.sin((2 * Math.PI) / POINTS)

    expect(indices).toHaveLength((POINTS - 2) * 3)
    expect(triangleArea(indices, boundary)).toBeLessThan(66)
    expect(triangleArea(indices, circle)).toBeCloseTo(polygonArea, 3)
  })
})

describe.skipIf(!hasPulledRelease)('triangulate over the pulled release', () => {
  for (const level of GeoLevel.options) {
    it(`covers every ${level} ring exactly once when it becomes a circle`, async () => {
      const metaBody = await fileSource.json(dataPath.areas(RELEASE, level))
      if (!metaBody.ok) throw new Error('areas missing')
      const meta = parseAreasMeta(metaBody.value)
      if (!meta.ok) throw new Error('areas invalid')
      const body = await fileSource.bytes(dataPath.rings(RELEASE, level))
      if (!body.ok) throw new Error('rings missing')
      const parsed = parseBundle(body.value, meta.value.areaOrderHash)
      if (!parsed.ok || parsed.value.kind !== 'rings') throw new Error('not a rings bundle')
      const { header, lonLat } = parsed.value
      const points = header.pointsPerRing
      const indices = triangulate(lonLat, header.areaCount, points)
      const circle = new Float32Array(points * 2)
      circleRing(0, 0, 10, points, circle, 0)
      const polygonArea = (points / 2) * 100 * Math.sin((2 * Math.PI) / points)
      const per = (points - 2) * 3

      const gapped: number[] = []
      for (let area = 0; area < header.areaCount; area++) {
        const local = indices.slice(area * per, (area + 1) * per).map((i) => i - area * points)
        if (Math.abs(triangleArea(local, circle) - polygonArea) > 1e-3) gapped.push(area)
      }
      expect(gapped).toEqual([])
    })
  }
})

describe('per-vertex attributes', () => {
  it('repeats each area colour and style for every ring point', () => {
    const colours = perVertexColours(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), 2)
    const meta = perVertexMeta(Uint8Array.from([0, 3]), 2)

    expect(Array.from(colours)).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 5, 6, 7, 8])
    expect(Array.from(meta)).toEqual([0, 0, 0, 0, 1, 3, 1, 3])
  })

  it('mixes byte colours', () => {
    const out = new Uint8Array(2)
    mixBytesInto(out, Uint8Array.from([0, 100]), Uint8Array.from([255, 0]), 0.5)

    expect(Array.from(out)).toEqual([128, 50])
  })
})

describe('stagePlan', () => {
  it('moves positions before colour, with constant durations', () => {
    expect(stagePlan('view', true, true, false)).toEqual([
      { name: 'positions', start: 0, duration: MOTION.morph },
      { name: 'colour', start: MOTION.morph, duration: MOTION.colour },
    ])
    expect(stagePlan('rulers', true, true, false)[0]?.duration).toBe(0.8)
  })

  it('replaces every flight with one short cross-fade under reduced motion', () => {
    const plan = stagePlan('view', true, true, true)

    expect(plan).toEqual([{ name: 'positions', start: 0, duration: MOTION.fade }])
    expect(MOTION.fade).toBeLessThanOrEqual(0.12)
    expect(rulersTimeline(true)).toEqual({ bump: 0, list: 0 })
  })

  it('plans nothing when nothing changes', () => {
    expect(stagePlan('none', true, true, false)).toEqual([])
    expect(stagePlan('values', false, false, false)).toEqual([])
  })

  it('runs the Four rulers parts in order: dots, bump lines, list', () => {
    const { bump, list } = rulersTimeline(false)

    expect(bump).toBe(MOTION.rulers)
    expect(list).toBeGreaterThan(bump)
  })
})
