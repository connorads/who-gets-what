/**
 * "Download these figures" on an area page, loaded on the first click so
 * the page itself ships none of it. The CSV is made in the browser from the
 * release files the page was built from, in the basis the reader has chosen.
 */
import { areaRows } from '#/content/area-csv.ts'
import { csvFileName, figuresCsv } from '#/content/csv.ts'
import { dataSource, RELEASE, required } from '#/data/source.ts'
import {
  dataPath,
  parseAreaDossier,
  parseCatalogue,
  parseGbValues,
  type ContractViolation,
} from '#/domain/contract.ts'
import { AreaCode, GeoLevel } from '#/domain/geography.ts'
import { Basis, DEFAULT_BASIS } from '#/domain/measure.ts'
import type { Result } from '#/domain/result.ts'
import { saveText } from './save-file.ts'

function orThrow<T>(result: Result<T, ContractViolation>): T {
  if (result.ok) return result.value
  throw new Error(result.error.problems.join('\n'))
}

export async function downloadArea(button: HTMLElement, root: HTMLElement): Promise<void> {
  const status = root.querySelector<HTMLElement>('[data-download-status]')
  const level = GeoLevel.parse(button.dataset['downloadArea'])
  const code = AreaCode.parse(button.dataset['code'])
  const checked = root.querySelector<HTMLInputElement>('input[name="basis"]:checked')?.value
  const basis = Basis.safeParse(checked).data ?? DEFAULT_BASIS
  const source = dataSource()
  button.setAttribute('aria-disabled', 'true')
  try {
    const [catalogue, dossier, gb] = await Promise.all([
      required(source.json(dataPath.catalogue(RELEASE))).then((json) =>
        orThrow(parseCatalogue(json)),
      ),
      required(source.json(dataPath.dossier(RELEASE, level, code))).then((json) =>
        orThrow(parseAreaDossier(json)),
      ),
      required(source.json(dataPath.gb(RELEASE, level))).then((json) =>
        orThrow(parseGbValues(json)),
      ),
    ])
    const csv = figuresCsv(areaRows(dossier, gb, catalogue, basis), {
      release: RELEASE,
      basis,
      catalogue,
    })
    saveText(csvFileName([code, dossier.area.slug, basis]), csv)
    if (status !== null) status.textContent = 'Saved.'
  } catch {
    if (status !== null) status.textContent = 'The download failed. Try again.'
  } finally {
    button.removeAttribute('aria-disabled')
  }
}
