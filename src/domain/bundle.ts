/**
 * Binary bundles (`.bin`): per-metric values and precomputed layouts, keyed by
 * the level's stable area order. Layout, little-endian:
 *
 *   0   4 bytes  magic "TADB"
 *   4   u16      format version (1)
 *   6   u16      reserved, 0
 *   8   u32      header length H in bytes
 *   12  H bytes  header, UTF-8 JSON (see BundleHeader)
 *   then each header section in order, each starting at the next multiple of 4
 *
 * The file ends exactly where the last section ends. Typed arrays view the
 * buffer without copying, so every target platform must be little-endian.
 */
import { z } from 'zod/mini'
import { BenefitFamily } from './benefit.ts'
import { AreaOrderHash, LonLatBounds, ReleaseId } from './contract.ts'
import { GeoLevel } from './geography.ts'
import { Denominator, MetricId, RateScale, Unit } from './measure.ts'
import { Month, PeriodKind } from './period.ts'
import { err, ok, type Result } from './result.ts'

export const BUNDLE_MAGIC = 'TADB'
export const BUNDLE_FORMAT_VERSION = 1
const PREAMBLE_BYTES = 12

const Section = z.strictObject({
  name: z.string(),
  dtype: z.enum(['f32', 'u8', 'u16', 'u32']),
  length: z.int().check(z.minimum(0)),
})

const common = {
  release: ReleaseId,
  level: GeoLevel,
  areaCount: z.int().check(z.minimum(1)),
  areaOrderHash: AreaOrderHash,
  sections: z.array(Section),
}

/**
 * `values` (f32) and `flags` (u8), each periods x areas, period-major: the
 * value for period p and area i is at p * areaCount + i. NaN means no value.
 * `gbp` values are nominal; the app applies the reader's basis.
 */
const SeriesHeader = z.strictObject({
  kind: z.literal('series'),
  ...common,
  metric: MetricId,
  denominator: Denominator,
  unit: Unit,
  rateScale: RateScale,
  periodKind: PeriodKind,
  periods: z.array(z.string()).check(z.minLength(1)),
})

/**
 * `xy` (f32), periods x areas x 2. x is the value's position in the period's
 * domain, 0 to 1; y is the offset from the axis in the same units. Circles of
 * `radius` (same units) do not overlap. NaN marks an area with no value.
 */
const SwarmHeader = z.strictObject({
  kind: z.literal('swarm'),
  ...common,
  metric: MetricId,
  denominator: Denominator,
  periodKind: PeriodKind,
  periods: z.array(z.string()).check(z.minLength(1)),
  scale: z.enum(['linear', 'log']),
  domains: z.array(z.tuple([z.number(), z.number()])),
  radius: z.number().check(z.positive()),
})

/**
 * `lonLat` (f32), areas x pointsPerRing x 2: each area's largest polygon ring,
 * resampled to equal arc length, starting at its northernmost point and running
 * clockwise, so ring-to-hex morphs pair vertices consistently.
 */
const RingsHeader = z.strictObject({
  kind: z.literal('rings'),
  ...common,
  pointsPerRing: z.int().check(z.minimum(3)),
})

/**
 * Every polygon of every area for the map: islands, exclaves and holes.
 * `xy` (u16), vertices x 2: steps of 1/65535 across `bounds`, longitude then
 * latitude. Each ring lists its vertices once; a polygon's outer ring runs
 * counter-clockwise, then its holes clockwise. `rings`, `polygons` and
 * `areas` (u32) are start offsets with a final end entry: ring r is
 * vertices rings[r] to rings[r + 1], polygon p is rings polygons[p] to
 * polygons[p + 1], and area a (in area order) is polygons areas[a] to
 * areas[a + 1]. `triangles` (u16) cover each polygon, three indices each
 * from the polygon's first vertex; polygon p owns triangles
 * polygonTriangles[p] to polygonTriangles[p + 1] (u32).
 */
