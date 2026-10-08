import { renderToStaticMarkup } from 'react-dom/server'
import { buildRankView, type RankLevelInput } from '#/content/rank.ts'
import type { SiteData } from '#/data/site-data.ts'
import { GeoLevel } from '#/domain/geography.ts'
import { parseRankRoute } from '#/domain/url-state.ts'
import { notFoundPage, type PageResult } from '../result.ts'
import { RankIndexPage } from './RankIndexPage.tsx'
import { RankPage } from './RankPage.tsx'

export async function renderRankPage(
  data: SiteData,
  params: { readonly metric: string; readonly denom: string },
): Promise<PageResult> {
  const catalogue = await data.catalogue()
  const route = parseRankRoute(params, catalogue)
  if (!route.ok) return notFoundPage
  const { metric, denominator } = route.value
  const levels = await Promise.all(
    GeoLevel.options
      .filter((level) => metric.levels.includes(level))
      .map(async (level): Promise<RankLevelInput | undefined> => {
        const [areas, gb, bundle] = await Promise.all([
          data.areas(level),
          data.gb(level),
          data.series(level, metric.id, denominator),
        ])
        return bundle.ok ? { areas, gb, bundle: bundle.value } : undefined
      }),
  )
  const inputs = levels.filter((input) => input !== undefined)
  if (inputs.length === 0) return notFoundPage
  const view = buildRankView(catalogue, metric, denominator, inputs)
  return {
    kind: 'page',
    html: renderToStaticMarkup(<RankPage view={view} />),
    head: {
      title: `${view.title}: ranking`,
      description: view.summary,
      path: view.path,
      image: `/og/rank/${metric.id}/${denominator}.png`,
      imageAlt: `Ranking of ${view.measure}`,
    },
  }
}

export async function renderRankIndex(data: SiteData): Promise<PageResult> {
  const catalogue = await data.catalogue()
  return {
    kind: 'page',
    html: renderToStaticMarkup(<RankIndexPage catalogue={catalogue} />),
    head: {
      title: 'Rankings',
      description:
        'Every constituency and council in Great Britain, ranked on each benefit, in total and per person.',
      path: '/rank',
      image: '/og/default.png',
      imageAlt: 'Who Gets What: UK benefits by area',
    },
  }
}
