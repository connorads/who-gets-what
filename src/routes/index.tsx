import { createFileRoute } from '@tanstack/react-router'
import { Film } from '#/film/Film.tsx'
import { parseFilmSearch } from '#/film/search.ts'
import { getFilmPage } from '#/film/server.ts'
import { ServerMarkup } from '#/lib/server-markup.ts'
import { DEFAULT_IMAGE, headTags, websiteJsonLd } from '#/lib/seo.ts'
import filmCss from '#/film/film.css?url'

/** The home page is the film; `/film` redirects here. */
export const Route = createFileRoute('/')({
  validateSearch: parseFilmSearch,
  loader: async () => {
    const page = await getFilmPage()
    const stills = Object.fromEntries(
      Object.entries(page.stills).map(([id, html]) => [id, new ServerMarkup(html)]),
    )
    return { ...page, stills }
  },
  head: ({ loaderData }) => {
    const tags = headTags({
      title: loaderData?.title ?? 'Where benefit money goes',
      description:
        loaderData?.description ??
        'One year of benefit spending in Great Britain: who received it and how it was shared out across the constituencies.',
      path: '/',
      image: DEFAULT_IMAGE,
      imageAlt: 'Who Gets What: UK benefits by area',
      jsonLd: websiteJsonLd(),
    })
    return { ...tags, links: [...tags.links, { rel: 'stylesheet', href: filmCss }] }
  },
  component: Home,
})

function Home() {
  const { facts, stills } = Route.useLoaderData()
  const search = Route.useSearch()
  return (
    <Film
      facts={facts}
      stills={{
        'the-pour': stills['the-pour'] ?? new ServerMarkup(''),
        'your-split': stills['your-split'] ?? new ServerMarkup(''),
        'the-wall': stills['the-wall'] ?? new ServerMarkup(''),
        'the-rain': stills['the-rain'] ?? new ServerMarkup(''),
        'two-skylines': stills['two-skylines'] ?? new ServerMarkup(''),
        'north-south-or-age': stills['north-south-or-age'] ?? new ServerMarkup(''),
        'the-landing': stills['the-landing'] ?? new ServerMarkup(''),
      }}
      search={search}
    />
  )
}