const ShapesHeader = z.strictObject({
  kind: z.literal('shapes'),
  ...common,
  bounds: LonLatBounds,
})

/**
 * Change decomposition inputs for one benefit family, `from` then `to`, each
 * 2 x areas, month-major: `population` (eligible band), `claimants` and
 * `meanWeeklyAward` (nominal pounds) as f32, then `flags` (u8, one per area).
 * NaN marks an area without every input. The catalogue's `decomposition`
 * entry names the band and claimant unit; `decompose` computes the effects.
 */
const DecompositionHeader = z.strictObject({
  kind: z.literal('decomposition'),
  ...common,
  family: BenefitFamily,
  from: Month,
  to: Month,
})

export const BundleHeader = z.discriminatedUnion('kind', [
  SeriesHeader,
  SwarmHeader,
  RingsHeader,
  ShapesHeader,
  DecompositionHeader,
])
export type BundleHeader = z.infer<typeof BundleHeader>
export type SeriesHeader = z.infer<typeof SeriesHeader>
export type SwarmHeader = z.infer<typeof SwarmHeader>
export type RingsHeader = z.infer<typeof RingsHeader>
export type ShapesHeader = z.infer<typeof ShapesHeader>
export type DecompositionHeader = z.infer<typeof DecompositionHeader>

export interface SeriesBundle {
  readonly kind: 'series'
  readonly header: SeriesHeader
  readonly values: Float32Array
  readonly flags: Uint8Array
}

export interface SwarmBundle {
  readonly kind: 'swarm'
  readonly header: SwarmHeader
  readonly xy: Float32Array
}

export interface RingsBundle {
  readonly kind: 'rings'
  readonly header: RingsHeader
  readonly lonLat: Float32Array
}

export interface ShapesBundle {
  readonly kind: 'shapes'
  readonly header: ShapesHeader
  readonly xy: Uint16Array
  readonly rings: Uint32Array
  readonly polygons: Uint32Array
  readonly areas: Uint32Array
  readonly triangles: Uint16Array
  readonly polygonTriangles: Uint32Array
}

export interface DecompositionBundle {
  readonly kind: 'decomposition'
  readonly header: DecompositionHeader
  readonly population: Float32Array
  readonly claimants: Float32Array
  readonly meanWeeklyAward: Float32Array
  readonly flags: Uint8Array
}

export type Bundle = SeriesBundle | SwarmBundle | RingsBundle | ShapesBundle | DecompositionBundle

export type BundleError =
  | { readonly kind: 'bad-magic' }
  | { readonly kind: 'unsupported-version'; readonly version: number }
  | { readonly kind: 'truncated'; readonly expectedBytes: number; readonly actualBytes: number }
  | { readonly kind: 'bad-header'; readonly problems: readonly string[] }
  | { readonly kind: 'section-mismatch'; readonly problems: readonly string[] }
  | {
      readonly kind: 'area-order-mismatch'
      readonly expected: AreaOrderHash
      readonly actual: AreaOrderHash
    }

const align4 = (offset: number): number => Math.ceil(offset / 4) * 4

const BYTES_PER = { f32: 4, u8: 1, u16: 2, u32: 4 } as const

type Dtype = keyof typeof BYTES_PER

interface ExpectedSection {
  readonly name: string
  readonly dtype: Dtype
  /** Undefined where the header does not fix it; `shapeProblems` checks those lengths. */
  readonly length: number | undefined
}

