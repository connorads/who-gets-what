import { enhance } from '#/lib/enhance.ts'
import type { ServerMarkup } from '#/lib/server-markup.ts'

/**
 * Server-rendered page markup. React hydrates the wrapper, not the content:
 * on first load the markup arrives empty (see `ServerMarkup`) and React keeps
 * the server's DOM, so data pages ship no chart or page code. `enhance` wires
 * the few controls.
 */
export function StaticMarkup({ markup }: { markup: ServerMarkup }) {
  return (
    <div
      ref={(node) => (node === null ? undefined : enhance(node))}
      className="contents"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: markup.html }}
    />
  )
}
