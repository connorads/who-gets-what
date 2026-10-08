/**
 * `pnpm run size`: check the built client JavaScript and a data release
 * against the budgets in docs/architecture.md ("Budgets"). Exits 1 when any
 * file is over its budget or has no budget.
 *
 *   pnpm run size                  dist/client (after `pnpm run build`) and
 *                                  public/data/{release in data.lock.json}
 *   pnpm run size --data <folder>  check another release folder instead, such
 *                                  as pipeline/build/site/2026-10-06.2
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'

/** Gzip size limits for client JavaScript, in bytes. */
export const JS_BUDGET = {
  /** What every page loads: the router entry and its static imports (React, the router, the shell). */
  mainChunk: 120_000,
  /** The main chunk plus the area route and every chunk it imports statically. */
  areaPage: 120_000,
  /**
   * The explorer engine (deck.gl, luma.gl, the morph layer): its chunk and
   * every chunk it imports statically that the explore route has not already
   * loaded. It loads after first paint.
   */
  explorerEngine: 450_000,
} as const

export interface FileBudget {
  readonly label: string
  readonly pattern: RegExp
  readonly maxBytes: number
}

/** Raw size limit per data file, by path inside the release. A file must match one. */
export const DATA_BUDGETS: readonly FileBudget[] = [
  { label: 'area dossier', pattern: /^area\/[^/]+\/[^/]+\.json$/, maxBytes: 20_000 },
  { label: 'series bundle', pattern: /^series\/[^/]+\/[^/]+\/[^/]+\.bin$/, maxBytes: 60_000 },
  {
    label: 'swarm layout',
    pattern: /^layout\/[^/]+\/swarm\/[^/]+\/[^/]+\.bin$/,
    maxBytes: 80_000,
  },
  {
    label: 'decomposition bundle',
    pattern: /^decomposition\/[^/]+\/[^/]+\.bin$/,
    maxBytes: 60_000,
  },
  { label: 'rings', pattern: /^layout\/[^/]+\/rings\.bin$/, maxBytes: 1_000_000 },
  { label: 'map shapes', pattern: /^layout\/[^/]+\/shapes\.bin$/, maxBytes: 1_000_000 },
  { label: 'map sprite', pattern: /^layout\/[^/]+\/map\.svg$/, maxBytes: 1_000_000 },
  { label: 'boundaries', pattern: /^geo\/[^/]+\.geojson$/, maxBytes: 1_000_000 },
  { label: 'metadata', pattern: /^(?:manifest\.json|meta\/[^/]+\.json)$/, maxBytes: 2_000_000 },
  { label: 'download', pattern: /^downloads\/[^/]+\.(?:csv|parquet)$/, maxBytes: 10_000_000 },
  // Workers serves no static asset over 25 MiB.
  { label: 'archive', pattern: /^downloads\/all-tables\.zip$/, maxBytes: 25 * 1024 * 1024 },
]

/** The whole release, inside the Workers static asset limits. */
export const RELEASE_BUDGET = { files: 2_000, bytes: 150_000_000 } as const

export interface SizedFile {
  readonly path: string
  readonly bytes: number
}

export function dataProblems(files: readonly SizedFile[]): readonly string[] {
  const total = files.reduce((sum, file) => sum + file.bytes, 0)
  return [
    ...files.flatMap((file) => {
      const budget = DATA_BUDGETS.find((rule) => rule.pattern.test(file.path))
      if (budget === undefined) return [`${file.path}: no budget covers this path`]
      return file.bytes > budget.maxBytes
        ? [
            `${file.path}: ${file.bytes} bytes, over the ${budget.label} budget of ${budget.maxBytes}`,
          ]
        : []
    }),
    ...(files.length < RELEASE_BUDGET.files
      ? []
      : [`release: ${files.length} files, budget under ${RELEASE_BUDGET.files}`]),
    ...(total < RELEASE_BUDGET.bytes
      ? []
      : [`release: ${total} bytes, budget under ${RELEASE_BUDGET.bytes}`]),
  ]
}

const STATIC_IMPORT = /(?:^|[;\s}])import\s*(?:[^'"`;()]*?from\s*)?["'`]\.\/([^"'`]+\.js)["'`]/g

/** Chunk file names a chunk imports statically. Dynamic `import()` calls are lazy and not counted. */
export function staticImports(source: string): readonly string[] {
  return Array.from(source.matchAll(STATIC_IMPORT), (match) => match[1] ?? '').filter(Boolean)
}

/** `entry` and every chunk it reaches through static imports. */
export function closure(entry: string, chunks: ReadonlyMap<string, string>): ReadonlySet<string> {
  const seen = new Set<string>()
  const queue = [entry]
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    if (seen.has(name)) continue
    seen.add(name)
    queue.push(...staticImports(chunks.get(name) ?? ''))
  }
  return seen
}