function expectedSections(header: BundleHeader): readonly ExpectedSection[] {
  if (header.kind === 'series') {
    const cells = header.periods.length * header.areaCount
    return [
      { name: 'values', dtype: 'f32', length: cells },
      { name: 'flags', dtype: 'u8', length: cells },
    ]
  }
  if (header.kind === 'swarm') {
    return [{ name: 'xy', dtype: 'f32', length: header.periods.length * header.areaCount * 2 }]
  }
  if (header.kind === 'decomposition') {
    const pairs = header.areaCount * 2
    return [
      { name: 'population', dtype: 'f32', length: pairs },
      { name: 'claimants', dtype: 'f32', length: pairs },
      { name: 'meanWeeklyAward', dtype: 'f32', length: pairs },
      { name: 'flags', dtype: 'u8', length: header.areaCount },
    ]
  }
  if (header.kind === 'shapes') {
    return [
      { name: 'xy', dtype: 'u16', length: undefined },
      { name: 'rings', dtype: 'u32', length: undefined },
      { name: 'polygons', dtype: 'u32', length: undefined },
      { name: 'areas', dtype: 'u32', length: header.areaCount + 1 },
      { name: 'triangles', dtype: 'u16', length: undefined },
      { name: 'polygonTriangles', dtype: 'u32', length: undefined },
    ]
  }
  return [{ name: 'lonLat', dtype: 'f32', length: header.areaCount * header.pointsPerRing * 2 }]
}

function sectionProblems(header: BundleHeader): readonly string[] {
  const expected = expectedSections(header)
  const shapeProblems =
    header.kind === 'swarm' && header.domains.length !== header.periods.length
      ? ['domains: one per period']
      : []
  if (header.sections.length !== expected.length) {
    return [...shapeProblems, `sections: expected ${expected.map((s) => s.name).join(', ')}`]
  }
  return [
    ...shapeProblems,
    ...expected.flatMap((want, i) => {
      const got = header.sections[i]
      return got !== undefined &&
        got.name === want.name &&
        got.dtype === want.dtype &&
        (want.length === undefined || got.length === want.length)
        ? []
        : [`sections.${i}: expected ${want.name} ${want.dtype} x ${want.length ?? 'n'}`]
    }),
  ]
}

/**
 * Parse a bundle. Pass the area order hash from the matching areas metadata;
 * a bundle built for another area order is rejected rather than misread.
 */
export function parseBundle(
  buffer: ArrayBuffer,
  areaOrderHash: AreaOrderHash,
): Result<Bundle, BundleError> {
  if (buffer.byteLength < PREAMBLE_BYTES) {
    return err({ kind: 'truncated', expectedBytes: PREAMBLE_BYTES, actualBytes: buffer.byteLength })
  }
  const bytes = new Uint8Array(buffer)
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== BUNDLE_MAGIC)
    return err({ kind: 'bad-magic' })
  const view = new DataView(buffer)
  const version = view.getUint16(4, true)
  if (version !== BUNDLE_FORMAT_VERSION) return err({ kind: 'unsupported-version', version })
  const headerEnd = PREAMBLE_BYTES + view.getUint32(8, true)
  if (headerEnd > buffer.byteLength) {
    return err({ kind: 'truncated', expectedBytes: headerEnd, actualBytes: buffer.byteLength })
  }

  const header = decodeHeader(bytes.subarray(PREAMBLE_BYTES, headerEnd))
  if (!header.ok) return header
  if (header.value.areaOrderHash !== areaOrderHash) {
    return err({
      kind: 'area-order-mismatch',
      expected: areaOrderHash,
      actual: header.value.areaOrderHash,
    })
  }
  const problems = sectionProblems(header.value)
  if (problems.length > 0) return err({ kind: 'section-mismatch', problems })

  const offsets: number[] = []
  let end = headerEnd
  for (const section of header.value.sections) {
    const start = align4(end)
    offsets.push(start)
    end = start + section.length * BYTES_PER[section.dtype]
  }
  if (end !== buffer.byteLength) {
    return err({ kind: 'truncated', expectedBytes: end, actualBytes: buffer.byteLength })
  }

  const f32 = (i: number) => new Float32Array(buffer, offsets[i], header.value.sections[i]?.length)
  const u8 = (i: number) => new Uint8Array(buffer, offsets[i], header.value.sections[i]?.length)
  const u16 = (i: number) => new Uint16Array(buffer, offsets[i], header.value.sections[i]?.length)
  const u32 = (i: number) => new Uint32Array(buffer, offsets[i], header.value.sections[i]?.length)
  const parsed = header.value
  if (parsed.kind === 'series')
    return ok({ kind: 'series', header: parsed, values: f32(0), flags: u8(1) })
  if (parsed.kind === 'swarm') return ok({ kind: 'swarm', header: parsed, xy: f32(0) })
  if (parsed.kind === 'decomposition') {
    return ok({
      kind: 'decomposition',
      header: parsed,
      population: f32(0),
      claimants: f32(1),
      meanWeeklyAward: f32(2),
      flags: u8(3),
    })
  }
  if (parsed.kind === 'shapes') {
    const shapes: ShapesBundle = {
      kind: 'shapes',
      header: parsed,
      xy: u16(0),
      rings: u32(1),
      polygons: u32(2),
      areas: u32(3),
      triangles: u16(4),
      polygonTriangles: u32(5),
    }
    const shapeProblems = shapesProblems(shapes)
    return shapeProblems.length === 0
      ? ok(shapes)
      : err({ kind: 'section-mismatch', problems: shapeProblems })
  }
  return ok({ kind: 'rings', header: parsed, lonLat: f32(0) })
}

