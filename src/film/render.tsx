/**
 * The film page's server half: figures and stills from the pinned release.
 * Stills are markup strings, so the route sends them once as HTML and the
 * browser never runs the code that drew them (ADR 0007).
 */
import { renderToStaticMarkup } from 'react-dom/server'
import type { BenefitFamily } from '#/domain/benefit.ts'
import type { SiteData } from '#/data/site-data.ts'
import { loadFilmData } from './data.ts'
import { billionsInWords, filmFacts, type FilmFacts } from './facts.ts'
import { filmFigures } from './figures.ts'
import { ChapterId, SCRIPT } from './script.ts'
import { renderStills } from './stills.tsx'

export interface FilmPage {
  readonly facts: FilmFacts
  /** Each chapter's still as HTML; empty for a chapter without one. */
  readonly stills: Readonly<Record<ChapterId, string>>
  readonly title: string
  readonly description: string
}

export async function renderFilmPage(site: SiteData): Promise<FilmPage> {
  const [data, catalogue] = await Promise.all([loadFilmData(site, SCRIPT), site.catalogue()])
  const labels = new Map<BenefitFamily, string>(
    catalogue.families.map((family) => [family.id, family.label]),
  )
  const facts = filmFacts(SCRIPT, data, filmFigures(data), labels)
  const nodes = renderStills(SCRIPT, data, facts)
  const stills = Object.fromEntries(
    ChapterId.options.map((id) => [id, nodes[id] === null ? '' : renderToStaticMarkup(nodes[id])]),
  )
  return {
    facts,
    stills: {
      'the-pour': stills['the-pour'] ?? '',
      'your-split': stills['your-split'] ?? '',
      'the-wall': stills['the-wall'] ?? '',
      'the-rain': stills['the-rain'] ?? '',
      'two-skylines': stills['two-skylines'] ?? '',
      'north-south-or-age': stills['north-south-or-age'] ?? '',
      'the-landing': stills['the-landing'] ?? '',
    },
    title: SCRIPT.title,
    description: `${SCRIPT.title}:
 ${billionsInWords(facts.total)} of benefits paid in ${facts.period}, who received it and how it was shared out across the ${facts.areaCount} constituencies of Great Britain.`,
  }
}
