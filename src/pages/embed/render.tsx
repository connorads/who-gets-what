import { renderToStaticMarkup } from 'react-dom/server'
import { shareFact } from '#/content/area.ts'
import { EMBED_CHART_SCRIPT } from '#/content/embed.ts'
import { loadAreaView, lookupArea } from '#/content/load.ts'
import type { SiteData } from '#/data/site-data.ts'
import { notFoundPage, type PageResult } from '../result.ts'
import { EmbedPage } from './EmbedPage.tsx'

/** `/embed/area/{level}/{code}`: the code alone, since embed code is copied, not read. */
export async function renderEmbedPage(
  data: SiteData,
  params: { readonly level: string; readonly code: string },
): Promise<PageResult> {
  const found = await lookupArea(data, params.level, params.code)
  if (found.kind === 'not-found') return notFoundPage
  if (params.code !== found.area.code) {
    return { kind: 'redirect', href: `/embed/area/${found.level}/${found.area.code}` }
  }
  const view = await loadAreaView(data, found.level, found.area.code)
  if (view === undefined) return notFoundPage
  return {
    kind: 'page',
    html: renderToStaticMarkup(<EmbedPage view={view} />),
    head: {
      title: `${view.name}: embed`,
      description: shareFact(view),
      path: view.path,
      image: `/og/area/${found.level}/${view.code}.png`,
      imageAlt: `${view.name}: ${shareFact(view)}`,
      noindex: true,
      script: EMBED_CHART_SCRIPT,
    },
  }
}
