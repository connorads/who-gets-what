import { createFileRoute } from '@tanstack/react-router'
import { StaticMarkup } from '#/components/StaticMarkup.tsx'
import { pageOrThrow } from '#/lib/page-result.ts'
import { headTags } from '#/lib/seo.ts'
import { getDataPage } from '#/server/pages.ts'

export const Route = createFileRoute('/data')({
  loader: async () => pageOrThrow(await getDataPage()),
  head: ({ loaderData }) => (loaderData === undefined ? {} : headTags(loaderData.head)),
  component: Data,
})

function Data() {
  return <StaticMarkup markup={Route.useLoaderData().markup} />
}
