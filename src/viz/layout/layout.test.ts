import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  fitCamera,
  project,
  projectAll,
  unproject,
  unprojectAll,
  type Bounds,
} from './projection.ts'
import {
  circleRing,
  hexRing,
  hitTest,
  mixInto,
  rectRing,
  resampleClosed,
  ringCentre,
} from './rings.ts'
import { hexLayout, mapLayout, rankLayout, rankOrder, swarmLayout } from './views.ts'

const GB: Bounds = [
  [-8.2, 49.9],
  [1.8, 60.9],
]
const SIZE = { width: 800, height: 900 }
const POINTS = 64

/** Shoelace sum over packed screen pixels: positive for clockwise on screen. */
function signedArea(rings: Float32Array, area: number, points: number): number {
  let sum = 0
  for (let k = 0; k < points; k++) {
    const j = (k + 1) % points
    const i0 = (area * points + k) * 2
    const i1 = (area * points + j) * 2
    sum += (rings[i0] ?? 0) * (rings[i1 + 1] ?? 0) - (rings[i1] ?? 0) * (rings[i0 + 1] ?? 0)
  }
  return sum / 2
}

function ringBox(rings: Float32Array, area: number, points: number) {
  const xs: number[] = []
  const ys: number[] = []
  for (let k = 0; k < points; k++) {
    xs.push(rings[(area * points + k) * 2] ?? 0)
    ys.push(rings[(area * points + k) * 2 + 1] ?? 0)
  }
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  }
}

describe('projection', () => {
  it('round-trips longitude and latitude through pixels', () => {
    const camera = fitCamera(GB, SIZE, 16)
    for (const [lon, lat] of [
      [-3.19, 55.95],
      [1.3, 52.6],
      [-5.7, 50.06],
    ] as const) {
      const [x, y] = project(camera, SIZE, lon, lat)
      const [lon2, lat2] = unproject(camera, SIZE, x, y)
      expect(lon2).toBeCloseTo(lon, 6)
      expect(lat2).toBeCloseTo(lat, 6)
    }
  })

  it('fits the bounds inside the padding and touches one pair of edges', () => {
    const camera = fitCamera(GB, SIZE, 16)
    const [x0, y0] = project(camera, SIZE, GB[0][0], GB[1][1])
    const [x1, y1] = project(camera, SIZE, GB[1][0], GB[0][1])

    expect(x0).toBeGreaterThanOrEqual(15.99)
    expect(y0).toBeGreaterThanOrEqual(15.99)
    expect(x1).toBeLessThanOrEqual(SIZE.width - 15.99)
    expect(y1).toBeLessThanOrEqual(SIZE.height - 15.99)
    expect(Math.min(x0 - 16, y0 - 16)).toBeCloseTo(0, 3)
  })

  it('projects packed arrays like single points', () => {
    const camera = fitCamera(GB, SIZE, 0)
    const lonLat = Float32Array.from([-3, 55, 0, 51])
    const pixels = projectAll(camera, SIZE, lonLat)
    const [x, y] = project(camera, SIZE, 0, 51)

    expect(pixels[2]).toBeCloseTo(x, 3)
    expect(pixels[3]).toBeCloseTo(y, 3)
    const back = unprojectAll(camera, SIZE, pixels)
    lonLat.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 4))
    expect(boundsOf(lonLat)).toEqual([
      [-3, 51],
      [0, 55],
    ])
  })
})

describe('rings', () => {
  it('resamples a closed polygon to equal arc lengths from its first vertex', () => {
    const out = new Float32Array(8)
    resampleClosed([0, 0, 4, 0, 4, 4, 0, 4], 4, out, 0)

    expect(Array.from(out)).toEqual([0, 0, 4, 0, 4, 4, 0, 4])
  })

  it.each([
    ['hex', (out: Float32Array) => hexRing(50, 50, 10, POINTS, out, 0)],
    ['circle', (out: Float32Array) => circleRing(50, 50, 10, POINTS, out, 0)],
    ['rect', (out: Float32Array) => rectRing(40, 40, 60, 60, POINTS, out, 0)],
  ])('starts a %s ring at its top centre and runs clockwise on screen', (_, draw) => {
    const out = new Float32Array(POINTS * 2)
    draw(out)

    expect(out[0]).toBeCloseTo(50, 4)
    expect(out[1]).toBeCloseTo(40, 4)
    expect(signedArea(out, 0, POINTS)).toBeGreaterThan(0)
    expect(ringCentre(out, 0, POINTS)[0]).toBeCloseTo(50, 0)
  })

  it('draws a rect ring with its four corners as vertices, even when it is thin', () => {
    const out = new Float32Array(POINTS * 2)
    rectRing(10, 20, 11.3, 300, POINTS, out, 0)
    const at = (k: number) => [out[k * 2], out[k * 2 + 1]]

    expect(at(POINTS / 8)).toEqual([11.3, 20].map(Math.fround))
    expect(at((3 * POINTS) / 8)).toEqual([11.3, 300].map(Math.fround))
    expect(at((5 * POINTS) / 8)).toEqual([10, 300])
    expect(at((7 * POINTS) / 8)).toEqual([10, 20])
    for (let k = 0; k < POINTS; k++) {
      const [x = 0, y = 0] = at(k)
      const onEdge = y === 20 || y === Math.fround(300) || x === 10 || x === Math.fround(11.3)
      expect(onEdge).toBe(true)
    }
    const ys = Array.from({ length: POINTS }, (_, k) => at(k)[1] ?? 0)
    expect(Math.max(...ys)).toBe(300)
    expect(Math.min(...ys)).toBe(20)
  })

  it('hit-tests the topmost ring under a point', () => {
    const rings = new Float32Array(2 * POINTS * 2)
    rectRing(0, 0, 10, 10, POINTS, rings, 0)
    rectRing(5, 5, 15, 15, POINTS, rings, POINTS * 2)

    expect(hitTest(rings, 2, POINTS, 2, 2)).toBe(0)
    expect(hitTest(rings, 2, POINTS, 7, 7)).toBe(1)
    expect(hitTest(rings, 2, POINTS, 20, 20)).toBe(-1)
  })

  it('mixes packed arrays linearly', () => {
    const out = new Float32Array(2)
    mixInto(out, Float32Array.from([0, 10]), Float32Array.from([10, 30]), 0.25)

    expect(Array.from(out)).toEqual([2.5, 15])
  })
})

