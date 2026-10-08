import { createFileRoute } from '@tanstack/react-router'
import { StaticMarkup } from '#/components/StaticMarkup.tsx'
import { pageOrThrow } from '#/lib/page-result.ts'
import { headTags } from '#/lib/seo.ts'
import { getAreaIndex } from '#/server/pages.ts'

export const Route = createFileRoute('/area/')({
  loader: async () => pageOrThrow(await getAreaIndex()),
  head: ({ loaderData }) => (loaderData === undefined ? {} : headTags(loaderData.head)),
  component: Areas,
})

function Areas() {
  return <StaticMarkup markup={Route.useLoaderData().markup} />
}
