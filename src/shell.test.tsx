import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { hasPulledRelease } from './data/testing/file-source.ts'
import { findBannedPhrases, findStylePhrases } from './domain/neutrality.ts'
import { getRouter } from './router'

// The home page's loader is a server function; here it renders the film from the pulled release.
vi.mock('./film/server.ts', async () => {
  const [{ renderFilmPage }, { pulledSiteData }] = await Promise.all([
    import('./film/render.tsx'),
    import('./data/testing/file-source.ts'),
  ])
  return { getFilmPage: () => renderFilmPage(pulledSiteData()) }
})

async function render(path: string) {
  const router = getRouter()
  router.update({ ...router.options, history: createMemoryHistory({ initialEntries: [path] }) })
  await router.load()
  return { html: renderToString(<RouterProvider router={router} />) }
}

/** Visible text plus the attributes a reader or a search result shows. */
function readableText(html: string): string {
  const withoutCode = html.replaceAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, ' ')
  const attributes = Array.from(
    withoutCode.matchAll(/\s(?:aria-label|alt|title|content|placeholder)="([^"]*)"/g),
    (match) => match[1],
  )
  return [withoutCode.replaceAll(/<[^>]+>/g, ' '), ...attributes].join(' ')
}

// The home page is the film, which needs the pulled release.
const PAGES = hasPulledRelease
  ? (['/', '/explore', '/about', '/styleguide'] as const)
  : (['/explore', '/about', '/styleguide'] as const)

describe('app shell', () => {
  it.each(PAGES)('%s renders the document shell', async (path) => {
    const { html } = await render(path)

    expect(html).toContain('<html lang="en-GB"')
    expect(html).toMatch(/<a href="#main" class="skip-link">Skip to content<\/a>/)
    expect(html).toContain('<main id="main"')
    expect(html).toContain('aria-label="Primary"')
    expect(html).toContain('Who publishes this site')
    expect(html).toContain('Northern Ireland is not included')
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1)
  })

  it.each(PAGES)('%s uses no banned or style-list words', async (path) => {
    const { html } = await render(path)

    expect(findBannedPhrases(readableText(html))).toEqual([])
    expect(findStylePhrases(readableText(html))).toEqual([])
  })

  it.each(PAGES)('%s carries no starter template copy', async (path) => {
    const { html } = await render(path)

    expect(html).not.toMatch(/TanStack Start Starter|lagoon|island-shell/)
  })

  it.each(PAGES)('%s credits the maker in the footer and share card', async (path) => {
    const { html } = await render(path)

    expect(html).toContain('href="https://x.com/connorads"')
    expect(html).toContain('<meta name="twitter:creator" content="@connorads"')
  })

  it.each(PAGES)('%s links the source code from the footer', async (path) => {
    const { html } = await render(path)

    expect(html).toContain('href="https://github.com/connorads/who-gets-what"')
  })

  it('names the X account on /about as the place to report a mistake', async () => {
    const { html } = await render('/about')

    expect(readableText(html).replaceAll(/\s+/g, ' ')).toContain(
      'To report a mistake, message @connorads on X.',
    )
  })

  it('marks the current page in the primary navigation', async () => {
    const { html } = await render('/about')

    expect(html).toMatch(
      /<a[^>]*class="nav-link"[^>]*href="\/about"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/about"/,
    )
  })

  it('links Home to the film, current only there', async () => {
    const { html } = await render('/about')

    expect(html).not.toContain('href="/film"')
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Home<\/a>/)
    expect(html).not.toMatch(/<a[^>]*href="\/"[^>]*aria-current="page"[^>]*>Home/)
  })

  it.runIf(hasPulledRelease)('titles the film on the home page in plain words', async () => {
    const { html } = await render('/')

    expect(html).toContain('<title>Where benefit money goes · Who Gets What</title>')
    expect(html).toContain('to allow for inflation')
    expect(html).toContain('id="every-constituency"')
  })

  it('renders the not-found page for an unknown path', async () => {
    const { html } = await render('/no-such-page')

    expect(html).toContain('Page not found')
  })

  it('places the theme and motion toggles in the header', async () => {
    const { html } = await render('/')

    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('Reduce motion')
    expect(html).toContain('Theme follows the system')
  })

  it('keeps the styleguide out of search indexes', async () => {
    const router = getRouter()
    router.update({
      ...router.options,
      history: createMemoryHistory({ initialEntries: ['/styleguide'] }),
    })
    await router.load()
    const robots = router.state.matches
      .flatMap((m) => m.meta ?? [])
      .find((m) => m?.name === 'robots')

    expect(robots?.content).toBe('noindex, nofollow')
  })
})
