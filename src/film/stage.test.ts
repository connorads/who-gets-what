import { describe, expect, it } from 'vitest'
import { DUCK, parseCaptionWords, parseManifest } from './audio.ts'
import { readWorkerIn, readWorkerOut } from './grains/messages.ts'
import { SCRIPT } from './script.ts'
import {
  drawFor,
  grainRadius,
  resolveLand,
  heapRect,
  sceneRadius,
  wallRect,
  wipe,
  WALL_ROWS,
  type StageContext,
} from './stage.ts'
import { frameAt, restProgress, spans } from './timeline.ts'

const size = { width: 1440, height: 900 }

const context: StageContext = {
  size,
  home: { longitude: -3, latitude: 55, zoom: 5 },
  hexFrame: { x: 400, y: 60, width: 600, height: 760 },
  mapFrame: { x: 420, y: 50, width: 560, height: 800 },
  shapeMix: 1,
  wallColumns: 3000,
  grainCount: 300_000,
  guess: [20, 30, 50],
  selected: -1,
  skylines: {
    pensioner: { heights: Float32Array.of(1, 0), colours: new Uint8Array(8).fill(10) },
    'working-age': { heights: Float32Array.of(0, 1), colours: new Uint8Array(8).fill(250) },
  },
  areaX: Float32Array.of(0, 1),
  camera: undefined,
  outline: 0,
}

const all = spans(SCRIPT)
const at = (id: string) => restProgress(all.find((span) => span.id === id) ?? all[0]!)
const order = { skylineOrder: ['pensioner', 'working-age'] } as const

describe('the rain onto land', () => {
  const rain = frameAt(all, at('the-rain'), order).grains

  it('lands grains on the real map by default and on hexes for equal-size areas', () => {
    expect(rain?.to).toBe('land')
    if (rain === undefined) return
    expect(resolveLand(rain, 1).to).toBe('map')
    expect(resolveLand(rain, 0).to).toBe('hex')
    expect(drawFor(frameAt(all, at('the-rain'), order), context).grains?.toFrame).toEqual([
      420, 50, 560, 800,
    ])
  })

  it('moves resting grains from the hexes to the map as the shape switch tweens', () => {
    if (rain === undefined) return
    const resting = { ...rain, t: 1 }
    expect(resolveLand(resting, 0.25)).toMatchObject({ from: 'hex', to: 'map', t: 0.25, arc: 0 })
  })
})

describe('stage layout', () => {
  it('rests the heap inside the stage, above the letterbox', () => {
    const heap = heapRect(size)
    expect(heap.x).toBeGreaterThan(0)
    expect(heap.x + heap.width).toBeLessThan(size.width)
    expect(heap.y + heap.height).toBeCloseTo(size.height * 0.86)
  })

  it('pans a long wall from its start to its end, on whole pixels', () => {
    const start = wallRect(size, 3000, 0)
    const end = wallRect(size, 3000, 1)
    expect(start.height / WALL_ROWS).toBe(Math.floor(start.height / WALL_ROWS))
    expect(start.x).toBe(Math.round(size.width * 0.08))
    expect(end.x + end.width).toBeCloseTo(size.width * 0.92, 0)
    expect(Number.isInteger(wallRect(size, 3000, 0.37).x)).toBe(true)
  })

  it('centres a wall that fits and never pans it', () => {
    const short = wallRect(size, 50, 0)
    expect(wallRect(size, 50, 1)).toEqual(short)
    expect(short.x * 2 + short.width).toBeCloseTo(size.width, 0)
  })

  it('sizes grains to fill the heap and fill their wall cells', () => {
    expect(grainRadius(size, 300_000)).toBeLessThan(grainRadius(size, 30_000))
    const pitch = wallRect(size, 3000, 0).height / WALL_ROWS
    // Past half the cell's diagonal, so no paper shows between neighbours.
    expect(sceneRadius('wall', context)).toBeGreaterThan(pitch * Math.SQRT1_2)
  })

  it('wipes the second skyline in from west to east', () => {
    expect([wipe(0, 0), wipe(0, 1)]).toEqual([0, 0])
    expect([wipe(1, 0), wipe(1, 1)]).toEqual([1, 1])
    expect(wipe(0.5, 0)).toBeGreaterThan(wipe(0.5, 1))
  })
})

