import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ARCHIVE, downloadFiles } from '#/content/downloads.ts'
import { ReleaseId } from '#/domain/contract.ts'
import { DataPage } from './DataPage.tsx'
import { hasPulledRelease, pulledSiteData } from '#/data/testing/file-source.ts'
import { renderDataPage } from '../reference.tsx'

describe.runIf(hasPulledRelease)('the data page over the pulled release', () => {
  it('links every download on this site with its checksum', async () => {
    const data = pulledSiteData()
    const [manifest, page] = await Promise.all([data.manifest(), renderDataPage(data)])
    if (page.kind !== 'page') throw new Error('no data page')
    const files = downloadFiles(manifest.files)

    expect(files.length).toBeGreaterThan(20)
    for (const file of files) {
      expect(page.html).toContain(`href="/data/${manifest.release}/${file.path}"`)
      expect(page.html).toContain(file.sha256)
    }
    expect(page.html).toContain(`href="/data/${manifest.release}/manifest.json"`)
  })

  it('describes the release as a Dataset whose values the page shows', async () => {
    const data = pulledSiteData()
    const [manifest, page] = await Promise.all([data.manifest(), renderDataPage(data)])
    if (page.kind !== 'page') throw new Error('no data page')
    const dataset = page.head.jsonLd ?? {}

    expect(dataset['@type']).toBe('Dataset')
    expect(String(dataset['description']).length).toBeGreaterThanOrEqual(50)
    expect(dataset['version']).toBe(manifest.release)
    expect(page.html).toContain(manifest.release)
    expect(page.html).toContain(String(dataset['license']))
    const urls = [...JSON.stringify(dataset).matchAll(/"contentUrl":"([^"]+)"/g)].map(
      (match) => new URL(match[1] ?? '').pathname,
    )
    expect(urls.length).toBe(downloadFiles(manifest.files).length + 1)
    for (const url of urls) expect(page.html).toContain(`href="${url}"`)
  })

  it('offers the archive of every table when the release has one, and not otherwise', async () => {
    const data = pulledSiteData()
    const [manifest, catalogue] = await Promise.all([data.manifest(), data.catalogue()])
    const zip = { bytes: 4_761_694, sha256: 'b'.repeat(64) }
    const without = { ...manifest, files: { ...manifest.files } }
    delete without.files[ARCHIVE]
    const withZip = { ...manifest, files: { ...manifest.files, [ARCHIVE]: zip } }

    const html = renderToStaticMarkup(<DataPage manifest={withZip} catalogue={catalogue} />)
    expect(html).toContain(`href="/data/${manifest.release}/${ARCHIVE}"`)
    expect(html).toContain(`download="who-gets-what-data-${manifest.release}.zip"`)
    expect(html).toContain('4.8 MB')
    expect(html).toContain(zip.sha256)
    expect(
      renderToStaticMarkup(<DataPage manifest={without} catalogue={catalogue} />),
    ).not.toContain('all-tables.zip')
  })

  it('dates the release by its id, even when the build ran the evening before', async () => {
    const data = pulledSiteData()
    const [manifest, catalogue] = await Promise.all([data.manifest(), data.catalogue()])
    const late = {
      ...manifest,
      release: ReleaseId.parse('2026-10-07.1'),
      createdAt: '2026-10-06T22:53:48Z',
    }

    const html = renderToStaticMarkup(<DataPage manifest={late} catalogue={catalogue} />)
    expect(html).toContain('<dt>Released</dt><dd>7 October 2026</dd>')
    expect(html).not.toContain('6 October 2026</dd></div>')
  })

  it('states the licence, the OS credit and the release', async () => {
    const page = await renderDataPage(pulledSiteData())
    if (page.kind !== 'page') throw new Error('no data page')

    expect(page.html).toContain('Open Government Licence v3.0')
    expect(page.html).toContain('Contains OS data © Crown copyright and database right')
    expect(page.html).toContain('<dt>Release</dt>')
    expect(page.html).toContain('<summary class="action-link">Columns</summary>')
    expect(page.html).not.toMatch(/github/i)
  })
})