/** Offsets that run from zero, never fall, and end where the next level's array ends. */
function offsetProblems(name: string, offsets: Uint32Array, end: number): readonly string[] {
  if (offsets[0] !== 0 || offsets.at(-1) !== end) return [`${name}: must run from 0 to ${end}`]
  return offsets.every((value, i) => i === 0 || value >= (offsets[i - 1] ?? 0))
    ? []
    : [`${name}: offsets must not fall`]
}

function shapesProblems(shapes: ShapesBundle): readonly string[] {
  const { xy, rings, polygons, areas, triangles, polygonTriangles } = shapes
  const problems = [
    ...(xy.length % 2 === 0 ? [] : ['xy: one pair per vertex']),
    ...(triangles.length % 3 === 0 ? [] : ['triangles: three indices each']),
    ...(polygonTriangles.length === polygons.length ? [] : ['polygonTriangles: one per polygon']),
    ...offsetProblems('rings', rings, xy.length / 2),
    ...offsetProblems('polygons', polygons, rings.length - 1),
    ...offsetProblems('areas', areas, polygons.length - 1),
    ...offsetProblems('polygonTriangles', polygonTriangles, triangles.length / 3),
  ]
  if (problems.length > 0) return problems
  for (let p = 0; p + 1 < polygons.length; p++) {
    const size = (rings[polygons[p + 1] ?? 0] ?? 0) - (rings[polygons[p] ?? 0] ?? 0)
    for (let t = (polygonTriangles[p] ?? 0) * 3; t < (polygonTriangles[p + 1] ?? 0) * 3; t++) {
      if ((triangles[t] ?? 0) >= size) return [`triangles: polygon ${p} indexes past its vertices`]
    }
  }
  return []
}

function decodeHeader(bytes: Uint8Array): Result<BundleHeader, BundleError> {
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (cause) {
    return err({ kind: 'bad-header', problems: [String(cause)] })
  }
  const parsed = BundleHeader.safeParse(json)
  if (!parsed.success) {
    return err({
      kind: 'bad-header',
      problems: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    })
  }
  return ok(parsed.data)
}

/** One period's values and flags as zero-copy views, ready for GPU attribute upload. */
export function periodSlice(
  bundle: SeriesBundle,
  periodIndex: number,
): { readonly values: Float32Array; readonly flags: Uint8Array } {
  const n = bundle.header.areaCount
  const start = periodIndex * n
  return {
    values: bundle.values.subarray(start, start + n),
    flags: bundle.flags.subarray(start, start + n),
  }
}
