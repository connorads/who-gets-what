/**
 * `pnpm run data:pull`: fetch the data release pinned in data.lock.json into
 * public/data/{release}/ and check it (ADR 0002).
 *
 *   pnpm run data:pull            download the site asset from the public
 *                                 GitHub Release (no login), check its
 *                                 SHA-256 against the lock, then extract it
 *   pnpm run data:pull -- --local copy pipeline/build/site/{release}/ instead:
 *                                 the locked release if it was compiled here,
 *                                 else the newest compiled release
 *
 * Either way every extracted file is checked against the release manifest,
 * and every other release in public/data/ is removed, so a deploy uploads
 * only the pinned one.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod/mini'
import { ReleaseId } from '../src/domain/contract.ts'

const REPO = 'connorads/who-gets-what'
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PUBLIC_DATA = join(ROOT, 'public', 'data')
const SITE_BUILD = join(ROOT, 'pipeline', 'build', 'site')

const Lock = z.strictObject({
  release: ReleaseId,
  tag: z.string(),
  asset: z.string(),
  sha256: z.string().check(z.regex(/^[0-9a-f]{64}$/)),
})
type Lock = z.infer<typeof Lock>

const ManifestFiles = z.object({
  release: ReleaseId,
  files: z.record(z.string(), z.object({ bytes: z.number(), sha256: z.string() })),
})

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

function readLock(): Lock | undefined {
  const path = join(ROOT, 'data.lock.json')
  return existsSync(path) ? Lock.parse(JSON.parse(readFileSync(path, 'utf8'))) : undefined
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/'))
}

/** Check a release directory against its own manifest. Throws on any mismatch. */
function verifyRelease(dir: string, release: string): number {
  const manifest = ManifestFiles.parse(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')))
  if (manifest.release !== release)
    throw new Error(`manifest names ${manifest.release}, not ${release}`)
  const listed = new Set(Object.keys(manifest.files))
  const present = listFiles(dir).filter((file) => file !== 'manifest.json')
  const extra = present.filter((file) => !listed.has(file))
  if (extra.length > 0 || present.length !== listed.size) {
    throw new Error(`files and manifest differ: ${extra.slice(0, 5).join(', ')}`)
  }
  for (const [file, expected] of Object.entries(manifest.files)) {
    const data = readFileSync(join(dir, file))
    if (data.byteLength !== expected.bytes || sha256(data) !== expected.sha256) {
      throw new Error(`${file} does not match the manifest`)
    }
  }
  return listed.size
}

function pullLocal(lock: Lock | undefined): string {
  if (!existsSync(SITE_BUILD)) throw new Error('no compiled release: run `pnpm run data:compile`')
  const compiled = readdirSync(SITE_BUILD)
    .filter((name) => existsSync(join(SITE_BUILD, name, 'manifest.json')))
    .toSorted()
  const release =
    lock !== undefined && compiled.includes(lock.release) ? lock.release : compiled.at(-1)
  if (release === undefined) throw new Error('no compiled release: run `pnpm run data:compile`')
  const target = join(PUBLIC_DATA, release)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(PUBLIC_DATA, { recursive: true })
  cpSync(join(SITE_BUILD, release), target, { recursive: true })
  return release
}

/** The public download URL of the locked release asset; GitHub redirects it to storage. */
export function assetUrl(lock: Pick<Lock, 'tag' | 'asset'>): string {
  return `https://github.com/${REPO}/releases/download/${lock.tag}/${lock.asset}`
}

async function pullRelease(lock: Lock): Promise<string> {
  const work = mkdtempSync(join(tmpdir(), 'wgw-data-'))
  try {
    const response = await fetch(assetUrl(lock))
    if (!response.ok) throw new Error(`${assetUrl(lock)}: HTTP ${response.status}`)
    const archive = join(work, lock.asset)
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()))
    const actual = sha256(readFileSync(archive))
    if (actual !== lock.sha256) {
      throw new Error(`${lock.asset} has SHA-256 ${actual}; data.lock.json pins ${lock.sha256}`)
    }
    const target = join(PUBLIC_DATA, lock.release)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(PUBLIC_DATA, { recursive: true })
    execFileSync('tar', ['-xzf', archive, '-C', PUBLIC_DATA], { stdio: 'inherit' })
    return lock.release
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** Remove every release folder in `dir` except `keep`; other entries stay. Returns the removed names. */
export function pruneReleases(dir: string, keep: string): string[] {
  const stale = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== keep)
    .filter((entry) => ReleaseId.safeParse(entry.name).success)
    .map((entry) => entry.name)
    .toSorted()
  for (const name of stale) rmSync(join(dir, name), { recursive: true, force: true })
  return stale
}

async function main(): Promise<void> {
  const local = process.argv.includes('--local')
  const lock = readLock()
  if (!local && lock === undefined)
    throw new Error('data.lock.json is missing; use --local for a local compile')
  const release = local ? pullLocal(lock) : await pullRelease(Lock.parse(lock))
  const count = verifyRelease(join(PUBLIC_DATA, release), release)
  console.error(`data ${release}: ${count} files checked in public/data/${release}`)
  const removed = pruneReleases(PUBLIC_DATA, release)
  if (removed.length > 0) console.error(`removed older releases: ${removed.join(', ')}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
