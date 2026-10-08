import { describe, expect, it } from 'vitest'
import { hasPulledRelease, pulledSiteData } from '#/data/testing/file-source.ts'

describe('source links', () => {
  it.runIf(hasPulledRelease)('links no source to a code host', async () => {
    const catalogue = await pulledSiteData().catalogue()
    for (const source of catalogue.sources) expect(source.url).not.toMatch(/github/i)
  })
})
