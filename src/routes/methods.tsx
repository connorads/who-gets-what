import { createFileRoute } from '@tanstack/react-router'
import { StaticMarkup } from '#/components/StaticMarkup.tsx'
import { pageOrThrow } from '#/lib/page-result.ts'
import { headTags } from '#/lib/seo.ts'
import { getMethodsPage } from '#/server/pages.ts'

export const Route = createFileRoute('/methods')({
  loader: async () => pageOrThrow(await getMethodsPage()),
  head: ({ loaderData }) => (loaderData === undefined ? {} : headTags(loaderData.head)),
  component: Methods,
})

function Methods() {
  return <StaticMarkup markup={Route.useLoaderData().markup} />
}
