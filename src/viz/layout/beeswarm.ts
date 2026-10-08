/**
 * A one-dimensional beeswarm built in the browser, for axes the pipeline does
 * not precompute (the film's latitude and age swarms). The output has the
 * swarm bundle's shape, so `swarmLayout` places it: x from 0 to 1 across the
 * domain, y the offset from the axis in the same units, NaN for no value.
 */

export interface Beeswarm {
  /** Packed [x, y] per area. */
  readonly xy: Float32Array
  readonly radius: number
  readonly domain: readonly [number, number]
}

/**
 * Place each value on the axis, then nudge it to the nearest offset from the
 * axis, alternating sides, where its circle overlaps no circle already placed.
 * Values are placed from the lowest, ties in area order, so the result is the
 * same on every run.
 */
export function beeswarm(
  values: ArrayLike<number>,
  radius: number,
  domain?: readonly [number, number],
): Beeswarm {
  const n = values.length
  const finite: number[] = []
  for (let i = 0; i < n; i++) if (Number.isFinite(values[i] ?? Number.NaN)) finite.push(i)
  const extent: readonly [number, number] = domain ?? [
    Math.min(...finite.map((i) => values[i] ?? 0)),
    Math.max(...finite.map((i) => values[i] ?? 0)),
  ]
  const span = extent[1] - extent[0] || 1
  const xy = new Float32Array(n * 2).fill(Number.NaN)
  const order = finite.toSorted((a, b) => (values[a] ?? 0) - (values[b] ?? 0) || a - b)
  const placed: { readonly x: number; readonly y: number }[] = []
  const gap = 2 * radius
  let first = 0
  for (const i of order) {
    const x = ((values[i] ?? 0) - extent[0]) / span
    while (first < placed.length && (placed[first]?.x ?? 0) < x - gap) first += 1
    const near = placed.slice(first)
    const candidates = [0]
    for (const p of near) {
      const dx = x - p.x
      const dy = Math.sqrt(Math.max(gap * gap - dx * dx, 0))
      candidates.push(p.y + dy, p.y - dy)
    }
    candidates.sort((a, b) => Math.abs(a) - Math.abs(b) || b - a)
    const y =
      candidates.find((c) =>
        near.every((p) => (x - p.x) ** 2 + (c - p.y) ** 2 >= gap * gap - 1e-12),
      ) ?? 0
    xy[i * 2] = x
    xy[i * 2 + 1] = y
    placed.push({ x, y })
  }
  return { xy, radius, domain: extent }
}
