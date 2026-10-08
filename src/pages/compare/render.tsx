import { renderToStaticMarkup } from 'react-dom/server'
import { buildCompareView } from '#/content/compare.ts'
import { lookupArea } from '#/content/load.ts'
import type { SiteData } from '#/data/site-data.ts'
import { notFoundPage, type PageResult } from '../result.ts'
import { ComparePage } from './ComparePage.tsx'

/**
 * `/area/{level}/{a}/vs/{b}`: same level only, two different areas, canonical
 * slugs. The canonical link puts the lower GSS code first.
 */
export async function renderComparePage(
  data: SiteData,
  params: { readonly level: string; readonly area: string; readonly other: string },
): Promise<PageResult> {
  const [a, b] = await Promise.all([
    lookupArea(data, params.level, params.area),
    lookupArea(data, params.level, params.other),
  ])
  if (a.kind === 'not-found' || b.kind === 'not-found' || a.area.code === b.area.code) {
    return notFoundPage
  }
  const { level } = a
  const slug = (found: typeof a) => `${found.area.code}-${found.area.slug}`
  const path = `/area/${level}/${slug(a)}/vs/${slug(b)}`
  if (!a.canonical || !b.canonical) return { kind: 'redirect', href: path }
  // Both orders are pages, since the order sets the columns; search sees one.
  const [first, second] = a.area.code < b.area.code ? [a, b] : [b, a]
  const canonical = `/area/${level}/${slug(first)}/vs/${slug(second)}`
  const [catalogue, gb, areas, left, right] = await Promise.all([
    data.catalogue(),
    data.gb(level),
    data.areas(level),
    data.dossier(level, a.area.code),
    data.dossier(level, b.area.code),
  ])
  if (!left.ok || !right.ok) return notFoundPage
  const view = buildCompareView({ catalogue, gb, a: left.value, b: right.value })
  const cells = areas.areas.map((entry) => ({ code: entry.code, q: entry.hex.q, r: entry.hex.r }))
  return {
    kind: 'page',
    html: renderToStaticMarkup(<ComparePage view={view} locator={{ cells }} />),
    head: {
      title: `${view.a.name} and ${view.b.name} compared`,
      description: `${view.summary} On ${view.flips} of ${view.rows.length} measures, which area is higher depends on whether you count per person or in total.`,
      path: canonical,
      image: `/og/area/${level}/${view.a.code}.png`,
      imageAlt: `${view.a.name} and ${view.b.name} compared`,
    },
  }
}
