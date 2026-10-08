import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseBundle } from './bundle.ts'
import {
  parseAreaDossier,
  parseAreasMeta,
  parseCatalogue,
  parseGbValues,
  parseManifest,
  type AreaOrderHash,
} from './contract.ts'
import { GeoLevel } from './geography.ts'
import { findBannedPhrases, findStylePhrases } from './neutrality.ts'

/**
 * Reads the newest release the pipeline compiled into pipeline/build/site, when
 * one exists, through the same parsers the app uses. Without a local build the
 * suite has nothing to check and is skipped.
 */
const SITE = new URL('../../pipeline/build/site/', import.meta.url)

function newestRelease(): URL | undefined {
  if (!existsSync(SITE)) return undefined
  const releases = readdirSync(SITE)
    .filter((name) => existsSync(new URL(`${name}/manifest.json`, SITE)))
    .toSorted()
  const latest = releases.at(-1)
  return latest === undefined ? undefined : new URL(`${latest}/`, SITE)
}

const root = newestRelease()

function json(path: string): unknown {
  if (root === undefined) throw new Error('no compiled release')
  return JSON.parse(readFileSync(new URL(path, root), 'utf8'))
}

function bytes(path: string): ArrayBuffer {
  if (root === undefined) throw new Error('no compiled release')
  const file = readFileSync(new URL(path, root))
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
}

describe.runIf(root !== undefined)('compiled release', () => {
  it('parses the manifest and catalogue', () => {
    const manifest = parseManifest(json('manifest.json'))
    const catalogue = parseCatalogue(json('meta/catalogue.json'))

    expect(manifest.ok ? [] : manifest.error.problems).toEqual([])
    expect(catalogue.ok ? [] : catalogue.error.problems).toEqual([])
  })

  it('uses no banned or style-list words in catalogue labels, descriptions or caveats', () => {
    const catalogue = JSON.stringify(json('meta/catalogue.json'))
    expect(findBannedPhrases(catalogue)).toEqual([])
    expect(findStylePhrases(catalogue)).toEqual([])
  })

  it('parses areas, a dossier and a series bundle for every level', () => {
    for (const level of GeoLevel.options) {
      const areas = parseAreasMeta(json(`meta/areas-${level}.json`))
      expect(areas.ok ? [] : areas.error.problems).toEqual([])
      if (!areas.ok) continue
      const first = areas.value.areas[0]
      expect(first).toBeDefined()
      if (first === undefined) continue

      const dossier = parseAreaDossier(json(`area/${level}/${first.code}.json`))
      expect(dossier.ok ? [] : dossier.error.problems).toEqual([])
      const gb = parseGbValues(json(`meta/gb-${level}.json`))
      expect(gb.ok ? [] : gb.error.problems).toEqual([])

      const hash: AreaOrderHash = areas.value.areaOrderHash
      const series = parseBundle(bytes(`series/${level}/spend-total/per-resident.bin`), hash)
      expect(series.ok && series.value.kind === 'series').toBe(true)
      const rings = parseBundle(bytes(`layout/${level}/rings.bin`), hash)
      expect(rings.ok && rings.value.kind === 'rings').toBe(true)
    }
  })
})
