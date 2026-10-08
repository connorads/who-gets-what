/**
 * Worker entry. Static files, the data release included, are served by the
 * Workers asset layer before this runs; server rendering reads the same files
 * through the `ASSETS` binding.
 */
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { assetsSource } from '#/data/assets-source.server.ts'
import { setServerSource } from '#/data/source.ts'

setServerSource(assetsSource)

export default createServerEntry({ fetch: (request) => handler.fetch(request) })
