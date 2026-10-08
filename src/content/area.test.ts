import { describe, expect, it } from 'vitest'
import { hasPulledRelease, pulledSiteData } from '#/data/testing/file-source.ts'
import { AreaCode, type GeoLevel } from '#/domain/geography.ts'
import { findBannedPhrases, findStylePhrases } from '#/domain/neutrality.ts'
import { shareFact, type AreaView } from './area.ts'
import { loadAreaView } from './load.ts'

const data = pulledSiteData()

async function view(level: GeoLevel, code: string): Promise<AreaView> {
  const built = await loadAreaView(data, level, AreaCode.parse(code))
  if (built === undefined) throw new Error(`no data for ${code}`)
  return built
}

describe.runIf(hasPulledRelease)('area view over the pulled release', () => {
  it('compares Aldershot with other constituencies and names every denominator', async () => {
    const aldershot = await view('constituency', 'E14001063')

    expect(aldershot.headline[0]).toBe(
      'In Aldershot, benefit spending per resident was lower than in 93% of constituencies in 2024-25.',
    )
    expect(aldershot.glance.map((fact) => fact.rankText)).toEqual([
      '592nd of 631',
      '588th of 631',
      '490th of 632',
    ])
    expect(aldershot.representation).toEqual({
      member: 'Alex Baker',
      party: 'Labour',
      since: '4 July 2024',
    })
    expect(aldershot.exploreHref).toBe('/explore?sel=E14001063')
    for (const group of aldershot.facts) {
      for (const fact of group.rows) expect(fact.denominatorText).not.toBe('')
    }
  })

  it('shows spending in every price basis and ranks the same in each', async () => {
    const aldershot = await view('constituency', 'E14001063')
    const first = aldershot.glance[0]

    expect(first?.value?.text).toEqual({
      'real-gdp': '£3,453',
      'real-cpi': '£3,468',
      nominal: '£3,276',
    })
    expect(first?.value?.varies).toBe(true)
  })

  it('keeps the explorer link on the council level for local authorities', async () => {
    const edinburgh = await view('local-authority', 'S12000036')

    expect(edinburgh.exploreHref).toBe('/explore?level=local-authority&sel=S12000036')
    expect(edinburgh.representation).toBeNull()
    expect(edinburgh.election).toBeNull()
    expect(edinburgh.spend.items.some((item) => item.derived)).toBe(true)
  })

  it('gives the 2024 result with the winning party as text, majority and turnout', async () => {
    const aldershot = await view('constituency', 'E14001063')

    expect(aldershot.election).toMatchObject({
      dateText: '4 July 2024',
      winner: { party: 'Labour', name: 'Alex Baker' },
      majorityText: '5,683',
      majorityShareText: '11.7%',
      turnoutText: '61.8%',
    })
    expect(aldershot.election?.candidates[1]).toMatchObject({
      party: 'Conservative',
      shareText: '29.0%',
    })
  })

  it('shows PIP conditions beside England and Wales, and says why Scotland has none', async () => {
    const aldershot = await view('constituency', 'E14001063')
    const edinburgh = await view('local-authority', 'S12000036')
    if (aldershot.conditions.kind !== 'published') throw new Error('Aldershot has conditions')

    expect(aldershot.conditions.comparisonLabel).toBe('England and Wales')
    expect(aldershot.conditions.rows.length).toBeGreaterThan(aldershot.conditions.main.length)
    expect(aldershot.conditions.main.at(-1)?.label).toMatch(/^Other condition groups/)
    const shares = aldershot.conditions.main.map((row) => row.share ?? 0)
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 6)
    expect(edinburgh.conditions).toEqual({
      kind: 'not-published',
      reason: expect.stringContaining('Scotland as a whole'),
    })
    expect(edinburgh.caveats.map((caveat) => caveat.id)).toContain('pip-conditions-scotland')
  })

  // Builds about 1,000 area views from disk, which takes 60 s to 110 s on a busy machine.
  it(
    'uses no banned or style-list words in any area, at either level',
    { timeout: 180_000 },
    async () => {
      const problems: string[] = []
      const levels = await Promise.all(
        (['constituency', 'local-authority'] as const).map(async (level) => {
          const { areas } = await data.areas(level)
          return Promise.all(areas.map((area) => view(level, area.code)))
        }),
      )
      for (const built of levels.flat()) {
        const text = JSON.stringify([
          built.headline,
          built.facts,
          built.model,
          built.tax,
          built.conditions,
          shareFact(built),
        ])
        const found = [...findBannedPhrases(text), ...findStylePhrases(text)]
        if (found.length > 0) problems.push(`${built.code}: ${found.join(', ')}`)
      }

      expect(problems).toEqual([])
    },
  )
})
