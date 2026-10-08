import type { PageHead } from '#/lib/seo.ts'

/**
 * What a server page renderer returns: markup with its head tags, a redirect
 * to the canonical address, or a miss. Markup is a string because these pages
 * hydrate no components of their own (see `StaticMarkup`).
 */
export type PageResult =
  | { readonly kind: 'page'; readonly html: string; readonly head: PageHead }
  | { readonly kind: 'redirect'; readonly href: string }
  | { readonly kind: 'not-found' }

export const notFoundPage: PageResult = { kind: 'not-found' }
