import { createFileRoute } from '@tanstack/react-router'
import { StaticMarkup } from '#/components/StaticMarkup.tsx'
import { pageOrThrow } from '#/lib/page-result.ts'
import { headTags } from '#/lib/seo.ts'
import { getComparePage } from '#/server/pages.ts'

/** Rendered on demand by the Worker: there are too many pairs to prerender. */
export const Route = createFileRoute('/area/$level/$area/vs/$other')({
  loader: async ({ params }) => pageOrThrow(await getComparePage({ data: params })),
  head: ({ loaderData }) => (loaderData === undefined ? {} : headTags(loaderData.head)),
  component: Compare,
})

function Compare() {
  return <StaticMarkup markup={Route.useLoaderData().markup} />
}
