import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assetUrl, pruneReleases } from './data-pull.ts'

describe('pruneReleases', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps the pulled release and removes every other release folder', () => {
    dir = mkdtempSync(join(tmpdir(), 'wgw-prune-'))
    for (const release of ['2026-10-06.1', '2026-10-07.1', '2026-10-07.2']) {
      mkdirSync(join(dir, release, 'meta'), { recursive: true })
      writeFileSync(join(dir, release, 'manifest.json'), '{}')
    }
    mkdirSync(join(dir, 'notes'))
    writeFileSync(join(dir, '2026-10-05.1'), 'a file named like a release')

    expect(pruneReleases(dir, '2026-10-07.2')).toEqual(['2026-10-06.1', '2026-10-07.1'])
    expect(readdirSync(dir).toSorted()).toEqual(['2026-10-05.1', '2026-10-07.2', 'notes'])
    expect(existsSync(join(dir, '2026-10-07.2', 'manifest.json'))).toBe(true)
  })
})

describe('assetUrl', () => {
  it('downloads the locked asset from the public repository', () => {
    expect(assetUrl({ tag: 'data-2026-10-08.1', asset: 'site-data-2026-10-08.1.tar.gz' })).toBe(
      'https://github.com/connorads/who-gets-what/releases/download/data-2026-10-08.1/site-data-2026-10-08.1.tar.gz',
    )
  })
})
