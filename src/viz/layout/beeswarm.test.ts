import { describe, expect, it } from 'vitest'
import { beeswarm } from './beeswarm.ts'

describe('beeswarm', () => {
  it('places circles without overlap, at their values, NaN left out', () => {
    const values = [1, 1, 1, 2, Number.NaN, 1.01, 3]
    const radius = 0.05
    const { xy, domain } = beeswarm(values, radius)
    expect(domain).toEqual([1, 3])
    expect(Number.isNaN(xy[8] ?? 0)).toBe(true)
    const points = values
      .map((v, i) => ({ i, x: xy[i * 2] ?? Number.NaN, y: xy[i * 2 + 1] ?? Number.NaN, v }))
      .filter((p) => Number.isFinite(p.v))
    for (const p of points) expect(p.x).toBeCloseTo((p.v - 1) / 2, 6)
    const gaps = points.flatMap((a) =>
      points.filter((b) => a.i < b.i).map((b) => Math.hypot(a.x - b.x, a.y - b.y)),
    )
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2 * radius - 1e-6)
    expect(beeswarm(values, radius).xy).toEqual(xy)
  })
})
