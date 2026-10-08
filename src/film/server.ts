/**
 * The film page's server function. It reads the pinned release through the
 * Worker's `ASSETS` binding, so the renderers and their data code stay on the
 * server.
 */
import { createServerFn } from '@tanstack/react-start'

export const getFilmPage = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ renderFilmPage }, { siteData }] = await Promise.all([
    import('./render.tsx'),
    import('#/data/site-data.server.ts'),
  ])
  return renderFilmPage(siteData)
})
