import { describe, expect, it } from 'vitest'
import { z } from 'zod/mini'
import { BundleHeader, parseBundle, periodSlice, type SeriesHeader } from './bundle.ts'
import { AreaOrderHash } from './contract.ts'
import { encodeBundle, readFixture, toHex } from './testing/fixtures.ts'

interface SeriesFixture {
  readonly header: SeriesHeader
  readonly values: readonly (number | null)[]
  readonly flags: readonly number[]
}

const SeriesFixtureFile = z.strictObject({
  header: BundleHeader,
  values: z.array(z.nullable(z.number())),
  flags: z.array(z.int()),
})

function seriesFixture(): SeriesFixture {
  const { header, values, flags } = SeriesFixtureFile.parse(readFixture('series-mini.json'))
  if (header.kind !== 'series') throw new Error('series-mini.json must hold a series header')
  return { header, values, flags }
}

function encodeSeries(fixture: SeriesFixture): ArrayBuffer {
  return encodeBundle(fixture.header, [
    Float32Array.from(fixture.values, (value) => value ?? Number.NaN),
    Uint8Array.from(fixture.flags),
  ])
}

const HASH = AreaOrderHash.parse('43d588a123b537d8')

describe('parseBundle', () => {
  it('matches the golden encoding shared with the pipeline', async () => {
    await expect(`${toHex(encodeSeries(seriesFixture()))}\n`).toMatchFileSnapshot(
      '../../contract/fixtures/series-mini.bin.hex',
    )
  })

  it('reads values and flags period-major against the area order', () => {
    const fixture = seriesFixture()
    const parsed = parseBundle(encodeSeries(fixture), HASH)

    expect(parsed.ok && parsed.value.kind === 'series').toBe(true)
    if (!parsed.ok || parsed.value.kind !== 'series') return
    const latest = periodSlice(parsed.value, 1)
    expect(Array.from(latest.values.subarray(0, 2))).toEqual([11000, 12000])
    expect(Number.isNaN(latest.values[2])).toBe(true)
    expect(Array.from(latest.flags)).toEqual([0, 33, 8])
    expect(parsed.value.header.periods).toEqual(['2023-24', '2024-25'])
  })

  it('rejects a bundle built for another area order', () => {
    const parsed = parseBundle(
      encodeSeries(seriesFixture()),
      AreaOrderHash.parse('0000000000000000'),
    )

    expect(parsed).toMatchObject({ ok: false, error: { kind: 'area-order-mismatch' } })
  })

  it('rejects sections that disagree with the header shape', () => {
    const fixture = seriesFixture()
    const short = encodeBundle({ ...fixture.header, periods: ['2024-25'] }, [
      new Float32Array(6),
      new Uint8Array(6),
    ])

    expect(parseBundle(short, HASH)).toMatchObject({
      ok: false,
      error: { kind: 'section-mismatch' },
    })
  })

  it('rejects truncated files, foreign files and future versions', () => {
    const buffer = encodeSeries(seriesFixture())
    const future = buffer.slice(0)
    new DataView(future).setUint16(4, 2, true)
    const foreign = buffer.slice(0)
    new Uint8Array(foreign).set([0x50, 0x4b], 0)

    expect(parseBundle(buffer.slice(0, buffer.byteLength - 1), HASH)).toMatchObject({
      ok: false,
      error: { kind: 'truncated' },
    })
    expect(parseBundle(future, HASH)).toMatchObject({
      ok: false,
      error: { kind: 'unsupported-version' },
    })
    expect(parseBundle(foreign, HASH)).toMatchObject({ ok: false, error: { kind: 'bad-magic' } })
  })

  it('reads a swarm layout with one domain per period', () => {
    const header = BundleHeader.parse({
      kind: 'swarm',
      release: '2026-10-05.1',
      level: 'constituency',
      areaCount: 3,
      areaOrderHash: HASH,
      sections: [{ name: 'xy', dtype: 'f32', length: 6 }],
      metric: 'spend-pensioner',
      denominator: 'per-aged-66-plus',
      periodKind: 'fiscal-year',
      periods: ['2024-25'],
      scale: 'linear',
      domains: [[9000, 13000]],
      radius: 0.004,
    })
    const parsed = parseBundle(
      encodeBundle(header, [Float32Array.of(0.5, 0, 0.75, 0.01, 0.25, -0.01)]),
      HASH,
    )

    expect(
      parsed.ok && parsed.value.kind === 'swarm' ? Array.from(parsed.value.xy) : [],
    ).toHaveLength(6)
  })
})

