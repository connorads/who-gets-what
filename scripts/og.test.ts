import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadAreaView } from '../src/content/load.ts'
import { hasPulledRelease, pulledSiteData } from '../src/data/testing/file-source.ts'
import { AreaCode } from '../src/domain/geography.ts'
import { findBannedPhrases } from '../src/domain/neutrality.ts'
import sharp from 'sharp'
import { areaCardHtml, cardRenderer, CARD, defaultCardHtml, locatorSvg, renderCard } from './og.ts'
import { robotsTxt } from './robots.ts'

describe('robots.txt', () => {
  it('points at the sitemap on the site origin', () => {
    expect(robotsTxt('https://example.org/')).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://example.org/sitemap.xml\n',
    )
  })
})

describe('default share card', () => {
  it('uses no banned words', () => {
    expect(findBannedPhrases(defaultCardHtml())).toEqual([])
  })

  it('renders a palette PNG at the card size, well under the plain render', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const png = await renderCard(await cardRenderer(root), defaultCardHtml())
    const meta = await sharp(png).metadata()

    expect([meta.format, meta.width, meta.height]).toEqual(['png', CARD.width, CARD.height])
    expect(meta.isPalette).toBe(true)
    expect(png.byteLength).toBeLessThan(20_000)
  })
})

describe.runIf(hasPulledRelease)('area share card', () => {
  it('burns in the fact, its denominator, basis and caveat', async () => {
    const data = pulledSiteData()
    const view = await loadAreaView(data, 'constituency', AreaCode.parse('E14001063'))
    if (view === undefined) throw new Error('no Aldershot')
    const html = areaCardHtml(view, locatorSvg(await data.areas('constituency'), view.code))

    expect(html).toContain('lower than in 93% of constituencies in 2024-25')
    expect(html).toContain('Money in 2026-27 prices.')
    expect(html).toContain('does not judge them')
    expect(findBannedPhrases(html.replaceAll(/data:[^"]+/g, ''))).toEqual([])
  })
})
