/**
 * Messages between the film and its grain worker. Each side checks what it
 * receives, since a message arrives untyped.
 */
import type { FilmData } from '../data.ts'
import type { HexCell } from '#/viz/layout/views.ts'
import type { GrainBlock } from './allocate.ts'
import type { SceneId, WallLayout } from './scenes.ts'

export type WorkerIn =
  | {
      readonly type: 'build'
      readonly data: FilmData
      readonly unit: number
      readonly rows: number
      readonly cells: readonly HexCell[]
      /** Every area's boundary ring in the map's unit frame, `points` vertices each. */
      readonly land: Float32Array
      readonly points: number
    }
  | {
      readonly type: 'poster'
      readonly unit: number
      /** Distinguishes masks drawn for different stage sizes. */
      readonly stamp: number
      readonly alpha: Uint8Array
      readonly width: number
      readonly height: number
    }

export type WorkerOut =
  | {
      readonly type: 'grains'
      readonly unit: number
      readonly keys: Uint16Array
      readonly family: Uint8Array
      readonly blocks: readonly GrainBlock[]
      readonly wall: WallLayout
    }
  | {
      readonly type: 'scene'
      readonly id: SceneId
      readonly unit: number
      readonly positions: Uint16Array
      readonly stamp?: number
    }

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined

const SCENES = new Set(['poster', 'heap', 'wall', 'hex', 'map'])

function isScene(value: unknown): value is SceneId {
  return typeof value === 'string' && SCENES.has(value)
}

function isBlock(value: unknown): value is GrainBlock {
  return (
    typeof field(value, 'family') === 'number' &&
    typeof field(value, 'group') === 'string' &&
    typeof field(value, 'start') === 'number' &&
    typeof field(value, 'count') === 'number'
  )
}

function isWall(value: unknown): value is WallLayout {
  const blocks = field(value, 'blocks')
  return (
    typeof field(value, 'rows') === 'number' &&
    typeof field(value, 'columns') === 'number' &&
    Array.isArray(blocks)
  )
}

export function readWorkerOut(data: unknown): WorkerOut | undefined {
  const type = field(data, 'type')
  const unit = field(data, 'unit')
  if (typeof unit !== 'number') return undefined
  if (type === 'grains') {
    const keys = field(data, 'keys')
    const family = field(data, 'family')
    const blocks = field(data, 'blocks')
    const wall = field(data, 'wall')
    if (
      keys instanceof Uint16Array &&
      family instanceof Uint8Array &&
      Array.isArray(blocks) &&
      blocks.every(isBlock) &&
      isWall(wall)
    ) {
      return { type, unit, keys, family, blocks, wall }
    }
    return undefined
  }
  const id = field(data, 'id')
  const positions = field(data, 'positions')
  const stamp = field(data, 'stamp')
  if (type === 'scene' && isScene(id) && positions instanceof Uint16Array) {
    return { type, id, unit, positions, ...(typeof stamp === 'number' ? { stamp } : {}) }
  }
  return undefined
}

export function readWorkerIn(data: unknown): WorkerIn | undefined {
  const type = field(data, 'type')
  const unit = field(data, 'unit')
  if (typeof unit !== 'number') return undefined
  if (type === 'poster') {
    const alpha = field(data, 'alpha')
    const width = field(data, 'width')
    const height = field(data, 'height')
    const stamp = field(data, 'stamp')
    if (
      alpha instanceof Uint8Array &&
      typeof width === 'number' &&
      typeof height === 'number' &&
      typeof stamp === 'number'
    ) {
      return { type, unit, alpha, width, height, stamp }
    }
    return undefined
  }
  const payload = field(data, 'data')
  const rows = field(data, 'rows')
  const cells = field(data, 'cells')
  const land = field(data, 'land')
  const points = field(data, 'points')
  if (
    type === 'build' &&
    typeof rows === 'number' &&
    Array.isArray(cells) &&
    land instanceof Float32Array &&
    typeof points === 'number' &&
    isFilmData(payload)
  ) {
    return {
      type,
      unit,
      rows,
      land,
      points,
      cells: cells.flatMap((cell: unknown): HexCell[] => {
        const q = field(cell, 'q')
        const r = field(cell, 'r')
        return typeof q === 'number' && typeof r === 'number' ? [{ q, r }] : []
      }),
      data: payload,
    }
  }
  return undefined
}

/** Structured clone keeps the typed arrays; a shallow check is enough between our own threads. */
function isFilmData(value: unknown): value is FilmData {
  return (
    field(value, 'familySpend') instanceof Float32Array &&
    Array.isArray(field(value, 'areas')) &&
    Array.isArray(field(value, 'families')) &&
    Array.isArray(field(value, 'familyGroup')) &&
    typeof field(value, 'realFactor') === 'number'
  )
}
