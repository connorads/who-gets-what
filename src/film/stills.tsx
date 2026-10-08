/**
 * Each chapter's still: the rest frame of the film drawn as SVG on the
 * server, with a table beside every chart (ADR 0004). Read mode, reduced
 * motion and readers without WebGL see these instead of the canvas, and they
 * are the same numbers the grains show.
 */
import type { ReactNode } from 'react'
import type { BenefitFamily } from '#/domain/benefit.ts'
import { binAll, binEdges, colourDomain, tokenOf, SEQUENTIAL_TOKENS } from '#/viz/colour.ts'
import { beeswarm } from '#/viz/layout/beeswarm.ts'
import { mapFrame, spriteTransform } from '#/viz/layout/map-frame.ts'
import { MARK_FILL } from '#/viz/layout/views.ts'
import type { FilmData } from './data.ts'
import { billions, type FilmFacts } from './facts.ts'
import { topIndices } from './figures.ts'
import { apportion } from './grains/allocate.ts'
import { heapProfile } from './grains/scenes.ts'
import type { ChapterId, Script } from './script.ts'

const pounds = (value: number): string => `£${Math.round(value).toLocaleString('en-GB')}`
const percent = (share: number, digits = 1): string => `${(share * 100).toFixed(digits)}%`
const familyFill = (family: BenefitFamily): string => `var(--family-${family})`
const round1 = (v: number): string => (Math.round(v * 10) / 10).toString()

function Figure({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="film-still">
      {children}
      <figcaption className="film-still__caption">{caption}</figcaption>
    </figure>
  )
}

function PourStill({ facts, caption }: { facts: FilmFacts; caption: string }) {
  const points = Array.from({ length: 61 }, (_, i) => {
    const x = i / 60
    return `${round1(x * 600)},${round1(230 - heapProfile(x) * 190)}`
  })
  return (
    <Figure caption={caption}>
      <svg viewBox="0 0 600 240" aria-label={caption} className="film-still__svg">
        <defs>
          <pattern id="film-grain-dots" width="5" height="5" patternUnits="userSpaceOnUse">
            <circle cx="2.5" cy="2.5" r="1.5" className="film-still__grain" />
          </pattern>
        </defs>
        <polygon points={`0,230 ${points.join(' ')} 600,230`} fill="url(#film-grain-dots)" />
        <text x="300" y="60" textAnchor="middle" className="film-still__figure">
          {billions(facts.total)}
        </text>
      </svg>
    </Figure>
  )
}

