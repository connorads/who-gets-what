/**
 * Search and share tags for a page: title, description, canonical link,
 * Open Graph and Twitter cards. Every image is a share card generated at build.
 */
import { absoluteUrl, pageTitle, SITE_AUTHOR, SITE_DESCRIPTION, SITE_NAME } from './site.ts'

export interface PageHead {
  /** The page's own name; the site name is appended. */
  readonly title: string
  readonly description: string
  /** Canonical path, starting with `/`. */
  readonly path: string
  /** Share card path, starting with `/`. */
  readonly image: string
  readonly imageAlt: string
  readonly noindex?: boolean
  /**
   * An inline script for the head, run before first paint. It travels in the
   * page's loader data, so its source stays out of the client bundle.
   */
  readonly script?: string
  /** Schema.org structured data; every value in it must also show on the page. */
  readonly jsonLd?: Readonly<Record<string, unknown>>
}

export const DEFAULT_IMAGE = '/og/default.png'

export function headTags(head: PageHead) {
  const title = pageTitle(head.title)
  const url = absoluteUrl(head.path)
  const image = absoluteUrl(head.image)
  return {
    meta: [
      { title },
      { name: 'description', content: head.description },
      ...(head.noindex === true ? [{ name: 'robots', content: 'noindex' }] : []),
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: head.description },
      { property: 'og:url', content: url },
      { property: 'og:image', content: image },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: head.imageAlt },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: head.description },
      { name: 'twitter:image', content: image },
      { name: 'twitter:image:alt', content: head.imageAlt },
    ],
    links: head.noindex === true ? [] : [{ rel: 'canonical', href: url }],
    scripts: [
      ...(head.script === undefined ? [] : [{ children: head.script }]),
      ...(head.jsonLd === undefined
        ? []
        : [{ type: 'application/ld+json', children: jsonLdText(head.jsonLd) }]),
    ],
  }
}

/** Tags for a text page with the default share card. */
export function textPageHead(title: string, path: string, description = SITE_DESCRIPTION) {
  return headTags({
    title,
    description,
    path,
    image: DEFAULT_IMAGE,
    imageAlt: 'Who Gets What: UK benefits by area',
  })
}

/** JSON with `<` escaped, so no string in it can close the script element. */
function jsonLdText(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

/** The maker, as named in the footer. */
export const AUTHOR_JSON_LD = {
  '@type': 'Person',
  name: SITE_AUTHOR.name,
  url: SITE_AUTHOR.url,
  sameAs: [SITE_AUTHOR.url],
} as const

/** The site itself, for the home page. */
export function websiteJsonLd(): Readonly<Record<string, unknown>> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: absoluteUrl('/'),
    inLanguage: 'en-GB',
    creator: AUTHOR_JSON_LD,
  }
}
