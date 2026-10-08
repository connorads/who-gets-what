import {
  archiveFile,
  DOWNLOAD_TABLES,
  downloadFiles,
  type DownloadFile,
} from '#/content/downloads.ts'
import type { Catalogue, Manifest } from '#/domain/contract.ts'
import { formatBytes, formatDate } from '#/lib/format.ts'

export const OGL = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'
const OPL =
  'https://www.parliament.uk/site-information/copyright-parliament/open-parliament-licence/'

const fileName = (file: DownloadFile) => file.path.slice('downloads/'.length)

function FileLinks({ files, release }: { files: readonly DownloadFile[]; release: string }) {
  return (
    <ul className="data-table__files">
      {files.map((file) => (
        <li key={file.path}>
          <a href={`/data/${release}/${file.path}`} download>
            {file.format}
            {file.part === '' ? '' : ` ${file.part}`}
          </a>
          <span className="tabular">{formatBytes(file.bytes)}</span>
        </li>
      ))}
    </ul>
  )
}

function Columns({ table }: { table: string }) {
  const dictionary = DOWNLOAD_TABLES[table]
  if (dictionary === undefined) return null
  return (
    <details className="data-table__more">
      <summary className="action-link">Columns</summary>
      <div className="numbers__scroll">
        <table className="ledger-table data-columns">
          <caption className="sr-only">Columns of {table}</caption>
          <thead>
            <tr>
              <th scope="col">Column</th>
              <th scope="col">Type</th>
              <th scope="col">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {dictionary.columns.map((column) => (
              <tr key={column.name}>
                <th scope="row">{column.name}</th>
                <td>{column.type}</td>
                <td>{column.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function Checksums({ files }: { files: readonly DownloadFile[] }) {
  return (
    <details className="data-table__more">
      <summary className="action-link">SHA-256 checksums</summary>
      <dl className="data-hashes">
        {files.map((file) => (
          <div key={file.path}>
            <dt>{fileName(file)}</dt>
            <dd>
              <code>{file.sha256}</code>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

export function DataPage({ manifest, catalogue }: { manifest: Manifest; catalogue: Catalogue }) {
  const release = manifest.release
  // A release id starts with its date, so the page shows that date and the two always agree.
  const released = release.slice(0, 10)
  const files = downloadFiles(manifest.files)
  const archive = archiveFile(manifest.files)
  const tables = [...new Set(files.map((file) => file.table))]
  return (
    <article>
      <header className="pt-12 pb-4 md:pt-20 md:pb-8">
        <p className="kicker">Data · release {release}</p>
        <h1 className="mt-4 max-w-[18ch] font-display text-headline text-balance">
          Download the data
        </h1>
        <div className="mt-6 max-w-prose text-lg text-pretty text-ink-muted">
          <p>
            Every figure on this site comes from one dated data release. You can download all its
            tables here as CSV or Parquet files, and they match the figures on the pages.
          </p>
          <p>
            Each file comes with its size and a SHA-256 checksum, so you can check it downloaded
            correctly.
          </p>
        </div>
      </header>

      <section className="dossier-section" aria-labelledby="release">
        <h2 id="release" className="font-display text-title">
          Release {release}
        </h2>
        <dl className="data-facts">
          <div>
            <dt>Release</dt>
            <dd className="font-mono text-sm">{release}</dd>
          </div>
          <div>
            <dt>Released</dt>
            <dd>{formatDate(released)}</dd>
          </div>
          <div>
            <dt>Prices</dt>
            <dd>
              Cash pounds in every file. The {manifest.priceBase} price factors are in dim_period.
            </dd>
          </div>
          <div>
            <dt>Coverage</dt>
            <dd>
              England, Wales and Scotland.{' '}
              {manifest.coverage.notCovered
                .map((gap) => `${gap.area} is not included. ${gap.reason}`)
                .join(' ')}
            </dd>
          </div>
          <div>
            <dt>Areas</dt>
            <dd>
              {manifest.levels.constituency.areaCount} constituencies (
              {manifest.levels.constituency.boundarySet}) and{' '}
              {manifest.levels['local-authority'].areaCount} local authorities (
              {manifest.levels['local-authority'].boundarySet})
            </dd>
          </div>
          <div>
            <dt>Code version</dt>
            <dd className="font-mono text-sm">{manifest.pipelineCommit.slice(0, 12)}</dd>
          </div>
        </dl>
        <p className="mt-6">
          <a className="action-link" href={`/data/${release}/manifest.json`} download>
            Release manifest (JSON), with every file&apos;s size and SHA-256 checksum
          </a>
        </p>
      </section>

      {archive === undefined ? null : (
        <section className="dossier-section" aria-labelledby="everything">
          <h2 id="everything" className="font-display text-title">
            Download everything
          </h2>
          <p className="mt-2 max-w-prose text-ink-muted">
            Every table below, as CSV and Parquet, in one zip file.
          </p>
          <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <a
              className="action-link"
              href={`/data/${release}/${archive.path}`}
              download={`who-gets-what-data-${release}.zip`}
            >
              Download every table (zip)
            </a>
            <span className="tabular text-sm text-ink-muted">{formatBytes(archive.bytes)}</span>
          </p>
          <dl className="data-hashes">
            <div>
              <dt>SHA-256</dt>
              <dd>
                <code>{archive.sha256}</code>
              </dd>
            </div>
          </dl>
        </section>
      )}

      <section className="dossier-section" aria-labelledby="downloads">
        <h2 id="downloads" className="font-display text-title">
          Tables
        </h2>
        <p className="mt-2 max-w-prose text-ink-muted">
          Every table marks figures that are shared out, estimated or from a survey. The spending
          CSV files are split by area type and year, so each one is under 10 MB. The Parquet file
          holds them all. You can also download a CSV from any map view or area page.
        </p>
        {tables.map((table) => {
          const own = files.filter((file) => file.table === table)
          return (
            <div key={table} className="data-table">
              <h3 className="data-table__name">{table}</h3>
              <p className="data-table__note">{DOWNLOAD_TABLES[table]?.description ?? ''}</p>
              <FileLinks files={own} release={release} />
              <Columns table={table} />
              <Checksums files={own} />
            </div>
          )
        })}
      </section>

      <section className="dossier-section" aria-labelledby="licence">
        <h2 id="licence" className="font-display text-title">
          How you can use the data
        </h2>
        <div className="mt-2 max-w-prose space-y-3">
          <p>
            The downloads are published under the{' '}
            <a href={OGL} rel="noopener">
              Open Government Licence v3.0
            </a>
            . You can copy, publish, change and use them for any purpose if you credit the sources
            like this:
          </p>
          <p className="data-credit">
            Contains public sector information licensed under the Open Government Licence v3.0.
            Contains OS data &copy; Crown copyright and database right {released.slice(0, 4)}.
            Contains Parliamentary information licensed under the{' '}
            <a href={OPL} rel="noopener">
              Open Parliament Licence v3.0
            </a>
            . Hex layouts by Open Innovations, MIT licence. Who Gets What data release {release}.
          </p>
          <p className="text-ink-muted">Each source and its own licence:</p>
        </div>
        <div className="numbers__scroll">
          <table className="ledger-table">
            <caption className="sr-only">Sources in this release</caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Publisher</th>
                <th scope="col">Published</th>
                <th scope="col">Licence</th>
              </tr>
            </thead>
            <tbody>
              {catalogue.sources.map((source) => (
                <tr key={source.id}>
                  <th scope="row">
                    <a href={source.url} rel="noopener">
                      {source.title}
                    </a>
                    <span className="ledger-table__sub font-mono">{source.id}</span>
                  </th>
                  <td>{source.publisher}</td>
                  <td className="tabular">{formatDate(source.published)}</td>
                  <td>{source.licence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </article>
  )
}
