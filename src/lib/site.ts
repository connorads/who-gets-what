export const SITE_NAME = 'Who Gets What'

/** The person who makes the site, credited in the footer, on /about and as the `twitter:creator`. */
export const SITE_AUTHOR = {
  name: 'Connor Adams',
  handle: '@connorads',
  url: 'https://x.com/connorads',
} as const

/** The public repository: code, data pipeline and data releases. */
export const SITE_SOURCE = 'https://github.com/connorads/who-gets-what'

export const SITE_DESCRIPTION =
  'Benefit spending and the number of people claiming, for every constituency and council in Great Britain, with the source of every figure.'

/**
 * Stand-in origin until the site has a domain. `.example` is reserved (RFC
 * 2606), so a build without `VITE_SITE_ORIGIN` cannot point at someone else's
 * site; the build warns when it is used.
 */
export const PLACEHOLDER_ORIGIN = 'https://who-gets-what.example'

/** Absolute origin for canonical links, share cards, embed code and the sitemap. */
export const SITE_ORIGIN: string = (
  import.meta.env?.VITE_SITE_ORIGIN ?? PLACEHOLDER_ORIGIN
).replace(/\/$/, '')

/** Document title for a page: its own name, then the site name. */
export function pageTitle(name: string): string {
  return `${name} · ${SITE_NAME}`
}

export function absoluteUrl(path: string): string {
  return `${SITE_ORIGIN}${path}`
}