function SplitTable({ facts }: { facts: FilmFacts }) {
  return (
    <table className="film-table">
      <caption className="sr-only">
        Benefit spending by group, {facts.period}, {facts.priceBase} prices
      </caption>
      <thead>
        <tr>
          <th scope="col">Group</th>
          <th scope="col">Spending</th>
          <th scope="col">Share</th>
        </tr>
      </thead>
      <tbody>
        {facts.groups.map((group) => (
          <tr key={group.id}>
            <th scope="row">{group.label}</th>
            <td>{billions(group.value)}</td>
            <td>{percent(group.share)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SplitStill({ facts, caption }: { facts: FilmFacts; caption: string }) {
  const starts = facts.groups.map((_, i) =>
    facts.groups.slice(0, i).reduce((sum, group) => sum + group.share * 600, 0),
  )
  return (
    <Figure caption={caption}>
      <svg viewBox="0 0 600 92" aria-label={caption} className="film-still__svg">
        {facts.groups.map((group, i) => {
          const width = group.share * 600
          const at = starts[i] ?? 0
          return (
            <g key={group.id}>
              <rect
                x={round1(at)}
                y="0"
                width={round1(Math.max(width - 2, 0))}
                height="44"
                className={`film-group film-group--${i}`}
              />
              <text x={round1(at + 4)} y="64" className="film-still__label">
                {group.label}
              </text>
              <text x={round1(at + 4)} y="84" className="film-still__value">
                {percent(group.share)}
              </text>
            </g>
          )
        })}
      </svg>
      <SplitTable facts={facts} />
    </Figure>
  )
}

/** Cells of £1bn, ten to a column, filled bottom up in wall order. */
function WallStill({ facts, caption }: { facts: FilmFacts; caption: string }) {
  const cells = Math.round(facts.total / 1e9)
  const counts = apportion(
    facts.families.map((family) => family.value),
    cells,
  )
  const size = 18
  const rows = 10
  const owners = facts.families.flatMap((family, i) =>
    Array.from({ length: counts[i] ?? 0 }, (_, j) => ({
      family: family.family,
      id: `${family.family}-${j}`,
    })),
  )
  const columns = Math.ceil(owners.length / rows)
  return (
    <Figure caption={caption}>
      <svg
        viewBox={`0 0 ${columns * size} ${rows * size}`}

        aria-label={`${caption} Each square is £1 billion.`}
        className="film-still__svg"
      >
        {owners.map((cell, k) => (
          <rect
            key={cell.id}
            x={Math.floor(k / rows) * size + 1}
            y={(rows - 1 - (k % rows)) * size + 1}
            width={size - 2}
            height={size - 2}
            style={{ fill: familyFill(cell.family) }}
          />
        ))}
      </svg>
      <p className="film-still__note">Each square is £1 billion.</p>
      <table className="film-table">
        <caption className="sr-only">
          Benefit spending by family, {facts.period}, {facts.priceBase} prices
        </caption>
        <thead>
          <tr>
            <th scope="col">Benefit</th>
            <th scope="col">Spending</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {facts.families.map((family) => (
            <tr key={family.family}>
              <th scope="row">
                <span
                  className="film-swatch"
                  style={{ background: familyFill(family.family) }}
                  aria-hidden="true"
                />
                {family.label}
              </th>
              <td>{`£${(family.value / 1e9).toFixed(1)}bn`}</td>
              <td>{percent(family.value / facts.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Figure>
  )
}

function Legend({ domain, label }: { domain: readonly [number, number]; label: string }) {
  const edges = binEdges(domain, 'sequential')
  return (
    <div className="film-legend">
      <span className="film-legend__label">{label}</span>
      <ol className="film-legend__bins">
        {SEQUENTIAL_TOKENS.map((token, i) => (
          <li key={token}>
            <span className="film-swatch" style={{ background: `var(${token})` }} />
            {i === 0
              ? `under ${pounds(edges[0] ?? 0)}`
              : i === SEQUENTIAL_TOKENS.length - 1
                ? `${pounds(edges.at(-1) ?? 0)} and over`
                : `${pounds(edges[i - 1] ?? 0)} to ${pounds(edges[i] ?? 0)}`}
          </li>
        ))}
      </ol>
    </div>
  )
}

function realPerResident(data: FilmData): Float32Array {
  return Float32Array.from(data.perResident, (v) => v * data.realFactor)
}

function AreaList({
  data,
  values,
  label,
}: {
  data: FilmData
  values: Float32Array
  label: string
}) {
  const top = topIndices(values, 5)
  const bottom = topIndices(
    Float32Array.from(values, (v) => -v),
    5,
  )
  return (
    <table className="film-table">
      <caption className="sr-only">{label}: highest and lowest five constituencies</caption>
      <thead>
        <tr>
          <th scope="col">Constituency</th>
          <th scope="col">{label}</th>
        </tr>
      </thead>
      <tbody>
        {[...top, ...bottom].map((i) => (
          <tr key={i}>
            <th scope="row">
              <a
                href={`/area/constituency/${data.areas[i]?.code ?? ''}-${data.areas[i]?.slug ?? ''}`}
              >
                {data.areas[i]?.name}
              </a>
            </th>
            <td>{pounds(values[i] ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The constituency chapter's rest frame: every constituency on the real map, from the release's sprite. */
function MapStill({ data, caption }: { data: FilmData; caption: string }) {
  const values = realPerResident(data)
  const domain = colourDomain(values, 'sequential')
  const bins = binAll(values, domain, 'sequential')
  const size = { width: 400, height: 520 }
  const { camera } = mapFrame(size, data.mapBounds, undefined, 8)
  const [k, x, y] = spriteTransform(camera, size, data.mapBounds)
  return (
    <Figure caption={caption}>
      <svg
        viewBox={`0 0 ${size.width} ${size.height}`}
        aria-label={caption}
        className="film-still__svg film-still__svg--map"
      >
        <g
          transform={`matrix(${k} 0 0 ${k} ${round1(x)} ${round1(y)})`}
          stroke="var(--paper)"
          strokeWidth={0.4 / k}
        >
          {data.areas.map((area, i) => (
            <use
              key={area.code}
              href={`${data.mapSprite}#a${i}`}
              style={{ fill: `var(${tokenOf(bins[i] ?? 0, 'sequential')})` }}
            >
              <title>{`${area.name}: ${pounds(values[i] ?? 0)} per resident`}</title>
            </use>
          ))}
        </g>
      </svg>
      <Legend domain={domain} label={`Benefit spending per resident, ${data.priceBase} prices`} />
      <AreaList data={data} values={values} label="Per resident" />
    </Figure>
  )
}

function Silhouette({ values, label }: { values: Float32Array; label: string }) {
  const order = topIndices(values, values.length)
  const max = values[order[0] ?? 0] ?? 1
  const width = 632
  const height = 120
  const step = width / Math.max(order.length, 1)
  const top = order
    .map((i, k) => `${round1(k * step)},${round1(height - ((values[i] ?? 0) / max) * height)}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} aria-label={label} className="film-still__svg">
      <polygon points={`0,${height} ${top} ${width},${height}`} className="film-skyline" />
    </svg>
  )
}

function SkylineStill({ data, caption }: { data: FilmData; caption: string }) {
  const pensioner = Float32Array.from(data.pensionerPerAged66Plus, (v) => v * data.realFactor)
  const working = Float32Array.from(data.workingAgePerAged16To64, (v) => v * data.realFactor)
  const named = (values: Float32Array) =>
    topIndices(values, 3)
      .map((i) => `${data.areas[i]?.name ?? ''} (${pounds(values[i] ?? 0)})`)
      .join(', ')
  return (
    <Figure caption={caption}>
      <h3 className="film-still__title">Pensioner benefits for each person aged 66 and over</h3>
      <Silhouette values={pensioner} label="Constituencies from highest to lowest" />
      <p className="film-still__note">Highest: {named(pensioner)}.</p>
      <h3 className="film-still__title">Working-age benefits for each person aged 16 to 64</h3>
      <Silhouette values={working} label="Constituencies from highest to lowest" />
      <p className="film-still__note">Highest: {named(working)}.</p>
    </Figure>
  )
}

function SwarmStill({
  data,
  facts,
  caption,
}: {
  data: FilmData
  facts: FilmFacts
  caption: string
}) {
  const values = realPerResident(data)
  const bins = binAll(values, colourDomain(values, 'sequential'), 'sequential')
  const radius = 0.0062
  const swarm = beeswarm(data.shareAged66Plus, radius, [0, 0.36])
  const width = 600
  const height = 220
  const axis = 120
  return (
    <Figure caption={caption}>
      <svg viewBox={`0 0 ${width} ${height}`} aria-label={caption} className="film-still__svg">
        {data.areas.map((area, i) => {
          const x = swarm.xy[i * 2] ?? Number.NaN
          const y = swarm.xy[i * 2 + 1] ?? Number.NaN
          if (!Number.isFinite(x)) return null
          return (
            <circle
              key={area.code}
              cx={round1(x * width)}
              cy={round1(axis - y * width)}
              r={round1(radius * width * MARK_FILL)}
              style={{ fill: `var(${tokenOf(bins[i] ?? 0, 'sequential')})` }}
            />
          )
        })}
        {[0, 0.1, 0.2, 0.3].map((tick) => (
          <text
            key={tick}
            x={round1((tick / 0.36) * width)}
            y={height - 6}
            className="film-still__label"
            textAnchor={tick === 0 ? 'start' : 'middle'}
          >
            {percent(tick, 0)}
          </text>
        ))}
      </svg>
      <p className="film-still__note">
        Left to right: share of residents aged 66 and over. Colour: benefit spending per resident.
        The link with age scores {facts.correlationAged66Plus.toFixed(2)}. The link with how far
        north an area is scores {facts.correlationLatitude.toFixed(2)}. A score of 1 would be a
        perfect match.
      </p>
    </Figure>
  )
}

/** Every chapter's still as markup, keyed by chapter. */
export function renderStills(
  script: Script,
  data: FilmData,
  facts: FilmFacts,
): Readonly<Record<ChapterId, ReactNode>> {
  const caption = (id: ChapterId) => script.chapters.find((c) => c.id === id)?.still ?? ''
  return {
    'the-pour': <PourStill facts={facts} caption={caption('the-pour')} />,
    'your-split': <SplitStill facts={facts} caption={caption('your-split')} />,
    'the-wall': <WallStill facts={facts} caption={caption('the-wall')} />,
    'the-rain': <MapStill data={data} caption={caption('the-rain')} />,
    'two-skylines': <SkylineStill data={data} caption={caption('two-skylines')} />,
    'north-south-or-age': (
      <SwarmStill data={data} facts={facts} caption={caption('north-south-or-age')} />
    ),
    'the-landing': null,
  }
}
