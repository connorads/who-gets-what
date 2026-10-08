import { createFileRoute } from '@tanstack/react-router'
import { StaticMarkup } from '#/components/StaticMarkup.tsx'
import { pageOrThrow } from '#/lib/page-result.ts'
import { headTags } from '#/lib/seo.ts'
import { getEmbedPage } from '#/server/pages.ts'

/** A frameable chart: the root shell drops its header and footer under `/embed/`. */
export const Route = createFileRoute('/embed/area/$level/$code')({
  loader: async ({ params }) => pageOrThrow(await getEmbedPage({ data: params })),
  head: ({ loaderData }) => (loaderData === undefined ? {} : headTags(loaderData.head)),
  component: Embed,
})

function Embed() {
  return <StaticMarkup markup={Route.useLoaderData().markup} />
}