const DYNAMIC_IMPORT = /\bimport\(\s*["'`]\.\/([^"'`]+\.js)["'`]\s*\)/g

/**
 * The router entry: the chunk that lazy-loads the most other chunks, since it
 * imports every route chunk with `import()`. Counting static importers instead
 * picks a small runtime chunk such as `jsx-runtime` once the bundler splits it out.
 */
export function mainChunk(chunks: ReadonlyMap<string, string>): string | undefined {
  const lazy = [...chunks].map(
    ([name, source]) => [name, new Set(Array.from(source.matchAll(DYNAMIC_IMPORT))).size] as const,
  )
  return lazy.toSorted((a, b) => b[1] - a[1])[0]?.[0]
}

/** Chunks `entry` adds on top of what `loaded` already brought in. */
export function closureBeyond(
  entry: string,
  loaded: string,
  chunks: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const before = closure(loaded, chunks)
  return new Set([...closure(entry, chunks)].filter((name) => !before.has(name)))
}

export function jsProblems(chunks: ReadonlyMap<string, string>): {
  readonly report: readonly string[]
  readonly problems: readonly string[]
} {
  const gzip = (name: string): number => gzipSync(chunks.get(name) ?? '').byteLength
  const shared = mainChunk(chunks)
  // The dossier route lives in `routes/area/$level/$area/`; Vite names its chunks
  // `_area-<hash>.js`, one for the component and one for the loader. Hydration
  // loads both, so the page counts both.
  const area = [...chunks.keys()].filter((name) => /^_area-[\w-]+\.js$/.test(name))
  if (shared === undefined || area.length === 0) {
    return { report: [], problems: ['client: no main chunk or area route chunk found'] }
  }
  const areaChunks = new Set<string>()
  for (const entry of area) for (const name of closure(entry, chunks)) areaChunks.add(name)
  const areaBytes = [...areaChunks].reduce((sum, name) => sum + gzip(name), 0)
  const mainBytes = [...closure(shared, chunks)].reduce((sum, name) => sum + gzip(name), 0)
  const engine = [...chunks.keys()].find((name) => /^ExplorerCanvas-[\w-]+\.js$/.test(name))
  const explore = [...chunks.keys()]
    .filter((name) => /^explore-[\w-]+\.js$/.test(name))
    .toSorted((a, b) => gzip(b) - gzip(a))[0]
  if (engine === undefined || explore === undefined) {
    return { report: [], problems: ['client: no explorer engine or explore route chunk found'] }
  }
  const engineBytes = [...closureBeyond(engine, explore, chunks)].reduce(
    (sum, name) => sum + gzip(name),
    0,
  )
  return {
    report: [
      `main chunk ${shared}: ${mainBytes} bytes gzip`,
      `area page: ${areaBytes} bytes gzip`,
      `explorer engine: ${engineBytes} bytes gzip`,
    ],
    problems: [
      ...(engineBytes <= JS_BUDGET.explorerEngine
        ? []
        : [
            `explorer engine: ${engineBytes} bytes gzip, over its budget of ${JS_BUDGET.explorerEngine}`,
          ]),
      ...(mainBytes <= JS_BUDGET.mainChunk
        ? []
        : [
            `${shared}: ${mainBytes} bytes gzip, over the main chunk budget of ${JS_BUDGET.mainChunk}`,
          ]),
      ...(areaBytes <= JS_BUDGET.areaPage
        ? []
        : [`area page: ${areaBytes} bytes gzip, over its budget of ${JS_BUDGET.areaPage}`]),
    ],
  }
}

function listFiles(dir: string): SizedFile[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const full = join(entry.parentPath, entry.name)
      return { path: relative(dir, full).split('\\').join('/'), bytes: statSync(full).size }
    })
}

function lockedRelease(root: string): string {
  const lock: unknown = JSON.parse(readFileSync(join(root, 'data.lock.json'), 'utf8'))
  if (typeof lock !== 'object' || lock === null || !('release' in lock)) {
    throw new Error('data.lock.json has no release')
  }
  return String(lock.release)
}

function main(): void {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const { values } = parseArgs({ options: { data: { type: 'string' } } })
  const assets = join(root, 'dist', 'client', 'assets')
  const data = values.data ?? join(root, 'public', 'data', lockedRelease(root))
  const problems: string[] = []

  if (existsSync(assets)) {
    const chunks = new Map(
      readdirSync(assets)
        .filter((name) => name.endsWith('.js'))
        .map((name) => [name, readFileSync(join(assets, name), 'utf8')] as const),
    )
    const js = jsProblems(chunks)
    for (const line of js.report) console.warn(line)
    problems.push(...js.problems)
  } else {
    problems.push('client: dist/client/assets is missing; run `pnpm run build` first')
  }

  if (existsSync(data)) {
    const files = listFiles(data)
    console.warn(`data ${relative(root, data)}: ${files.length} files`)
    problems.push(...dataProblems(files))
  } else {
    problems.push(`data: ${data} is missing; run \`pnpm run data:pull\` first`)
  }

  for (const problem of problems) console.error(problem)
  process.exitCode = problems.length === 0 ? 0 : 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
