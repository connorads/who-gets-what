/**
 * Builds grain buffers off the main thread and streams them back one scene at
 * a time, in the order the film needs them, so no build lands in a scroll
 * frame. Buffers are transferred, not copied.
 */
import type { FilmData } from '../data.ts'
import type { HexCell } from '#/viz/layout/views.ts'
import { allocateGrains, type GrainSet } from './allocate.ts'
import { readWorkerIn, type WorkerOut } from './messages.ts'
import {
  heapScene,
  hexGrid,
  hexScene,
  landScene,
  maskScene,
  wallLayout,
  wallScene,
} from './scenes.ts'

let grains: GrainSet | undefined

function send(message: WorkerOut, transfer: Transferable[]): void {
  globalThis.postMessage(message, { transfer })
}

function build(
  data: FilmData,
  unit: number,
  rows: number,
  cells: readonly HexCell[],
  land: Float32Array,
  points: number,
): void {
  const set = allocateGrains(data, unit)
  grains = set
  const wall = wallLayout(set, rows)
  const keys = set.key.slice()
  const family = set.family.slice()
  send({ type: 'grains', unit, keys, family, blocks: set.blocks, wall }, [
    keys.buffer,
    family.buffer,
  ])
  const heap = heapScene(set)
  send({ type: 'scene', id: 'heap', unit, positions: heap }, [heap.buffer])
  const stacked = wallScene(set, wall)
  send({ type: 'scene', id: 'wall', unit, positions: stacked }, [stacked.buffer])
  const map = landScene(set, land, points)
  send({ type: 'scene', id: 'map', unit, positions: map }, [map.buffer])
  const hex = hexScene(set, hexGrid(cells))
  send({ type: 'scene', id: 'hex', unit, positions: hex }, [hex.buffer])
}

globalThis.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = readWorkerIn(event.data)
  if (message === undefined) return
  if (message.type === 'build') {
    build(message.data, message.unit, message.rows, message.cells, message.land, message.points)
    return
  }
  if (grains === undefined || grains.unit !== message.unit) return
  const positions = maskScene(grains, message.alpha, message.width, message.height)
  send({ type: 'scene', id: 'poster', unit: message.unit, positions, stamp: message.stamp }, [
    positions.buffer,
  ])
})
