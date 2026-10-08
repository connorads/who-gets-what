/**
 * Plain anchors for the explorer's long lists of links (the table, the top
 * and bottom tens, the measure index). A router `Link` re-resolves its href
 * on every navigation, so hundreds of them make the first frame of every
 * morph long. These anchors resolve their href once per render and navigate
 * through the router on a plain left click; any other click is the browser's.
 */
import { useRouter } from '@tanstack/react-router'
import { useCallback, useMemo, type MouseEvent } from 'react'
import type { ExploreQuery } from '#/domain/url-state.ts'

export interface ExploreLinks {
  readonly hrefFor: (search: ExploreQuery) => string
  readonly follow: (event: MouseEvent<HTMLAnchorElement>) => void
}

export function useExploreLinks(resetScroll: boolean): ExploreLinks {
  const router = useRouter()
  const hrefFor = useCallback(
    (search: ExploreQuery) => router.buildLocation({ to: '/explore', search }).href,
    [router],
  )
  const follow = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return
      event.preventDefault()
      void router.navigate({ href: event.currentTarget.getAttribute('href') ?? '', resetScroll })
    },
    [router, resetScroll],
  )
  return useMemo(() => ({ hrefFor, follow }), [hrefFor, follow])
}
