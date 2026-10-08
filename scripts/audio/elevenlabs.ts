/**
 * ElevenLabs REST calls with an on-disk cache. A response is stored under the
 * SHA-256 of its request, so a rebuild with unchanged prompts re-encodes the
 * same takes and spends no credits. Change a prompt, seed or setting to get a
 * new take.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod/mini'

const API = 'https://api.elevenlabs.io'
const ATTEMPTS = 4
const CONCURRENCY = 2

export interface ApiResult {
  readonly bytes: Buffer
  /** `character-cost` header of the original request, in credits. */
  readonly credits: number | undefined
  /** True when this run read the response from the cache. */
  readonly cached: boolean
}

const Meta = z.object({ credits: z.optional(z.number()) })

export interface Client {
  post(path: string, body: Record<string, unknown>): Promise<ApiResult>
}

function apiKey(): string {
  const key = process.env['ELEVENLABS_API_KEY']
  if (key === undefined || key === '') throw new Error('ELEVENLABS_API_KEY is not set')
  return key
}

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** Run at most `max` tasks at once; a finished task hands its slot to the next. */
function limiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: (() => void)[] = []
  return async (task) => {
    if (active < max) active += 1
    else await new Promise<void>((resolve) => waiting.push(resolve))
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next === undefined) active -= 1
      else next()
    }
  }
}

async function request(path: string, body: string, attempt = 1): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey(), 'content-type': 'application/json' },
    body,
  })
  if (response.ok) return response
  const detail = (await response.text()).slice(0, 500)
  const retry = response.status === 429 || response.status >= 500
  if (!retry || attempt === ATTEMPTS) {
    throw new Error(`${path} failed with ${response.status}: ${detail}`)
  }
  console.warn(`${path}: ${response.status}, retry ${attempt} of ${ATTEMPTS - 1}`)
  await pause(2000 * 2 ** attempt)
  return request(path, body, attempt + 1)
}

/** Requests run at most CONCURRENCY at a time, under the plan's limit of 5 (music: 2). */
export function createClient(cacheDir: string, offline: boolean): Client {
  mkdirSync(cacheDir, { recursive: true })
  const limit = limiter(CONCURRENCY)
  return {
    async post(path, body) {
      const key = createHash('sha256').update(path).update(JSON.stringify(body)).digest('hex')
      const bin = join(cacheDir, `${key}.bin`)
      const meta = join(cacheDir, `${key}.json`)
      if (existsSync(bin) && existsSync(meta)) {
        const saved = Meta.parse(JSON.parse(readFileSync(meta, 'utf8')))
        return {
          bytes: readFileSync(bin),
          credits: saved.credits,
          cached: true,
        }
      }
      if (offline) throw new Error(`${path} is not cached and --offline was given`)
      // Read the body inside the slot: music streams while it generates.
      const { response, bytes } = await limit(async () => {
        const done = await request(path, JSON.stringify(body))
        return { response: done, bytes: Buffer.from(await done.arrayBuffer()) }
      })
      const cost = Number(response.headers.get('character-cost') ?? Number.NaN)
      const credits = Number.isFinite(cost) ? cost : undefined
      writeFileSync(bin, bytes)
      // The request id stays beside the cached response, for ElevenLabs support.
      const requestId = response.headers.get('request-id')
      writeFileSync(meta, JSON.stringify({ path, body, credits, requestId }, null, 2))
      return { bytes, credits, cached: false }
    },
  }
}
