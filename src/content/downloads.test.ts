import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hasPulledRelease, pulledSiteData } from '#/data/testing/file-source.ts'
import { RELEASE } from '#/data/source.ts'
import { findBannedPhrases } from '#/domain/neutrality.ts'
import { ARCHIVE, archiveFile, DOWNLOAD_TABLES, downloadFiles } from './downloads.ts'

const PUBLIC = new URL(`../../public/data/${RELEASE}/`, import.meta.url)
const headerOf = (path: string): readonly string[] =>
  (readFileSync(new URL(path, PUBLIC), 'utf8').split('\n', 1)[0] ?? '').split(',')

describe('download files', () => {
  it('reads table, part and format from each path', () => {
    const file = { bytes: 10, sha256: 'a'.repeat(64) }
    const files = downloadFiles({
      'manifest.json': file,
      'downloads/dim_area.parquet': file,
      'downloads/dim_area.csv': file,
      'downloads/fact_spend_area-local-authority-2024-25.csv': file,
      [ARCHIVE]: file,
    })

    expect(files.map((f) => [f.table, f.part, f.format])).toEqual([
      ['dim_area', '', 'CSV'],
      ['dim_area', '', 'Parquet'],
      ['fact_spend_area', 'local-authority-2024-25', 'CSV'],
    ])
  })

  it('keeps the archive apart from the tables', () => {
    const file = { bytes: 10, sha256: 'a'.repeat(64) }

    expect(archiveFile({ [ARCHIVE]: file })).toEqual({ path: ARCHIVE, ...file })
    expect(archiveFile({ 'downloads/dim_area.csv': file })).toBeUndefined()
  })

  it('describes every column in plain words', () => {
    for (const table of Object.values(DOWNLOAD_TABLES)) {
      expect(findBannedPhrases(table.description)).toEqual([])
      for (const column of table.columns) {
        expect(findBannedPhrases(column.description)).toEqual([])
      }
    }
  })
})

describe.runIf(hasPulledRelease)('the column dictionary over the pulled release', () => {
  it('names every column of every CSV, in file order', async () => {
    const files = downloadFiles((await pulledSiteData().manifest()).files)
    const tables = new Set(files.map((file) => file.table))

    expect([...tables].toSorted()).toEqual(Object.keys(DOWNLOAD_TABLES).toSorted())
    for (const file of files.filter((f) => f.format === 'CSV')) {
      expect([file.path, ...headerOf(file.path)]).toEqual([
        file.path,
        ...(DOWNLOAD_TABLES[file.table]?.columns.map((column) => column.name) ?? []),
      ])
    }
  })

  it('publishes every table as Parquet and CSV', async () => {
    const files = downloadFiles((await pulledSiteData().manifest()).files)
    for (const table of Object.keys(DOWNLOAD_TABLES)) {
      const formats = new Set(files.filter((f) => f.table === table).map((f) => f.format))
      expect([table, ...[...formats].toSorted()]).toEqual([table, 'CSV', 'Parquet'])
    }
  })
})
