import { createFileRoute } from '@tanstack/react-router'
import { StaticMarkup } from '#/components/StaticMarkup.tsx'
import { pageOrThrow } from '#/lib/page-result.ts'
import { headTags } from '#/lib/seo.ts'
import { getRankIndex } from '#/server/pages.ts'

export const Route = createFileRoute('/rank/')({
  loader: async () => pageOrThrow(await getRankIndex()),
  head: ({ loaderData }) => (loaderData === undefined ? {} : headTags(loaderData.head)),
  component: Rankings,
})

function Rankings() {
  return <StaticMarkup markup={Route.useLoaderData().markup} />
}
