import { archiveFile, downloadFiles } from '#/content/downloads.ts'
import type { Manifest } from '#/domain/contract.ts'
import { AUTHOR_JSON_LD } from '#/lib/seo.ts'
import { absoluteUrl } from '#/lib/site.ts'
import { OGL } from './DataPage.tsx'

const MEDIA_TYPE = { CSV: 'text/csv', Parquet: 'application/vnd.apache.parquet' } as const

/**
 * The data release as a schema.org Dataset, for Google Dataset Search. Every
 * value matches what the data page shows.
 */
export function datasetJsonLd(manifest: Manifest): Readonly<Record<string, unknown>> {
  const { release } = manifest
  const url = (path: string) => absoluteUrl(`/data/${release}/${path}`)
  const archive = archiveFile(manifest.files)
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `Who Gets What data, release ${release}`,
    description:
      'Benefit spending and the number of people claiming, for every constituency and local authority in England, Wales and Scotland, as CSV and Parquet tables.',
    url: absoluteUrl('/data'),
    version: release,
    datePublished: release.slice(0, 10),
    license: OGL,
    isAccessibleForFree: true,
    creator: AUTHOR_JSON_LD,
    spatialCoverage: 'England, Wales and Scotland',
    distribution: [
      ...(archive === undefined
        ? []
        : [
            {
              '@type': 'DataDownload',
              encodingFormat: 'application/zip',
              contentUrl: url(archive.path),
            },
          ]),
      ...downloadFiles(manifest.files).map((file) => ({
        '@type': 'DataDownload',
        encodingFormat: MEDIA_TYPE[file.format],
        contentUrl: url(file.path),
      })),
    ],
  }
}
