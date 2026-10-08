import { createFileRoute } from '@tanstack/react-router'
import { StaticMarkup } from '#/components/StaticMarkup.tsx'
import { pageOrThrow } from '#/lib/page-result.ts'
import { headTags } from '#/lib/seo.ts'
import { getAreaPage } from '#/server/pages.ts'

export const Route = createFileRoute('/area/$level/$area/')({
  loader: async ({ params }) => pageOrThrow(await getAreaPage({ data: params })),
  head: ({ loaderData }) => (loaderData === undefined ? {} : headTags(loaderData.head)),
  component: AreaDossier,
})

function AreaDossier() {
  return <StaticMarkup markup={Route.useLoaderData().markup} />
}
