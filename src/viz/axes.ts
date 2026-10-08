/**
 * Axis ticks for the swarm and rank views, shared by the canvas overlay and
 * the server-rendered SVG so both label the same values.
 */
import { scaleLinear, scaleLog } from '@visx/scale'

export interface Tick {
  /** Position along the axis, 0 to 1. */
  readonly at: number
  /** Value in the reader's basis. */
  readonly value: number
}

/**
 * Ticks for a swarm domain. `domain` is nominal, as the swarm bundle stores
 * it; `factor` converts to the reader's basis for the labels only, since a
 * basis change multiplies every value by the same factor and so leaves
 * positions unchanged.
 */
export function swarmTicks(
  domain: readonly [number, number],
  scale: 'linear' | 'log',
  factor: number,
  count: number,
): readonly Tick[] {
  const [d0, d1] = domain
  if (scale === 'log' && d0 > 0 && d1 > d0) {
    const log = scaleLog({ domain: [d0 * factor, d1 * factor], range: [0, 1] })
    return log
      .ticks(count)
      .filter((_, i, all) => all.length <= count + 1 || i % Math.ceil(all.length / count) === 0)
      .map((value) => ({ at: log(value), value }))
  }
  const linear = scaleLinear({ domain: [d0 * factor, d1 * factor], range: [0, 1] })
  return linear.ticks(count).map((value) => ({ at: linear(value), value }))
}

/** Ticks for the rank view's value axis, from zero. */
export function rankTicks(domain: readonly [number, number], count: number): readonly Tick[] {
  const linear = scaleLinear({ domain: [domain[1], domain[0]], range: [0, 1] })
  return linear.ticks(count).map((value) => ({ at: linear(value), value }))
}
