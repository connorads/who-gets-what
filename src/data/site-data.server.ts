import { assetsSource } from './assets-source.server.ts'
import { createSiteData } from './site-data.ts'
import { RELEASE } from './source.ts'

/** The pinned release, read from the Worker's static assets once per isolate. */
export const siteData = createSiteData(assetsSource, RELEASE)
