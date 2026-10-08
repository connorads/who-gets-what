import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { err, ok } from '#/domain/result.ts'
import { createSiteData, type SiteData } from '../site-data.ts'
import { RELEASE, type DataSource } from '../source.ts'

const PUBLIC = new URL('../../../public/', import.meta.url)

/** The pulled release (`pnpm run data:pull`) on disk, read as the Worker reads its assets. */
export const fileSource: DataSource = {
  async json(path) {
    const url = new URL(`.${path}`, PUBLIC)
    if (!existsSync(url)) return err({ kind: 'data-missing', path, status: 404 })
    const body: unknown = JSON.parse(await readFile(url, 'utf8'))
    return ok(body)
  },
  async bytes(path) {
    const url = new URL(`.${path}`, PUBLIC)
    if (!existsSync(url)) return err({ kind: 'data-missing', path, status: 404 })
    const file = await readFile(url)
    return ok(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))
  },
}

/** Whether `public/data` holds the pinned release; suites over real data skip without it. */
export const hasPulledRelease = existsSync(new URL(`./data/${RELEASE}/manifest.json`, PUBLIC))

export function pulledSiteData(): SiteData {
  return createSiteData(fileSource, RELEASE)
}
