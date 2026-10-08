import { describe, expect, it } from 'vitest'
import { hasPulledRelease, pulledSiteData } from '#/data/testing/file-source.ts'
import { findBannedPhrases, findStylePhrases } from '#/domain/neutrality.ts'
import { readableText, withoutNames } from '../../scripts/prerender-check.ts'
import { renderAreaIndex, renderAreaPage } from './area/render.tsx'
import { renderComparePage } from './compare/render.tsx'
import { renderEmbedPage } from './embed/render.tsx'
import { renderRankIndex, renderRankPage } from './rank/render.tsx'
import { renderDataPage, renderMethodsPage } from './reference.tsx'
import type { PageResult } from './result.ts'

const data = pulledSiteData()

function page(result: PageResult) {
  if (result.kind !== 'page') throw new Error(`expected a page, got ${result.kind}`)
  return result
}

const PAGES: readonly (readonly [string, () => Promise<PageResult>])[] = [
  [
    'English constituency',
    () => renderAreaPage(data, { level: 'constituency', area: 'E14001063-aldershot' }),
  ],
  [
    'constituency with a candidate named Heap',
    () => renderAreaPage(data, { level: 'constituency', area: 'E14001226-epping-forest' }),
  ],
  [
    'Welsh constituency',
    () => renderAreaPage(data, { level: 'constituency', area: 'W07000081-aberafan-maesteg' }),
  ],
  [
    'Scottish constituency',
    () => renderAreaPage(data, { level: 'constituency', area: 'S14000021-east-renfrewshire' }),
  ],
  [
    'Scottish council',
    () => renderAreaPage(data, { level: 'local-authority', area: 'S12000036-city-of-edinburgh' }),
  ],
  [
    'comparison',
    () =>
      renderComparePage(data, {
        level: 'constituency',
        area: 'E14001063-aldershot',
        other: 'W07000081-aberafan-maesteg',
      }),
  ],
  ['ranking', () => renderRankPage(data, { metric: 'spend-pensioner', denom: 'per-aged-66-plus' })],
  ['embed', () => renderEmbedPage(data, { level: 'local-authority', code: 'W06000015' })],
  ['rankings index', () => renderRankIndex(data)],
  ['areas index', () => renderAreaIndex(data)],
  ['methods', () => renderMethodsPage(data)],
  ['data', () => renderDataPage(data)],
]

describe.runIf(hasPulledRelease)('data pages over the pulled release', () => {
  it.each(PAGES)(
    '%s has one heading, no banned or style-list words and a table for every chart',
    async (_, render) => {
      const { html, head } = page(await render())

      expect(html.match(/<h1[\s>]/g)).toHaveLength(1)
      const text = `${readableText(html)} ${head.title} ${head.description}`
      expect(findBannedPhrases(text)).toEqual([])
      expect(
        findStylePhrases(`${readableText(withoutNames(html))} ${head.title} ${head.description}`),
      ).toEqual([])
      const charts =
        html.match(/<svg[^>]*class="(?:waffle|spark|difference|dumbbell)"/g)?.length ?? 0
      expect(charts === 0 || html.includes('<table')).toBe(true)
    },
  )

  it('names the denominator and price basis beside the headline figures', async () => {
    const { html } = page(
      await renderAreaPage(data, { level: 'constituency', area: 'E14001063-aldershot' }),
    )

    expect(html).toContain('per person aged 66 and over, 2024-25')
    expect(html).toContain('2026-27 prices, adjusted for inflation so that years can be compared')
    expect(html).toContain('Adjusted for inflation (GDP deflator)')
    expect(html).toContain('Income tax paid by residents (income tax only)')
    expect(html).toContain('Member of Parliament: <span translate="no">Alex Baker</span>, Labour')
    expect(html).not.toMatch(/style="[^"]*(?:#d50000|#0087dc|#e4003b|#faa61a)/i)
  })

  it('shows the 2024 election and PIP conditions, each with a table and its source', async () => {
    const { html } = page(
      await renderAreaPage(data, { level: 'constituency', area: 'E14001063-aldershot' }),
    )
    const section = (id: string) =>
      html.slice(html.indexOf(`id="${id}"`)).split('</section>')[0] ?? ''

    for (const id of ['election', 'conditions']) {
      expect(section(id)).toContain('<table')
      expect(section(id)).toMatch(/class="refs"/)
    }
    expect(section('election')).toContain('Turnout')
    expect(section('conditions')).toContain('England and Wales')
    expect(section('election')).not.toMatch(/var\(--party|--family-/)
  })

  it('reads the income tax ratio as pounds of benefits for each £1 of income tax', async () => {
    const area = page(
      await renderAreaPage(data, { level: 'constituency', area: 'E14001063-aldershot' }),
    ).html
    const ranking = page(
      await renderRankPage(data, { metric: 'spend-to-income-tax', denom: 'total' }),
    ).html

    expect(area).toMatch(/received £\d+\.\d\d in benefits for each £1 of income tax/)
    expect(area).toMatch(/for each £1 of income tax, \d{4}-\d\d/)
    expect(area).not.toMatch(/>total, \d{4}-\d\d<\/span><\/th><td class="tabular">\d/)
    expect(ranking).toMatch(/Great Britain: £\d+\.\d\d <span[^>]*>for each £1 of income tax/)
  })

  it('marks Scottish apportioned values and states the nation for deprivation', async () => {
    const { html } = page(
      await renderAreaPage(data, { level: 'constituency', area: 'S14000021-east-renfrewshire' }),
    )

    expect(html).toContain('chip--apportioned')
    expect(html).toContain('of 10 in Scotland')
    expect(html).toContain(
      'Figures by disability condition are published for Scotland as a whole, not for areas in Scotland.',
    )
    expect(html).not.toContain('Personal Independence Payment by main condition')
    expect(html).not.toContain('id="conditions"')
  })

  it('names the level in a dossier title, so namesake areas differ', async () => {
    const { head } = page(
      await renderAreaPage(data, { level: 'local-authority', area: 'S12000036-city-of-edinburgh' }),
    )

    expect(head.title).toBe('City of Edinburgh local authority: benefits by area')
  })

  it('points both orders of a comparison at one canonical path', async () => {
    const aldershot = 'E14001063-aldershot'
    const epping = 'E14001226-epping-forest'
    const forward = page(
      await renderComparePage(data, { level: 'constituency', area: aldershot, other: epping }),
    )
    const reverse = page(
      await renderComparePage(data, { level: 'constituency', area: epping, other: aldershot }),
    )

    expect(forward.head.path).toBe(`/area/constituency/${aldershot}/vs/${epping}`)
    expect(reverse.head.path).toBe(forward.head.path)
  })

  it('redirects a wrong slug and misses an unknown code', async () => {
    expect(await renderAreaPage(data, { level: 'constituency', area: 'E14001063-wrong' })).toEqual({
      kind: 'redirect',
      href: '/area/constituency/E14001063-aldershot',
    })
    expect(await renderAreaPage(data, { level: 'constituency', area: 'S12000036-x' })).toEqual({
      kind: 'not-found',
    })
    expect(
      await renderComparePage(data, {
        level: 'constituency',
        area: 'E14001063-aldershot',
        other: 'E14001063-aldershot',
      }),
    ).toEqual({ kind: 'not-found' })
  })
})
