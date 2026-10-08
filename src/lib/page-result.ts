import { notFound, redirect } from '@tanstack/react-router'
import type { PageResult } from '#/pages/result.ts'
import { ServerMarkup } from './server-markup.ts'

/**
 * A route loader's view of a rendered page: redirects and misses become
 * router control flow, and the markup is wrapped so it is not sent twice.
 */
export function pageOrThrow(page: PageResult) {
  // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router reads thrown redirects as control flow
  if (page.kind === 'redirect') throw redirect({ href: page.href, statusCode: 301 })
  // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router reads a thrown notFound as control flow
  if (page.kind === 'not-found') throw notFound()
  return { head: page.head, markup: new ServerMarkup(page.html) }
}
