import { describe, expect, it } from 'vitest'
import { BenefitFamily } from '#/domain/benefit.ts'
import { FiscalYear } from '#/domain/period.ts'
import { hasPulledRelease, pulledSiteData } from '#/data/testing/file-source.ts'
import { hexLayout } from '#/viz/layout/views.ts'
import type { FilmData } from '../data.ts'
import { loadFilmData } from '../data.ts'
import { filmFigures } from '../figures.ts'
import { SCRIPT } from '../script.ts'
import { allocateGrains, apportion, groupCounts } from './allocate.ts'
import { random, seedOf } from './random.ts'
import {
  dequantise,
  heapProfile,
  heapScene,
  hexFrame,
  hexGrid,
  hexScene,
  landScene,
  maskScene,
  quantise,
  wallLayout,
  wallScene,
} from './scenes.ts'

/** Three areas; each family spends £(f + 1) billion split 1:2:3 between them, nominal. */
function syntheticData(): FilmData {
  const families = BenefitFamily.options
  const n = 3
  const familySpend = new Float32Array(families.length * n)
  families.forEach((_, f) => {
    for (let i = 0; i < n; i++) familySpend[f * n + i] = ((f + 1) * 1e9 * (i + 1)) / 6
  })
  const groupOf = new Map(
    SCRIPT.groups.flatMap((group) => group.families.map((family) => [family, group.id] as const)),
  )
  return {
    period: FiscalYear.parse('2024-25'),
    priceBase: '2026-27',
    realFactor: 1,
    areas: [0, 1, 2].map((i) => ({
      code: `E1400000${i}`,
      name: `Area ${i}`,
      slug: `area-${i}`,
      nation: 'england',
      q: i,
      r: i % 2,
      lon: -1 - i,
      lat: 51 + i,
    })),
    mapBounds: [
      [-4, 51],
      [-1, 54],
    ],
    mapSprite: '/data/test/layout/constituency/map.svg',
    families,
    familySpend,
    perResident: Float32Array.of(1, 2, 3),
    pensionerPerAged66Plus: Float32Array.of(3, 2, 1),
    workingAgePerAged16To64: Float32Array.of(1, 3, 2),
    shareAged66Plus: Float32Array.of(0.1, 0.2, 0.3),
    familyGroup: families.map((family) => groupOf.get(family) ?? 'working-age-housing'),
  }
}

const unitPoints = (buffer: Uint16Array): [number, number][] =>
  Array.from({ length: buffer.length / 2 }, (_, i) => [
    dequantise(buffer[i * 2] ?? 0),
    dequantise(buffer[i * 2 + 1] ?? 0),
  ])

const take = (next: () => number) => Array.from({ length: 5 }, next)

describe('random', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = random(seedOf('x'))
    const b = random(seedOf('x'))
    const c = random(seedOf('y'))
    const first = take(a)
    expect(take(b)).toEqual(first)
    expect(take(c)).not.toEqual(first)
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true)
  })
})

describe('apportion', () => {
  it('shares whole units exactly, largest remainder first, ties to the lower index', () => {
    expect([...apportion([1, 1, 1], 4)]).toEqual([2, 1, 1])
    expect([...apportion([5, 3, 2], 7)]).toEqual([4, 2, 1])
    expect([...apportion([Number.NaN, 0, 2], 3)]).toEqual([0, 0, 3])
    expect([...apportion([0, 0], 5)]).toEqual([0, 0])
  })
})

describe('allocateGrains', () => {
  const data = syntheticData()
  const grains = allocateGrains(data, 1e8)

  it('gives each family round(total / unit) grains, shared across areas in proportion', () => {
    grains.blocks.forEach((block) => {
      expect(block.count).toBe((block.family + 1) * 10)
      const perArea = [0, 1, 2].map(
        (a) =>
          grains.area.subarray(block.start, block.start + block.count).filter((x) => x === a)
            .length,
      )
      const exact = [1, 2, 3].map((k) => (block.count * k) / 6)
      perArea.forEach((count, a) => expect(Math.abs(count - (exact[a] ?? 0))).toBeLessThan(1))
    })
    expect(grains.count).toBe(grains.blocks.reduce((sum, block) => sum + block.count, 0))
  })

  it('orders grains by group, then by family size within a group', () => {
    const groups = grains.blocks.map((block) => block.group)
    expect([...new Set(groups)]).toEqual(SCRIPT.groups.map((group) => group.id))
    const pairs = grains.blocks.slice(1).map((b, i) => [grains.blocks[i], b] as const)
    for (const [a, b] of pairs) expect(b.start).toBe((a?.start ?? 0) + (a?.count ?? 0))
    const sameGroup = pairs.filter(([a, b]) => a?.group === b.group)
    for (const [a, b] of sameGroup) expect(a?.count ?? 0).toBeGreaterThanOrEqual(b.count)
    for (const block of grains.blocks) {
      const families = grains.family.subarray(block.start, block.start + block.count)
      expect(families.every((f) => f === block.family)).toBe(true)
    }
  })

  it('is deterministic', () => {
    const again = allocateGrains(data, 1e8)
    expect(again.key).toEqual(grains.key)
    expect(again.area).toEqual(grains.area)
  })
})

