import { describe, expect, it } from 'vitest'
import { headTags, type PageHead } from './seo.ts'

const head: PageHead = {
  title: 'Aldershot',
  description: 'A page.',
  path: '/embed/area/constituency/E14001063',
  image: '/og/default.png',
  imageAlt: 'A card.',
}

describe('head tags', () => {
  it('gives an indexed page a canonical link', () => {
    expect(headTags(head).links).toEqual([
      { rel: 'canonical', href: expect.stringMatching(/\/embed\/area\/constituency\/E14001063$/) },
    ])
  })

  it('gives a noindex page no canonical, so search sees one signal', () => {
    const tags = headTags({ ...head, noindex: true })

    expect(tags.links).toEqual([])
    expect(tags.meta).toContainEqual({ name: 'robots', content: 'noindex' })
  })
  it('writes structured data as JSON-LD that cannot close its script tag', () => {
    const tags = headTags({ ...head, jsonLd: { '@type': 'Thing', name: '</script><b>' } })

    expect(tags.scripts).toEqual([
      {
        type: 'application/ld+json',
        children: '{"@type":"Thing","name":"\\u003c/script>\\u003cb>"}',
      },
    ])
  })
})
