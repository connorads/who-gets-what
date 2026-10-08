import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useDeferredValue, useMemo } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { exploreSearch } from '#/domain/explore-search.ts'
import { decodeExploreQuery, viewFor, type ExploreState } from '#/domain/url-state.ts'
import { Explorer } from '#/explore/Explorer.tsx'
import { queryFor } from '#/explore/model.ts'
import { textPageHead } from '#/lib/seo.ts'

export const Route = createFileRoute('/explore')({
  // The router runs this on every page, so it keeps strings only; the loader
  // decodes them, which keeps the codec and its schemas out of the main chunk.
  validateSearch: exploreSearch,
  // The view needs no data, so switching views does not re-run the loader.
  loaderDeps: ({ search: { view: _view, ...data } }) => data,
  // Imported on demand, so the codec, data contract and bundle parser stay out of the main chunk.
  loader: async ({ deps }) => (await import('#/explore/load.ts')).loadExplore(deps),
  head: ({ loaderData }) =>
    textPageHead(
      loaderData === undefined ? 'Explore' : `Explore: ${loaderData.metric.shortLabel}`,
      '/explore',
      'Benefit spending for every constituency and council in Great Britain, on one map. Choose a benefit and compare areas in total or per person.',
    ),
  component: ExploreRoute,
  errorComponent: ExploreUnavailable,
})

function ExploreRoute() {
  const loaded = Route.useLoaderData()
  const raw = Route.useSearch({ select: (search) => search.view })
  const view = viewFor(loaded.state.level, decodeExploreQuery({ view: raw }).query.view)
  const data = useMemo(() => ({ ...loaded, state: { ...loaded.state, view } }), [loaded, view])
  const navigate = Route.useNavigate()
  const go = useCallback(
    (next: ExploreState, options?: { readonly replace?: boolean }) =>
      void navigate({
        search: queryFor(next, data.catalogue),
        replace: options?.replace ?? false,
        resetScroll: false,
      }),
    [navigate, data.catalogue],
  )
  // Router updates render synchronously; deferring the state lets React
  // render a change in short slices, so the morph that follows starts
  // without a long frame.
  const shown = useDeferredValue(data)
  return <Explorer data={shown} go={go} />
}

function ExploreUnavailable({ error }: { readonly error: unknown }) {
  console.error('Explorer data failed to load', error)
  return (
    <PageHeader kicker="Explorer" title="The explorer data did not load.">
      <p>
        The data release this site is built from could not be read. Reload the page to try again;
        every figure is also on the area pages and in the downloads.
      </p>
    </PageHeader>
  )
}
