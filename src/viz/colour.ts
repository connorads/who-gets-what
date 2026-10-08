/**
 * Value to colour, by the job the colour does. Magnitudes use the one-hue
 * brass ramp; differences from a modelled level use brass (above) through a
 * neutral middle to pewter (below). Both are binned, so the legend can list
 * every class, and both read their colours from the design tokens.
 */

export type ScaleKind = 'sequential' | 'diverging'

export const SEQUENTIAL_STEPS = 6
export const DIVERGING_STEPS = 9
/** Bin index for an area with no value. */
export const NO_VALUE = 255

/** Token per sequential bin, lightest (lowest) first. */
export const SEQUENTIAL_TOKENS = [
  '--seq-brass-1',
  '--seq-brass-2',
  '--seq-brass-3',
  '--seq-brass-4',
  '--seq-brass-5',
  '--seq-brass-6',
] as const

/**
 * Token per diverging bin, most below first. The middle class takes the
 * neutral token rather than paper, so a mark at zero stays visible on the
 * paper stage.
 */
export const DIVERGING_TOKENS = [
  '--div-9',
  '--div-8',
  '--div-7',
  '--div-6',
  '--div-neutral',
  '--div-4',
  '--div-3',
  '--div-2',
  '--div-1',
] as const

export const NO_VALUE_TOKEN = '--sunken'

export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const position = (sorted.length - 1) * p
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const a = sorted[lower] ?? Number.NaN
  const b = sorted[upper] ?? Number.NaN
  return a + (b - a) * (position - lower)
}

/**
 * The range the colours span: the 2nd to 98th percentile, so one outlier does
 * not wash out every other area. Diverging domains are symmetric about zero.
 */
export function colourDomain(
  values: ArrayLike<number>,
  kind: ScaleKind,
): readonly [number, number] {
  const finite = Array.from(values)
    .filter((value) => Number.isFinite(value))
    .toSorted((a, b) => a - b)
  if (finite.length === 0) return [0, 1]
  const low = quantile(finite, 0.02)
  const high = quantile(finite, 0.98)
  if (kind === 'diverging') {
    const extent = Math.max(Math.abs(low), Math.abs(high)) || 1
    return [-extent, extent]
  }
  return low === high ? [low, low + 1] : [low, high]
}

/** Upper edge of each bin but the last, in value units, for the legend. */
export function binEdges(domain: readonly [number, number], kind: ScaleKind): readonly number[] {
  const steps = kind === 'sequential' ? SEQUENTIAL_STEPS : DIVERGING_STEPS
  const [low, high] = domain
  return Array.from({ length: steps - 1 }, (_, i) => low + ((high - low) * (i + 1)) / steps)
}

/** The bin for one value; values beyond the domain take the end bins. */
export function binOf(value: number, domain: readonly [number, number], kind: ScaleKind): number {
  if (!Number.isFinite(value)) return NO_VALUE
  const steps = kind === 'sequential' ? SEQUENTIAL_STEPS : DIVERGING_STEPS
  const [low, high] = domain
  const t = (value - low) / (high - low)
  return Math.min(steps - 1, Math.max(0, Math.floor(t * steps)))
}

export function binAll(
  values: ArrayLike<number>,
  domain: readonly [number, number],
  kind: ScaleKind,
): Uint8Array {
  return Uint8Array.from(Array.from(values), (value) => binOf(value, domain, kind))
}

export function tokenOf(bin: number, kind: ScaleKind): string {
  if (bin === NO_VALUE) return NO_VALUE_TOKEN
  const tokens = kind === 'sequential' ? SEQUENTIAL_TOKENS : DIVERGING_TOKENS
  return tokens[bin] ?? NO_VALUE_TOKEN
}

/** Metrics that publish actual less modelled spending take the diverging scale. */
export function scaleKindOf(metricId: string): ScaleKind {
  return metricId.endsWith('-vs-model') ? 'diverging' : 'sequential'
}

/** `#rrggbb` or `rgb(r, g, b)` (as computed styles report colours) to bytes. */
export function parseColour(text: string): readonly [number, number, number] | undefined {
  const hex = /^#([0-9a-f]{6})$/i.exec(text.trim())
  if (hex !== null) {
    const n = Number.parseInt(hex[1] ?? '0', 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(text.trim())
  if (rgb !== null) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(text.trim())
  if (srgb !== null) {
    return [
      Math.round(Number(srgb[1]) * 255),
      Math.round(Number(srgb[2]) * 255),
      Math.round(Number(srgb[3]) * 255),
    ]
  }
  return undefined
}