describe('views', () => {
  const stage = { x: 10, y: 10, width: 400, height: 600 }

  it('lays hexes out on the odd-r grid without overlap, north at the top', () => {
    const cells = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: 0, r: -1 },
    ]
    const layout = hexLayout(cells, stage, POINTS)
    const centre = (i: number): [number, number] => [
      layout.centres[i * 2] ?? 0,
      layout.centres[i * 2 + 1] ?? 0,
    ]
    const [x0, y0] = centre(0)
    const [x1] = centre(1)
    const [x2, y2] = centre(2)
    const [, y3] = centre(3)

    expect(x1 - x0).toBeCloseTo(Math.sqrt(3) * layout.cellRadius, 3)
    expect(x2 - x0).toBeCloseTo((Math.sqrt(3) / 2) * layout.cellRadius, 3)
    expect(y2).toBeLessThan(y0)
    expect(y3).toBeGreaterThan(y0)
    for (let i = 0; i < cells.length; i++) {
      const box = ringBox(layout.rings, i, POINTS)
      expect(box.left).toBeGreaterThanOrEqual(stage.x - 1e-3)
      expect(box.right).toBeLessThanOrEqual(stage.x + stage.width + 1e-3)
      expect(box.top).toBeGreaterThanOrEqual(stage.y - 1e-3)
      expect(box.bottom).toBeLessThanOrEqual(stage.y + stage.height + 1e-3)
    }
  })

  it('puts swarm areas with no value in a tray instead of removing them', () => {
    const xy = Float32Array.from([0, 0, 1, 0.01, Number.NaN, Number.NaN])
    const layout = swarmLayout(xy, 0.01, stage, POINTS)

    expect(layout.centres[0]).toBeCloseTo(stage.x, 3)
    expect(layout.centres[2]).toBeCloseTo(stage.x + stage.width, 3)
    expect(layout.centres[3]).toBeLessThan(layout.axis.cross)
    expect(layout.centres[5]).toBeGreaterThan(layout.axis.cross)
    expect(Number.isFinite(layout.rings[4 * POINTS])).toBe(true)
  })

  it('runs the swarm up a tall stage, low values at the bottom', () => {
    const xy = Float32Array.from([0, 0, 1, 0.01])
    const layout = swarmLayout(xy, 0.01, stage, POINTS, true)

    expect(layout.axis.vertical).toBe(true)
    expect(layout.centres[1]).toBeCloseTo(stage.y + stage.height, 3)
    expect(layout.centres[3]).toBeCloseTo(stage.y, 3)
    expect(layout.centres[2]).toBeGreaterThan(layout.axis.cross)
    expect(layout.radius).toBeCloseTo(0.01 * stage.height * 0.9, 3)
  })

  it('orders rank bars highest first, with no value last and bars that do not overlap', () => {
    const values = Float32Array.from([3, Number.NaN, 10, -2])
    const layout = rankLayout(values, stage, POINTS)

    expect(Array.from(layout.order)).toEqual([2, 0, 3, 1])
    expect(Array.from(rankOrder(values))).toEqual([2, 0, 3, 1])
    const boxes = Array.from(layout.order, (area) => ringBox(layout.rings, area, POINTS))
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]?.left ?? 0).toBeGreaterThanOrEqual((boxes[i - 1]?.right ?? 0) - 1e-3)
    }
    const height = (area: number) => {
      const box = ringBox(layout.rings, area, POINTS)
      return box.bottom - box.top
    }
    expect(height(2) / height(0)).toBeCloseTo(10 / 3, 2)
    expect(ringBox(layout.rings, 3, POINTS).top).toBeCloseTo(layout.baseline, 3)
  })

  it('projects boundary rings for the map view', () => {
    const camera = fitCamera(GB, SIZE, 0)
    const lonLat = new Float32Array(POINTS * 2)
    rectRing(-3, 55, -2, 54, POINTS, lonLat, 0)
    const layout = mapLayout(lonLat, camera, SIZE, 1, POINTS)
    const [x, y] = project(camera, SIZE, lonLat[0] ?? 0, lonLat[1] ?? 0)

    expect(layout.rings[0]).toBeCloseTo(x, 3)
    expect(layout.rings[1]).toBeCloseTo(y, 3)
  })
})
