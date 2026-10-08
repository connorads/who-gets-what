import { describe, expect, it } from 'vitest'
import { z } from 'zod/mini'
import { BundleHeader } from './bundle.ts'
import { AreaDossier, AreasMeta, Catalogue, GbValues, Manifest } from './contract.ts'
import { ExploreQuery } from './url-state.ts'

/**
 * The JSON Schemas in contract/schema are generated from these parsers and
 * validated against by the pipeline's tests. `pnpm run test -u` rewrites them.
 */
const SCHEMAS = {
  manifest: Manifest,
  'areas-meta': AreasMeta,
  catalogue: Catalogue,
  'area-dossier': AreaDossier,
  'gb-values': GbValues,
  'bundle-header': BundleHeader,
  'explore-query': ExploreQuery,
}

describe('contract JSON Schemas', () => {
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    it(`${name} matches the committed schema`, async () => {
      const json = `${JSON.stringify(z.toJSONSchema(schema), null, 2)}\n`

      await expect(json).toMatchFileSnapshot(`../../contract/schema/${name}.schema.json`)
    })
  }
})
