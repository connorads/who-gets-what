/**
 * The pages the build prerenders, read from the pulled data release: one per
 * area at each level, one per ranking and one embed per area. Compare pages are not listed; the Worker renders them
 * on demand.
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export interface PrerenderPage {
  readonly path: string
  readonly sitemap?: {
    readonly exclude?: boolean
    /** `yyyy-mm-dd`; without it the sitemap gets the build date, which changes on every build. */
    readonly lastmod?: string
  }
  /** Listed for the sitemap only; the Worker renders it on every request. */
  readonly prerender?: { readonly enabled: false }
}

const LEVELS = ['constituency', 'local-authority'] as const

interface AreasFile {
  readonly areas: readonly { readonly code: string; readonly slug: string }[]
}

interface CatalogueFile {
  readonly metrics: readonly { readonly id: string; readonly denominators: readonly string[] }[]
}

const isCatalogue = (value: unknown): value is CatalogueFile =>
  typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'metrics'))

const isAreas = (value: unknown): value is AreasFile =>
  typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'areas'))

function readJson(path: string): unknown {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  return value
}

/** The release folder `data.lock.json` pins, which `pnpm run data:pull` fills. */
export function releaseFolder(root: string): string {
  const lock = readJson(join(root, 'data.lock.json'))
  const release: unknown =
    typeof lock === 'object' && lock !== null ? Reflect.get(lock, 'release') : undefined
  if (typeof release !== 'string') throw new Error('data.lock.json has no release')
  const folder = join(root, 'public', 'data', release)
  if (!existsSync(join(folder, 'manifest.json'))) {
    throw new Error(`No data in ${folder}: run \`pnpm run data:pull\` before building`)
  }
  return folder
}

export function areaPages(folder: string): readonly PrerenderPage[] {
  return LEVELS.flatMap((level) => {
    const file = readJson(join(folder, 'meta', `areas-${level}.json`))
    if (!isAreas(file)) throw new Error(`areas-${level}.json has no areas`)
    return file.areas.map((area) => ({
      path: `/area/${level}/${area.code}-${area.slug}`,
    }))
  })
}

/** One frameable page per area; search engines index the dossier instead. */
export function embedPages(folder: string): readonly PrerenderPage[] {
  return LEVELS.flatMap((level) => {
    const file = readJson(join(folder, 'meta', `areas-${level}.json`))
    if (!isAreas(file)) throw new Error(`areas-${level}.json has no areas`)
    return file.areas.map((area) => ({
      path: `/embed/area/${level}/${area.code}`,
      sitemap: { exclude: true },
    }))
  })
}

/** One page per metric and denominator; each page holds both levels. */
export function rankPages(folder: string): readonly PrerenderPage[] {
  const file = readJson(join(folder, 'meta', 'catalogue.json'))
  if (!isCatalogue(file)) throw new Error('catalogue.json has no metrics')
  return file.metrics.flatMap((metric) =>
    metric.denominators.map((denominator) => ({
      path: `/rank/${metric.id}/${denominator}`,
    })),
  )
}

/**
 * Text and index pages, without a trailing slash: Workers static assets serve
 * `/area` from `area.html` with no redirect.
 */
export const TEXT_PAGES: readonly PrerenderPage[] = [
  // The home page is the film. The Worker renders it so its `?mode=read` link
  // names the other mode.
  { path: '/', prerender: { enabled: false } },
  // Static assets answer before the Worker and ignore the query string, so a
  // prerendered /explore would serve the default state for every shared link.
  { path: '/explore', prerender: { enabled: false } },
  { path: '/area' },
  { path: '/rank' },
  { path: '/methods' },
  { path: '/data' },
  { path: '/about' },
  { path: '/styleguide', sitemap: { exclude: true } },
]

/** Every listed page is dated by its data release, the day its figures last changed. */
export function prerenderPages(root: string): readonly PrerenderPage[] {
  const folder = releaseFolder(root)
  const lastmod = basename(folder).slice(0, 'yyyy-mm-dd'.length)
  const pages = [...TEXT_PAGES, ...areaPages(folder), ...rankPages(folder), ...embedPages(folder)]
  const dated: PrerenderPage[] = []
  for (const page of pages) {
    dated.push(
      page.sitemap?.exclude === true ? page : { ...page, sitemap: { ...page.sitemap, lastmod } },
    )
  }
  return dated
}
