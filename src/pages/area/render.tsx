import { renderToStaticMarkup } from 'react-dom/server'
import { areaPath } from '#/content/labels.ts'
import { shareFact } from '#/content/area.ts'
import { loadAreaView, lookupArea } from '#/content/load.ts'
import type { SiteData } from '#/data/site-data.ts'
import { GeoLevel } from '#/domain/geography.ts'
import { notFoundPage, type PageResult } from '../result.ts'
import { AreaIndexPage } from './AreaIndexPage.tsx'
import { AreaPage } from './AreaPage.tsx'

export async function renderAreaIndex(data: SiteData): Promise<PageResult> {
  const levels = await Promise.all(GeoLevel.options.map((level) => data.areas(level)))
  return {
    kind: 'page',
    html: renderToStaticMarkup(<AreaIndexPage levels={levels} />),
    head: {
      title: 'Areas',
      description:
        'Find any constituency or council in Great Britain by postcode or name. See its benefit spending, the number of people claiming, and how it ranks.',
      path: '/area',
      image: '/og/default.png',
      imageAlt: 'Who Gets What: UK benefits by area',
    },
  }
}

export async function renderAreaPage(
  data: SiteData,
  params: { readonly level: string; readonly area: string },
): Promise<PageResult> {
  const found = await lookupArea(data, params.level, params.area)
  if (found.kind === 'not-found') return notFoundPage
  const { level, area } = found
  if (!found.canonical) return { kind: 'redirect', href: areaPath(level, area) }
  const [view, areas] = await Promise.all([loadAreaView(data, level, area.code), data.areas(level)])
  if (view === undefined) return notFoundPage
  const cells = areas.areas.map((entry) => ({ code: entry.code, q: entry.hex.q, r: entry.hex.r }))
  return {
    kind: 'page',
    html: renderToStaticMarkup(<AreaPage view={view} locator={{ cells }} />),
    head: {
      title: `${view.name} ${view.levelLabel.one}: benefits by area`,
      description: `${view.summary} Benefit spending, people claiming, changes over time and ranks for ${view.name}, a ${view.levelLabel.one} in ${view.nationLabel}.`,
      path: view.path,
      image: `/og/area/${level}/${view.code}.png`,
      imageAlt: `${view.name}: ${shareFact(view)}`,
    },
  }
}
