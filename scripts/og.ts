/**
 * `pnpm run og` (run by `pnpm run build`): 1200 x 630 share cards for every
 * area and ranking, and the default card, rendered with Takumi into
 * dist/client/og/. Each area card carries one comparative fact, a hex
 * locator and a caveat line burned into the image, so the fact cannot be
 * shared without its denominator and basis.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Renderer } from '@takumi-rs/core'
import { fromHtml } from '@takumi-rs/helpers/html'
import sharp from 'sharp'
import { shareFact, type AreaView } from '../src/content/area.ts'
import { basisLabel } from '../src/content/labels.ts'
import { loadAreaView } from '../src/content/load.ts'
import { buildRankView, type RankView } from '../src/content/rank.ts'
import { pulledSiteData } from '../src/data/testing/file-source.ts'
import type { SiteData } from '../src/data/site-data.ts'
import type { AreasMeta } from '../src/domain/contract.ts'
import { GeoLevel } from '../src/domain/geography.ts'
import { hexCentre, hexFrame, hexPath } from '../src/viz/svg/hex.ts'

export const CARD = { width: 1200, height: 630 } as const

// The light theme's tokens (src/styles.css): oat paper, espresso ink, one terracotta.
const PAPER = '#fbf5ec'
const SURFACE = '#fffcf7'
const SUNKEN = '#f3e9db'
const INK = '#2b211c'
const MUTED = '#6a5a4e'
const BRASS = '#c9a35e'
const CLAY = '#ce7c56'
const VERDIGRIS = '#428787'
const TONE = '#b44c22'
const TONE_INK = '#9e4521'
const TONE_SOFT = '#f8e2d2'
const RULE = '#ece0d0'
const OTHER_CELLS = '#e6d8c4'

const DISPLAY = "'Bricolage Grotesque'"
const BODY = "'Atkinson Hyperlegible Next'"

const escape = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const dataUrl = (svg: string): string =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

/** The monogram from src/components/Wordmark.tsx: one coin cut into unequal shares. */
const MONOGRAM = dataUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64"><path d="M17 16V2.5a13.5 13.5 0 0 1 0 27Z" fill="${BRASS}"/><path d="M15 17v13.5A13.5 13.5 0 0 1 1.5 17Z" fill="${CLAY}"/><path d="M15 15H1.5A13.5 13.5 0 0 1 15 1.5Z" fill="${VERDIGRIS}"/></svg>`,
)

