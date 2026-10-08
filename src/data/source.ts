/**
 * The one port every page reads release data through. In the browser it is
 * `fetch`. On the server and at prerender it is the Workers `ASSETS` binding
 * (`assets-source.server.ts`), which `src/server.ts` registers. Tests pass
 * a source over the pulled release on disk. All serve the same files under
 * `/data/{release}/`; paths come from `dataPath` in the contract.
 */
import lock from '../../data.lock.json' with { type: 'json' }
import { ReleaseId } from '#/domain/contract.ts'
import { err, ok, type Result } from '#/domain/result.ts'

export interface DataMissing {
  readonly kind: 'data-missing'
  readonly path: string
  readonly status: number
}

export interface DataSource {
  json(path: string): Promise<Result<unknown, DataMissing>>
  bytes(path: string): Promise<Result<ArrayBuffer, DataMissing>>
}

/** The data release this build reads, pinned in `data.lock.json`. */
export const RELEASE: ReleaseId = ReleaseId.parse(lock.release)

type Fetcher = (request: Request) => Promise<Response>

/** A source over any fetch-like function, resolving paths against `origin`. */
export function fetchSource(fetcher: Fetcher, origin: string): DataSource {
  const get = async <T>(
    path: string,
    body: (response: Response) => Promise<T>,
  ): Promise<Result<T, DataMissing>> => {
    const response = await fetcher(new Request(new URL(path, origin)))
    if (!response.ok) return err({ kind: 'data-missing', path, status: response.status })
    return ok(await body(response))
  }
  return {
    json: (path) => get(path, async (response): Promise<unknown> => response.json()),
    bytes: (path) => get(path, (response) => response.arrayBuffer()),
  }
}

/** A file the release must hold; a miss means a broken release and throws. */
export async function required<T>(read: Promise<Result<T, DataMissing>>): Promise<T> {
  const result = await read
  if (result.ok) return result.value
  throw new Error(`Release file missing: ${result.error.path} (${result.error.status})`)
}

let serverSource: DataSource | undefined

/** Called once by the Worker entry before any request renders. */
export function setServerSource(source: DataSource): void {
  serverSource = source
}

let browserSource: DataSource | undefined

/** The source for the current runtime. */
export function dataSource(): DataSource {
  if (typeof window !== 'undefined') {
    browserSource ??= fetchSource((request) => fetch(request), window.location.origin)
    return browserSource
  }
  if (serverSource === undefined) throw new Error('No server data source registered')
  return serverSource
}
