/**
 * Typed reads of the pinned release through a `DataSource`. Every file passes
 * the contract parsers, so pages only ever see checked data. A file that fails
 * its contract is a broken release and throws; a dossier that does not exist
 * is an expected miss and comes back as a value.
 */
import { parseBundle, type SeriesBundle } from '#/domain/bundle.ts'
import {
  dataPath,
  parseAreaDossier,
  parseAreasMeta,
  parseCatalogue,
  parseGbValues,
  parseManifest,
  type AreaDossier,
  type AreasMeta,
  type Catalogue,
  type ContractViolation,
  type GbValues,
  type Manifest,
  type ReleaseId,
} from '#/domain/contract.ts'
import { GeoLevel, type AreaCode } from '#/domain/geography.ts'
import { Denominator, MetricId } from '#/domain/measure.ts'
import { ok, type Result } from '#/domain/result.ts'
import { required, type DataMissing, type DataSource } from './source.ts'

export interface SiteData {
  readonly release: ReleaseId
  manifest(): Promise<Manifest>
  catalogue(): Promise<Catalogue>
  areas(level: GeoLevel): Promise<AreasMeta>
  gb(level: GeoLevel): Promise<GbValues>
  dossier(level: GeoLevel, code: AreaCode): Promise<Result<AreaDossier, DataMissing>>
  /** A series bundle, or `data-missing` when the metric does not publish that denominator. */
  series(
    level: GeoLevel,
    metric: MetricId,
    denominator: Denominator,
  ): Promise<Result<SeriesBundle, DataMissing>>
}

function unwrap<T>(result: Result<T, ContractViolation>): T {
  if (result.ok) return result.value
  throw new Error(
    `${result.error.file} breaks the data contract:\n${result.error.problems.join('\n')}`,
  )
}

/** Remember one read per key; a failed read is forgotten so the next call retries. */
function memo<K extends string, T>(load: (key: K) => Promise<T>): (key: K) => Promise<T> {
  const cache = new Map<K, Promise<T>>()
  return (key) => {
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const pending = load(key)
    pending.catch(() => cache.delete(key))
    cache.set(key, pending)
    return pending
  }
}

/** Remember one read; a failed read is forgotten so the next call retries. */
function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined
  return () => {
    if (pending === undefined) {
      pending = load()
      pending.catch(() => {
        pending = undefined
      })
    }
    return pending
  }
}

/**
 * Metadata and bundles are shared by every page, so each is read once per
 * instance. Dossiers are read per page and not kept.
 */
export function createSiteData(source: DataSource, release: ReleaseId): SiteData {
  const manifest = lazy(async () =>
    unwrap(parseManifest(await required(source.json(dataPath.manifest(release))))),
  )
  const catalogue = lazy(async () =>
    unwrap(parseCatalogue(await required(source.json(dataPath.catalogue(release))))),
  )
  const areas = memo(async (level: GeoLevel) =>
    unwrap(parseAreasMeta(await required(source.json(dataPath.areas(release, level))))),
  )
  const gb = memo(async (level: GeoLevel) =>
    unwrap(parseGbValues(await required(source.json(dataPath.gb(release, level))))),
  )
  const series = memo(
    async (
      key: `${GeoLevel}/${MetricId}/${Denominator}`,
    ): Promise<Result<SeriesBundle, DataMissing>> => {
      const [level, metric, denominator] = splitSeriesKey(key)
      const path = dataPath.series(release, level, metric, denominator)
      const read = await source.bytes(path)
      if (!read.ok) return read
      const { areaOrderHash } = await areas(level)
      const bundle = parseBundle(read.value, areaOrderHash)
      if (!bundle.ok || bundle.value.kind !== 'series') {
        throw new Error(`${path} is not a series bundle for this area order`)
      }
      return ok(bundle.value)
    },
  )

  return {
    release,
    manifest,
    catalogue,
    areas,
    gb,
    async dossier(level, code) {
      const read = await source.json(dataPath.dossier(release, level, code))
      if (!read.ok) return read
      return ok(unwrap(parseAreaDossier(read.value)))
    },
    series: (level, metric, denominator) => series(`${level}/${metric}/${denominator}`),
  }
}

function splitSeriesKey(key: string): [GeoLevel, MetricId, Denominator] {
  const [level, metric, denominator] = key.split('/')
  return [GeoLevel.parse(level), MetricId.parse(metric), Denominator.parse(denominator)]
}
