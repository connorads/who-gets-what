import { describe, expect, it } from 'vitest'
import { FIGURE_COLUMNS } from '#/content/csv.ts'
import { fileSource, hasPulledRelease } from '#/data/testing/file-source.ts'
import { viewCsv, viewFileName, viewRows } from './download.ts'
import { loadExplore } from './load.ts'
import { columnViews } from './model.ts'

async function view(search: Record<string, string>) {
  const data = await loadExplore(search, fileSource)
  const active = columnViews(data.metric.id, data.columns).find(
    (column) => column.denominator === data.state.denominator,
  )
  if (active === undefined) throw new Error('no active column')
  return { data, ranking: active.ranking }
}

describe.runIf(hasPulledRelease)('download this view over the pulled release', () => {
  it('writes every area once, with the value and rank the table shows', async () => {
    const { data, ranking } = await view({ metric: 'spend-pensioner', denom: 'per-aged-66-plus' })
    const rows = viewRows(data, ranking)
    const column = data.columns.find((entry) => entry.denominator === 'per-aged-66-plus')

    expect(rows).toHaveLength(632)
    expect(new Set(rows.map((row) => row.code)).size).toBe(632)
    expect(rows.map((row) => row.value)).toEqual(column?.values)
    expect(rows.filter((row) => row.rank === 1)).toHaveLength(1)
    expect(rows.every((row) => row.period === data.state.period)).toBe(true)
  })

  it('names the view in the file and every row', async () => {
    const { data, ranking } = await view({
      level: 'local-authority',
      metric: 'claimants-pension-credit',
      basis: 'nominal',
    })
    const lines = viewCsv(data, ranking).trimEnd().split('\r\n')

    expect(lines[0]).toBe(FIGURE_COLUMNS.join(','))
    expect(lines).toHaveLength(351)
    expect(lines[1]).toContain(',local-authority,claimants-pension-credit,')
    expect(viewFileName(data)).toBe(
      `who-gets-what-local-authority-claimants-pension-credit-${data.state.denominator}-${data.state.period}-nominal.csv`,
    )
  })
})
