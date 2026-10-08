import type { GeoLevel } from '#/domain/geography.ts'
import { absoluteUrl } from '#/lib/site.ts'

/** Charts an area embed can show, by `?chart=` value; the first is the default. */
export const EMBED_CHARTS = [
  { id: 'spend', label: 'Spending by benefit', height: 560 },
  { id: 'glance', label: 'Main figures with ranks', height: 420 },
  { id: 'trends', label: 'Changes over time', height: 760 },
  { id: 'model', label: 'Spending compared with the expected level', height: 440 },
  { id: 'neighbours', label: 'Similar areas', height: 720 },
] as const

export type EmbedChart = (typeof EMBED_CHARTS)[number]['id']

/**
 * Runs in the embed's head before paint: shows the chart `?chart=` names
 * (the first by default) and opens links in a new tab, out of the host page.
 */
export const EMBED_CHART_SCRIPT = `(function(){var d=document.documentElement,c=new URLSearchParams(location.search).get('chart'),ok=${JSON.stringify(
  EMBED_CHARTS.map((chart) => chart.id),
)};d.setAttribute('data-chart',ok.indexOf(c)>=0?c:ok[0]);document.addEventListener('DOMContentLoaded',function(){document.querySelectorAll('a[href]').forEach(function(a){a.target='_blank';a.rel='noopener'})})})();`

export function embedPath(level: GeoLevel, code: string, chart: EmbedChart): string {
  return `/embed/area/${level}/${code}?chart=${chart}`
}

/** The iframe a reader copies. The title names the area and the chart for screen readers. */
export function embedCode(level: GeoLevel, code: string, name: string, chart: EmbedChart): string {
  const spec = EMBED_CHARTS.find((entry) => entry.id === chart) ?? EMBED_CHARTS[0]
  const src = absoluteUrl(embedPath(level, code, spec.id))
  return `<iframe src="${src}" title="${name}: ${spec.label.toLowerCase()}, Who Gets What" width="100%" height="${spec.height}" style="border:0" loading="lazy"></iframe>`
}
