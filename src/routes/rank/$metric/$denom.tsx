import { createFileRoute } from '@tanstack/react-router'
import { StaticMarkup } from '#/components/StaticMarkup.tsx'
import { pageOrThrow } from '#/lib/page-result.ts'
import { headTags } from '#/lib/seo.ts'
import { getRankPage } from '#/server/pages.ts'

export const Route = createFileRoute('/rank/$metric/$denom')({
  loader: async ({ params }) => pageOrThrow(await getRankPage({ data: params })),
  head: ({ loaderData }) => (loaderData === undefined ? {} : headTags(loaderData.head)),
  component: Ranking,
})

function Ranking() {
  return <StaticMarkup markup={Route.useLoaderData().markup} />
}
