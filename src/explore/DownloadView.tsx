import { LEVEL_LABEL } from '#/content/labels.ts'
import { perLabel } from '#/domain/measure.ts'
import { periodLabel } from '#/lib/format.ts'
import { useHydrated } from '#/lib/hydrated.ts'
import { saveText } from '#/lib/save-file.ts'
import { viewCsv, viewFileName } from './download.ts'
import type { ExploreData } from './load.ts'
import type { ColumnView } from './model.ts'

/** A browser-only button: the CSV is made from the loaded numbers, so it needs script. */
export function DownloadView({ data, active }: { data: ExploreData; active: ColumnView }) {
  const hydrated = useHydrated()
  if (!hydrated) return null
  const { state, metric } = data
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <button
        type="button"
        className="stage-button"
        onClick={() => saveText(viewFileName(data), viewCsv(data, active.ranking))}
      >
        Download this view (CSV)
      </button>
      <span className="text-xs text-ink-muted">
        {metric.shortLabel}, {perLabel(metric, state.denominator)},{' '}
        {periodLabel(state.period, metric.periodKind)}, every {LEVEL_LABEL[state.level].one}, with
        notes and sources. <a href="/data">Download all the data</a>
      </span>
    </p>
  )
}
