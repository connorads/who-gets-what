import type { AreaView } from '#/content/area.ts'
import { EMBED_CHARTS, type EmbedChart } from '#/content/embed.ts'
import { absoluteUrl, SITE_NAME } from '#/lib/site.ts'
import {
  GlanceSection,
  ModelSection,
  NeighboursSection,
  SpendSection,
  TrendsSection,
} from '../area/sections.tsx'

const SECTIONS: Readonly<Record<EmbedChart, (props: { view: AreaView }) => React.ReactNode>> = {
  spend: SpendSection,
  glance: GlanceSection,
  trends: TrendsSection,
  model: ModelSection,
  neighbours: NeighboursSection,
}

/**
 * Every embeddable chart for one area; the `?chart=` value picks one before
 * first paint (see `EMBED_CHART_SCRIPT`). Links open the full page in a new
 * tab, so a reader leaves the host page only on purpose.
 */
export function EmbedPage({ view }: { view: AreaView }) {
  return (
    <article className="embed basis-scope">
      <header className="embed__head">
        <p className="kicker">
          {view.levelLabel.title} · {view.nationLabel}
        </p>
        <h1 className="embed__title">{view.name}</h1>
      </header>
      {EMBED_CHARTS.map((chart) => {
        const Section = SECTIONS[chart.id]
        return (
          <div key={chart.id} data-chart={chart.id}>
            <Section view={view} />
          </div>
        )
      })}
      <footer className="embed__foot">
        <p>
          Source: DWP, Social Security Scotland, ONS, NRS and HMRC. Data release {view.release}.
          Great Britain only.
        </p>
        <p>
          <a href={absoluteUrl(view.path)} target="_blank" rel="noopener">
            Every figure for {view.name}, with its limits, on {SITE_NAME}
          </a>
        </p>
      </footer>
    </article>
  )
}