describe('decomposition bundles', () => {
  const header = BundleHeader.parse({
    kind: 'decomposition',
    release: '2026-10-06.2',
    level: 'constituency',
    areaCount: 2,
    areaOrderHash: '43d588a123b537d8',
    family: 'state-pension',
    from: '2023-02',
    to: '2026-03',
    sections: [
      { name: 'population', dtype: 'f32', length: 4 },
      { name: 'claimants', dtype: 'f32', length: 4 },
      { name: 'meanWeeklyAward', dtype: 'f32', length: 4 },
      { name: 'flags', dtype: 'u8', length: 2 },
    ],
  })

  it('read each input month-major with one flag per area', () => {
    const buffer = encodeBundle(header, [
      Float32Array.from([100, 200, 110, 210]),
      Float32Array.from([90, 180, 95, Number.NaN]),
      Float32Array.from([200, 210, 230, 240]),
      Uint8Array.from([0, 64]),
    ])
    const parsed = parseBundle(buffer, HASH)

    expect(parsed.ok && parsed.value.kind === 'decomposition').toBe(true)
    if (!parsed.ok || parsed.value.kind !== 'decomposition') return
    expect(Array.from(parsed.value.population)).toEqual([100, 200, 110, 210])
    expect(Number.isNaN(parsed.value.claimants[3])).toBe(true)
    expect(Array.from(parsed.value.flags)).toEqual([0, 64])
  })

  it('reject a flags section sized per month', () => {
    const wrong = BundleHeader.parse({
      ...header,
      sections: [
        { name: 'population', dtype: 'f32', length: 4 },
        { name: 'claimants', dtype: 'f32', length: 4 },
        { name: 'meanWeeklyAward', dtype: 'f32', length: 4 },
        { name: 'flags', dtype: 'u8', length: 4 },
      ],
    })
    const buffer = encodeBundle(wrong, [
      new Float32Array(4),
      new Float32Array(4),
      new Float32Array(4),
      new Uint8Array(4),
    ])

    expect(parseBundle(buffer, HASH)).toMatchObject({
      ok: false,
      error: { kind: 'section-mismatch' },
    })
  })
})

const headerFor = (lengths: Readonly<Record<string, number>>) =>
  BundleHeader.parse({
    kind: 'shapes',
    release: '2026-10-07.1',
    level: 'constituency',
    areaCount: 2,
    areaOrderHash: HASH,
    bounds: [
      [-1, 50],
      [1, 51],
    ],
    sections: Object.entries(lengths).map(([name, length]) => ({
      name,
      dtype: name === 'xy' || name === 'triangles' ? 'u16' : 'u32',
      length,
    })),
  })

describe('shapes bundles', () => {
  // Two areas: a square, and a triangle with a triangular island.
  const sections = {
    xy: Uint16Array.of(
      0,
      0,
      100,
      0,
      100,
      100,
      0,
      100,
      200,
      0,
      300,
      0,
      200,
      100,
      400,
      0,
      500,
      0,
      400,
      100,
    ),
    rings: Uint32Array.of(0, 4, 7, 10),
    polygons: Uint32Array.of(0, 1, 2, 3),
    areas: Uint32Array.of(0, 1, 3),
    triangles: Uint16Array.of(0, 1, 2, 0, 2, 3, 0, 1, 2, 0, 1, 2),
    polygonTriangles: Uint32Array.of(0, 2, 3, 4),
  }
  const encode = (parts: typeof sections) =>
    encodeBundle(
      headerFor(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.length]))),
      Object.values(parts),
    )

  it('read every polygon, ring and triangle by offset', () => {
    const parsed = parseBundle(encode(sections), HASH)

    expect(parsed.ok && parsed.value.kind === 'shapes').toBe(true)
    if (!parsed.ok || parsed.value.kind !== 'shapes') return
    expect(Array.from(parsed.value.areas)).toEqual([0, 1, 3])
    expect(parsed.value.triangles).toHaveLength(12)
    expect(parsed.value.header.bounds).toEqual([
      [-1, 50],
      [1, 51],
    ])
  })

  it('reject offsets that do not end where the vertices end', () => {
    const parsed = parseBundle(encode({ ...sections, rings: Uint32Array.of(0, 4, 7, 9) }), HASH)

    expect(parsed).toMatchObject({ ok: false, error: { kind: 'section-mismatch' } })
  })

  it('reject a triangle that reaches past its own polygon', () => {
    const triangles = Uint16Array.of(0, 1, 2, 0, 2, 3, 0, 1, 3, 0, 1, 2)
    const parsed = parseBundle(encode({ ...sections, triangles }), HASH)

    expect(parsed).toMatchObject({ ok: false, error: { kind: 'section-mismatch' } })
  })
})
