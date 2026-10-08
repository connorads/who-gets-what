import { describe, expect, it } from 'vitest'
import { hasPulledRelease, pulledSiteData } from '#/data/testing/file-source.ts'
import { AreaCode } from '#/domain/geography.ts'
import { findBannedPhrases } from '#/domain/neutrality.ts'
import { buildCompareView, tallySentence } from './compare.ts'

describe('tallySentence', () => {
  it('counts the measures each way', () => {
    expect(
      tallySentence(
        'Aldershot',
        {
          group: { a: 5, b: 10, of: 15 },
          resident: { a: 3, b: 12, of: 15 },
          total: { a: 9, b: 6, of: 15 },
        },
        'Chelmsford',
      ),
    ).toBe(
      'Aldershot is higher than Chelmsford on 5 of 15 measures per person in the age group, 3 of 15 per resident and 9 of 15 in total.',
    )
  })
})

describe.runIf(hasPulledRelease)('compare view over the pulled release', () => {
  const data = pulledSiteData()

  it('shows how the higher area changes with the denominator', async () => {
    const [catalogue, gb, a, b] = await Promise.all([
      data.catalogue(),
      data.gb('constituency'),
      data.dossier('constituency', AreaCode.parse('E14001063')),
      data.dossier('constituency', AreaCode.parse('E14001174')),
    ])
    if (!a.ok || !b.ok) throw new Error('missing dossier')
    const view = buildCompareView({ catalogue, gb, a: a.value, b: b.value })

    expect(view.path).toBe('/area/constituency/E14001063-aldershot/vs/E14001174-clacton')
    expect(view.rows.length).toBeGreaterThan(15)
    for (const measure of ['group', 'resident', 'total'] as const) {
      const { a: left, b: right, of } = view.tally[measure]
      expect(left + right).toBe(of)
    }
    expect(view.flips).toBe(view.rows.filter((row) => row.flips).length)
    expect(findBannedPhrases(JSON.stringify(view))).toEqual([])
  })
})