/** The level's hex map with one area in terracotta, as an SVG data URL. */
export function locatorSvg(areas: AreasMeta, code: string, size = 12): string {
  const cells = areas.areas.map((area) => ({ code: area.code, q: area.hex.q, r: area.hex.r }))
  const bounds = hexFrame(cells)
  const width = Math.ceil(bounds.width * size)
  const height = Math.ceil(bounds.height * size)
  const others = hexPath(
    cells.filter((cell) => cell.code !== code),
    bounds,
    size,
  )
  const picked = hexPath(
    cells.filter((cell) => cell.code === code),
    bounds,
    size,
    1.3,
  )
  const area = areas.areas.find((entry) => entry.code === code)
  const [cx, cy] = area === undefined ? [0, 0] : hexCentre(area.hex)
  const ring =
    area === undefined
      ? ''
      : `<circle cx="${(cx - bounds.minX) * size}" cy="${(cy - bounds.minY) * size}" r="${size * 3.2}" fill="none" stroke="${TONE}" stroke-width="3"/>`
  return dataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><path d="${others}" fill="${OTHER_CELLS}"/>${ring}<path d="${picked}" fill="${TONE}" stroke="${SURFACE}" stroke-width="2"/></svg>`,
  )
}

/** A short label above a heading: a soft terracotta pill. */
const tag = (text: string) =>
  `<div style="display:flex;align-self:flex-start;font-family:${BODY};font-weight:700;font-size:20px;color:${TONE_INK};background:${TONE_SOFT};border-radius:999px;padding:6px 18px">${escape(text)}</div>`

/** A caveat burned into the card, on a sunken rounded panel. */
const caveatBox = (text: string) =>
  `<div style="display:flex;font-family:${BODY};font-size:18px;line-height:1.4;margin-top:auto;padding:14px 18px;border-radius:16px;background:${SUNKEN};color:${MUTED}">${escape(text)}</div>`

const frame = (body: string) => `
<div style="display:flex;width:${CARD.width}px;height:${CARD.height}px;background:${PAPER};color:${INK};font-family:${BODY};padding:48px 64px 40px;flex-direction:column;justify-content:space-between">
${body}
<div style="display:flex;justify-content:space-between;align-items:center;border-top:2px solid ${RULE};padding-top:20px;margin-top:24px">
<div style="display:flex;align-items:center"><img src="${MONOGRAM}" style="width:40px;height:40px" /><span style="font-family:${DISPLAY};font-weight:700;font-size:30px;letter-spacing:-0.6px;margin-left:12px">Who Gets What</span></div>
<div style="display:flex;font-family:${BODY};font-weight:600;font-size:19px;color:${MUTED}">UK benefits by area · Great Britain</div>
</div>
</div>`

/** The area card: where it is, name, one comparative fact, caveat line, hex locator. */
export function areaCardHtml(view: AreaView, locator: string): string {
  const fact = view.glance[0]
  const caveat =
    fact === undefined
      ? 'Great Britain only. Sources: DWP, Social Security Scotland, ONS.'
      : `Ranked ${fact.rankText} ${fact.denominatorText}, ${fact.periodText}. Money in ${basisLabel('real-gdp', view.priceBase)}. This compares ${view.levelLabel.many} and does not judge them. Great Britain only. Sources: DWP, Social Security Scotland, ONS.`
  const name = escape(view.name)
  const nameSize = view.name.length > 28 ? 62 : view.name.length > 18 ? 78 : 96
  return frame(`
<div style="display:flex;gap:40px;flex-grow:1">
<div style="display:flex;flex-direction:column;flex-grow:1;width:760px">
${tag(`${view.levelLabel.title} · ${view.nationLabel}`)}
<div style="display:flex;font-family:${DISPLAY};font-weight:700;font-size:${nameSize}px;line-height:1.02;letter-spacing:-2px;margin-top:20px">${name}</div>
<div style="display:flex;font-family:${BODY};font-size:34px;line-height:1.3;margin-top:22px;color:${INK}">${escape(shareFact(view))}</div>
${caveatBox(caveat)}
</div>
<div style="display:flex;width:300px;align-items:center;justify-content:center;background:${SURFACE};border:2px solid ${RULE};border-radius:28px">
<img src="${locator}" style="width:260px;height:340px;object-fit:contain" />
</div>
</div>`)
}

/** The ranking card: measure, period and the five highest areas of the default level. */
export function rankCardHtml(view: RankView): string {
  const table = view.tables[0]
  const top = (table?.rows ?? []).filter((row) => row.rank !== null).slice(0, 5)
  const rows = top
    .map(
      (row) =>
        `<div style="display:flex;justify-content:space-between;border-bottom:2px solid ${RULE};padding:10px 0;font-size:26px"><div style="display:flex"><span style="font-weight:700;color:${TONE_INK};width:48px">${row.rank ?? ''}</span>${escape(row.name)}</div><div style="display:flex;font-weight:700">${escape(row.figure?.text['real-gdp'] ?? '')}</div></div>`,
    )
    .join('')
  const caveat = `${table?.rankOf ?? 0} ${table?.levelLabel.many ?? ''} ranked, ${table?.periodText ?? ''}. ${view.money ? `Money in ${basisLabel('real-gdp', view.priceBase)}. ` : ''}Rank 1 is the highest value.${(table?.derivedCount ?? 0) > 0 ? ' Some figures are estimates.' : ''}`
  return frame(`
<div style="display:flex;gap:56px;flex-grow:1">
<div style="display:flex;flex-direction:column;width:520px">
${tag('Ranking')}
<div style="display:flex;font-family:${DISPLAY};font-weight:700;font-size:58px;line-height:1.04;letter-spacing:-1.2px;margin-top:20px">${escape(view.metric.shortLabel)}</div>
<div style="display:flex;font-family:${DISPLAY};font-weight:600;font-size:36px;line-height:1.15;margin-top:10px;color:${TONE_INK}">${escape(view.denominatorText)}</div>
${caveatBox(caveat)}
</div>
<div style="display:flex;flex-direction:column;flex-grow:1;justify-content:center">${rows}</div>
</div>`)
}

/** The site's own card: the name, what it publishes, and the monogram large. */
export function defaultCardHtml(): string {
  return `
<div style="display:flex;width:${CARD.width}px;height:${CARD.height}px;background:${PAPER};color:${INK};font-family:${BODY};padding:72px;align-items:center;justify-content:space-between">
<div style="display:flex;flex-direction:column;width:760px">
${tag('Benefits by area · Great Britain')}
<div style="display:flex;font-family:${DISPLAY};font-weight:700;font-size:92px;line-height:1;letter-spacing:-2.5px;margin-top:24px">Who Gets What</div>
<div style="display:flex;font-size:30px;line-height:1.4;margin-top:24px;color:${MUTED}">Benefit spending and the number of people claiming, for every constituency and council, with the source of every figure.</div>
</div>
<img src="${MONOGRAM}" style="width:240px;height:240px" />
</div>`
}

/**
 * A card as a 256-colour palette PNG: the cards are flat colour, so the
 * palette looks the same and the file is about 45% smaller. No dithering, as
 * it grains the flat fills.
 */
export async function renderCard(renderer: Renderer, html: string): Promise<Buffer> {
  const { node, css } = fromHtml(html)
  const png = await renderer.render(node, {
    width: CARD.width,
    height: CARD.height,
    format: 'png',
    css,
  })
  return sharp(png)
    .png({ palette: true, colours: 256, dither: 0, effort: 10, compressionLevel: 9 })
    .toBuffer()
}

export async function cardRenderer(root: string): Promise<Renderer> {
  const renderer = new Renderer()
  const font = (path: string) => readFile(join(root, 'node_modules', path))
  const [display, body] = await Promise.all([
    font(
      '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2',
    ),
    font(
      '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2',
    ),
  ])
  await renderer.registerFont({ name: 'Bricolage Grotesque', data: display })
  await renderer.registerFont({ name: 'Atkinson Hyperlegible Next', data: body })
  return renderer
}

async function areaCards(data: SiteData, renderer: Renderer, out: string): Promise<number> {
  const written = await Promise.all(
    GeoLevel.options.map(async (level) => {
      const areas = await data.areas(level)
      await mkdir(join(out, 'area', level), { recursive: true })
      const cards = await Promise.all(
        areas.areas.map(async (area) => {
          const view = await loadAreaView(data, level, area.code)
          if (view === undefined) return 0
          const png = await renderCard(renderer, areaCardHtml(view, locatorSvg(areas, view.code)))
          await writeFile(join(out, 'area', level, `${view.code}.png`), png)
          return 1
        }),
      )
      return cards.reduce<number>((sum, card) => sum + card, 0)
    }),
  )
  return written.reduce((sum, level) => sum + level, 0)
}

async function rankCards(data: SiteData, renderer: Renderer, out: string): Promise<number> {
  const catalogue = await data.catalogue()
  const jobs = catalogue.metrics.flatMap((metric) =>
    metric.denominators.map(async (denominator) => {
      const levels = await Promise.all(
        GeoLevel.options.map(async (level) => {
          const bundle = await data.series(level, metric.id, denominator)
          if (!bundle.ok) return undefined
          return { areas: await data.areas(level), gb: await data.gb(level), bundle: bundle.value }
        }),
      )
      const view = buildRankView(
        catalogue,
        metric,
        denominator,
        levels.filter((level) => level !== undefined),
      )
      await mkdir(join(out, 'rank', metric.id), { recursive: true })
      await writeFile(
        join(out, 'rank', metric.id, `${denominator}.png`),
        await renderCard(renderer, rankCardHtml(view)),
      )
    }),
  )
  await Promise.all(jobs)
  return jobs.length
}

async function main(): Promise<void> {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const out = join(root, 'dist', 'client', 'og')
  const data = pulledSiteData()
  const renderer = await cardRenderer(root)
  await mkdir(out, { recursive: true })
  await writeFile(join(out, 'default.png'), await renderCard(renderer, defaultCardHtml()))
  const areas = await areaCards(data, renderer, out)
  const ranks = await rankCards(data, renderer, out)
  console.warn(`share cards: ${areas} area, ${ranks} rank, 1 default in dist/client/og`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
