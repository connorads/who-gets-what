import { renderToStaticMarkup } from 'react-dom/server'
import type { SiteData } from '#/data/site-data.ts'
import { DEFAULT_IMAGE } from '#/lib/seo.ts'
import { DataPage } from './data/DataPage.tsx'
import { datasetJsonLd } from './data/dataset.ts'
import { MethodsPage } from './methods/MethodsPage.tsx'
import type { PageResult } from './result.ts'

const IMAGE_ALT = 'Who Gets What: UK benefits by area'

export async function renderMethodsPage(data: SiteData): Promise<PageResult> {
  const catalogue = await data.catalogue()
  return {
    kind: 'page',
    html: renderToStaticMarkup(<MethodsPage catalogue={catalogue} />),
    head: {
      title: 'How we worked out the figures',
      description:
        'How we worked out every figure: who we divide by, how we adjust for inflation, which figures are estimates, how we include Scotland and how we compare areas.',
      path: '/methods',
      image: DEFAULT_IMAGE,
      imageAlt: IMAGE_ALT,
    },
  }
}

export async function renderDataPage(data: SiteData): Promise<PageResult> {
  const [manifest, catalogue] = await Promise.all([data.manifest(), data.catalogue()])
  return {
    kind: 'page',
    html: renderToStaticMarkup(<DataPage manifest={manifest} catalogue={catalogue} />),
    head: {
      title: 'Data',
      description: `Download all the data behind the site, as CSV or Parquet files, from data release ${manifest.release}. Each file comes with its sources and licence.`,
      path: '/data',
      image: DEFAULT_IMAGE,
      imageAlt: IMAGE_ALT,
      jsonLd: datasetJsonLd(manifest),
    },
  }
}
