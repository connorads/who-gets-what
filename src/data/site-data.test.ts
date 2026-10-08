import { describe, expect, it } from 'vitest'
import { AreaCode } from '#/domain/geography.ts'
import { MetricId } from '#/domain/measure.ts'
import { err, ok } from '#/domain/result.ts'
import { createSiteData } from './site-data.ts'
import { hasPulledRelease, pulledSiteData } from './testing/file-source.ts'
import { RELEASE, type DataSource } from './source.ts'

describe('createSiteData', () => {
  it('reads metadata once and retries after a failed read', async () => {
    const reads: string[] = []
    let fail = true
    const source: DataSource = {
      async json(path) {
        reads.push(path)
        await Promise.resolve()
        if (fail) return err({ kind: 'data-missing', path, status: 503 })
        return ok({})
      },
      async bytes(path) {
        await Promise.resolve()
        return err({ kind: 'data-missing', path, status: 404 })
      },
    }
    const data = createSiteData(source, RELEASE)

    await expect(data.catalogue()).rejects.toThrow('Release file missing')
    fail = false
    await expect(data.catalogue()).rejects.toThrow('breaks the data contract')
    expect(reads).toEqual([
      `/data/${RELEASE}/meta/catalogue.json`,
      `/data/${RELEASE}/meta/catalogue.json`,
    ])
  })
})

describe.runIf(hasPulledRelease)('site data over the pulled release', () => {
  const data = pulledSiteData()

  it('parses a dossier and reports a missing one as a value', async () => {
    const found = await data.dossier('constituency', AreaCode.parse('E14001063'))
    const missing = await data.dossier('constituency', AreaCode.parse('E14999999'))

    expect(found.ok && found.value.area.name).toBe('Aldershot')
    expect(missing).toEqual({
      ok: false,
      error: {
        kind: 'data-missing',
        path: `/data/${RELEASE}/area/constituency/E14999999.json`,
        status: 404,
      },
    })
  })

  it('checks series bundles against the level area order', async () => {
    const series = await data.series('local-authority', MetricId.parse('spend-total'), 'total')
    const { areas } = await data.areas('local-authority')

    expect(series.ok && series.value.header.areaCount).toBe(areas.length)
  })
})