describe('drawFor', () => {
  it('puts the reader’s guess on the grains as key thresholds', () => {
    const draw = drawFor(frameAt(all, at('your-split'), order), context)
    expect(draw.grains?.guess).toEqual([0.2, 0.5])
    expect(draw.grains?.guessTint).toBe(1)
  })

  it('rains from the wall where the pan left it', () => {
    const rain = all.find((span) => span.id === 'the-rain') ?? all[0]!
    const draw = drawFor(frameAt(all, rain.start, order), context)
    const wall = wallRect(size, context.wallColumns, 1)
    expect(draw.grains?.fromFrame).toEqual([wall.x, wall.y, wall.width, wall.height])
    expect(draw.grains?.toFrame).toEqual([420, 50, 560, 800])
  })

  it('mixes skyline heights and tilts the camera only in the skyline chapter', () => {
    const draw = drawFor(frameAt(all, at('two-skylines'), order), context)
    expect(Array.from(draw.skyline?.heights ?? [])).toEqual([0, 1])
    // The skyline extrudes the reader's shape, so on the map it raises the real land.
    expect(draw.skyline?.layout).toBe('shape')
    expect(draw.camera.pitch).toBeCloseTo(52)
    const flat = drawFor(frameAt(all, at('the-rain'), order), context)
    expect(flat.skyline).toBeUndefined()
    expect(flat.camera.pitch).toBe(0)
  })

  it('outlines real land only at rest', () => {
    const resting = drawFor(frameAt(all, at('the-rain'), order), { ...context, outline: 1 })
    expect(resting.areas?.outline).toBe(1)
    const moving = drawFor(frameAt(all, at('north-south-or-age'), order), {
      ...context,
      outline: 1,
    })
    expect(moving.areas?.outline).toBe(0)
  })

  it('flies the landing camera when one is given', () => {
    const camera = { longitude: -2.2, latitude: 53.5, zoom: 9, pitch: 0, bearing: 0 }
    expect(drawFor(frameAt(all, at('the-landing'), order), { ...context, camera }).camera).toBe(
      camera,
    )
  })
})

describe('audio manifest', () => {
  it('keeps the entries a player can use and reads caption words', () => {
    const items = parseManifest({
      items: [
        {
          id: 'pour-1',
          kind: 'narration',
          file: '/a.webm',
          fallback: '/a.m4a',
          durationMs: 1200,
          captions: '/a.json',
        },
        { id: 'bad', kind: 'video', file: '/b', fallback: '/b', durationMs: 1 },
        {
          id: 'bed',
          kind: 'ambience',
          file: '/c.webm',
          fallback: '/c.m4a',
          durationMs: 30_000,
          loop: true,
        },
      ],
    })
    expect(items.map((item) => [item.id, item.loop])).toEqual([
      ['pour-1', false],
      ['bed', true],
    ])
    expect(parseManifest(null)).toEqual([])
    expect(
      parseCaptionWords({ words: [{ text: 'In', startMs: 84, endMs: 244 }, { text: 3 }] }),
    ).toEqual([{ text: 'In', startMs: 84, endMs: 244 }])
    expect(DUCK.narrating).toBeLessThan(DUCK.clear)
  })
})

describe('worker messages', () => {
  it('accept well-formed messages and drop the rest', () => {
    const scene = { type: 'scene', id: 'heap', unit: 1e7, positions: new Uint16Array(4) }
    expect(readWorkerOut(scene)).toEqual(scene)
    expect(readWorkerOut({ ...scene, id: 'moon' })).toBeUndefined()
    expect(readWorkerOut({ ...scene, positions: [1, 2] })).toBeUndefined()
    const poster = {
      type: 'poster',
      unit: 1e7,
      stamp: 2,
      alpha: new Uint8Array(4),
      width: 2,
      height: 2,
    }
    expect(readWorkerIn(poster)).toEqual(poster)
    expect(readWorkerIn({ ...poster, stamp: '2' })).toBeUndefined()
  })
})