describe('scenes', () => {
  const grains = allocateGrains(syntheticData(), 1e8)

  it('quantises to 16 bits and clamps outside the frame', () => {
    expect([quantise(-1), quantise(0), quantise(0.5), quantise(2)]).toEqual([0, 0, 32768, 65535])
    expect(dequantise(quantise(0.25))).toBeCloseTo(0.25, 4)
  })

  it('heaps grains under the mound, the first to fall lowest', () => {
    const points = unitPoints(heapScene(grains))
    for (const [x, y] of points) expect(1 - y).toBeLessThanOrEqual(heapProfile(x) + 1e-4)
    const byKey = Array.from(grains.key.keys()).toSorted(
      (a, b) => (grains.key[a] ?? 0) - (grains.key[b] ?? 0) || a - b,
    )
    const heights = byKey.map((grain) => points[grain]?.[1] ?? 0)
    for (let k = 1; k < heights.length; k++) {
      expect(heights[k] ?? 0).toBeLessThanOrEqual((heights[k - 1] ?? 0) + 1e-4)
    }
  })

  it('stacks the wall bottom up, a block starting a fresh column after a gap', () => {
    const layout = wallLayout(grains, 10)
    const points = unitPoints(wallScene(grains, layout))
    const first = grains.blocks[0]
    const second = grains.blocks[1]
    expect(first !== undefined && second !== undefined).toBe(true)
    const column = (grain: number) => Math.floor((points[grain]?.[0] ?? 0) * layout.columns)
    expect(column(0)).toBe(0)
    expect(points[0]?.[1]).toBeCloseTo(0.95, 3)
    expect(column(10)).toBe(1)
    const spanA = layout.blocks[0]
    const spanB = layout.blocks[1]
    expect((spanB?.start ?? 0) - (spanA?.end ?? 0)).toBeGreaterThanOrEqual(1)
    expect(column(second?.start ?? 0)).toBe(spanB?.start)
    expect(layout.columns).toBe(layout.blocks.at(-1)?.end)
  })

  it('lands every grain inside its own area hexagon, where hexLayout draws it', () => {
    const cells = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
    ]
    const grid = hexGrid(cells)
    const stage = { x: 16, y: 16, width: 600, height: 400 }
    const frame = hexFrame(grid, stage)
    const layout = hexLayout(cells, stage, 6)
    for (let i = 0; i < cells.length; i++) {
      const x = frame.x + ((grid.centres[i * 2] ?? 0) / grid.width) * frame.width
      const y = frame.y + ((grid.centres[i * 2 + 1] ?? 0) / grid.height) * frame.height
      expect(x).toBeCloseTo(layout.centres[i * 2] ?? 0, 3)
      expect(y).toBeCloseTo(layout.centres[i * 2 + 1] ?? 0, 3)
    }
    const points = unitPoints(hexScene(grains, grid))
    points.forEach(([u, v], grain) => {
      const area = grains.area[grain] ?? 0
      const dx = u * grid.width - (grid.centres[area * 2] ?? 0)
      const dy = v * grid.height - (grid.centres[area * 2 + 1] ?? 0)
      expect(Math.hypot(dx, dy)).toBeLessThan(0.9)
    })
  })

  it('lands every grain inside its own area on the real map', () => {
    // Three areas as unit-frame squares of 4 points: left, middle, right.
    const points = 4
    const rings = Float32Array.from(
      [0.05, 0.4, 0.75].flatMap((x) => [x, 0.4, x + 0.2, 0.4, x + 0.2, 0.6, x, 0.6]),
    )
    const landed = unitPoints(landScene(grains, rings, points))
    landed.forEach(([u, v], grain) => {
      const x = [0.05, 0.4, 0.75][grains.area[grain] ?? 0] ?? 0
      expect(u).toBeGreaterThanOrEqual(x - 1e-4)
      expect(u).toBeLessThanOrEqual(x + 0.2 + 1e-4)
      expect(v).toBeGreaterThanOrEqual(0.4 - 1e-4)
      expect(v).toBeLessThanOrEqual(0.6 + 1e-4)
    })
    expect(landScene(grains, rings, points)).toEqual(landScene(grains, rings, points))
  })

  it('starts poster grains on inked pixels only', () => {
    const width = 8
    const height = 4
    const alpha = new Uint8Array(width * height)
    alpha[1 * width + 2] = 255
    alpha[2 * width + 5] = 255
    const points = unitPoints(maskScene(grains, alpha, width, height))
    for (const [u, v] of points) {
      const px = Math.floor(u * width)
      const py = Math.floor(v * height)
      expect(alpha[py * width + px]).toBe(255)
    }
  })
})

describe.runIf(hasPulledRelease)('grains from the pulled release', () => {
  it('count the year in £10m grains, with group shares matching the figures', async () => {
    const data = await loadFilmData(pulledSiteData(), SCRIPT)
    const figures = filmFigures(data)
    const grains = allocateGrains(data, 1e7)
    expect(Math.abs(grains.count - figures.total / 1e7)).toBeLessThan(13)
    for (const [group, count] of groupCounts(grains)) {
      const share = (figures.byGroup.get(group) ?? 0) / figures.total
      expect(Math.abs(count / grains.count - share)).toBeLessThan(0.001)
    }
    expect(Math.max(...grains.area)).toBe(data.areas.length - 1)
  })
})
