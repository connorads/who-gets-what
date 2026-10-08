import { describe, expect, it } from 'vitest'
import { ReleaseId, type MetricDefinition } from '#/domain/contract.ts'
import { ValueFlag } from '#/domain/measure.ts'
import { fixtureCatalogue } from '#/domain/testing/fixtures.ts'
import {
  csvField,
  csvFileName,
  FIGURE_COLUMNS,
  figuresCsv,
  flagNames,
  toCsv,
  unitText,
  type FigureRow,
} from './csv.ts'

const catalogue = fixtureCatalogue()
const metric = (id: string): MetricDefinition => {
  const found = catalogue.metrics.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`no fixture metric ${id}`)
  return found
}
const release = ReleaseId.parse('2026-10-05.1')

/** A minimal RFC 4180 reader, so tests check what a spreadsheet would read back. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else field += c
  }
  return rows
}

const row = (patch: Partial<FigureRow> = {}): FigureRow => ({
  level: 'constituency',
  code: 'S14000021',
  name: 'East Kilbride and Strathaven',
  metric: metric('spend-pensioner'),
  denominator: 'per-aged-66-plus',
  period: '2024-25',
  value: 6123.45,
  rank: 12,
  rankOf: 631,
  gbValue: 5900.1,
  flags: 0,
  ...patch,
})

describe('csv fields', () => {
  it('leaves plain text and numbers bare', () => {
    expect(csvField('Aldershot')).toBe('Aldershot')
    expect(csvField(-12.5)).toBe('-12.5')
    expect(csvField(0)).toBe('0')
  })

  it('quotes commas, quotes, line breaks and edge spaces, doubling inner quotes', () => {
    expect(csvField('Ynys Môn, Anglesey')).toBe('"Ynys Môn, Anglesey"')
    expect(csvField('the "high" street')).toBe('"the ""high"" street"')
    expect(csvField('one\ntwo')).toBe('"one\ntwo"')
    expect(csvField(' padded')).toBe('" padded"')
  })

  it('writes a missing or non-finite number as an empty field', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(Number.NaN)).toBe('')
    expect(csvField(Number.POSITIVE_INFINITY)).toBe('')
  })

  it('round-trips awkward text through an RFC 4180 reader', () => {
    const awkward = ['a,b', 'say "hi"', 'line\r\nbreak', '', 'plain']
    const text = toCsv(['x', 'y', 'z', 'w', 'v'], [awkward])

    expect(text.endsWith('\r\n')).toBe(true)
    expect(parseCsv(text)).toEqual([['x', 'y', 'z', 'w', 'v'], awkward])
  })
})

describe('flags and units', () => {
  it('names every flag set, in bit order', () => {
    expect(flagNames(0)).toBe('')
    expect(flagNames(ValueFlag.harmonised | ValueFlag.apportioned)).toBe('apportioned;harmonised')
    expect(flagNames(255).split(';')).toHaveLength(8)
  })

  it('names the unit with its denominator', () => {
    expect(unitText(metric('spend-pensioner'), 'total')).toBe('pounds')
    expect(unitText(metric('spend-pensioner'), 'per-aged-66-plus')).toBe(
      'pounds per person aged 66 and over',
    )
    expect(unitText(metric('claimants-pension-credit'), 'per-aged-66-plus')).toBe(
      'people per 1,000 people aged 66 and over',
    )
    expect(unitText({ unit: 'ratio', rateScale: 1 }, 'total')).toBe('ratio')
  })
})

/** The figures CSV read back as one record per row, keyed by column. */
function read(rows: readonly FigureRow[], basis: 'real-gdp' | 'nominal' = 'real-gdp') {
  const [header, ...body] = parseCsv(figuresCsv(rows, { release, basis, catalogue }))
  return body.map((cells) => Object.fromEntries((header ?? []).map((h, i) => [h, cells[i]])))
}

describe('figures CSV', () => {
  it('writes the columns in order, one row per figure', () => {
    const text = figuresCsv([row(), row({ code: 'S14000022' })], {
      release,
      basis: 'real-gdp',
      catalogue,
    })

    expect(parseCsv(text)[0]).toEqual([...FIGURE_COLUMNS])
    expect(parseCsv(text)).toHaveLength(3)
  })

  it('names the price basis for money and leaves it empty for counts', () => {
    const [money, count] = read([
      row(),
      row({ metric: metric('claimants-pension-credit'), period: '2026-03', value: 41.2 }),
    ])

    expect(money?.['price_basis']).toBe('2026-27 prices, GDP deflator')
    expect(money?.['unit']).toBe('pounds per person aged 66 and over')
    expect(count?.['price_basis']).toBe('')
    expect(read([row()], 'nominal')[0]?.['price_basis']).toBe('cash terms, not adjusted for prices')
  })

  it('carries provenance, flags and sources beside each value', () => {
    const [measured, apportioned] = read([
      row(),
      row({ flags: ValueFlag.apportioned | ValueFlag.harmonised }),
    ])

    expect(measured?.['provenance']).toBe('measured')
    expect(measured?.['flags']).toBe('')
    expect(apportioned?.['provenance']).toBe('apportioned')
    expect(apportioned?.['flags']).toBe('apportioned;harmonised')
    expect(measured?.['sources']).toContain(catalogue.sources[0]?.title)
    expect(measured?.['release']).toBe('2026-10-05.1')
  })

  it('keeps an area with no value and no rank, with empty cells', () => {
    const [missing] = read([
      row({ value: null, rank: 0, gbValue: null, flags: ValueFlag.suppressed }),
    ])

    expect(missing?.['area_name']).toBe('East Kilbride and Strathaven')
    expect(missing?.['value']).toBe('')
    expect(missing?.['rank']).toBe('')
    expect(missing?.['gb_value']).toBe('')
    expect(missing?.['flags']).toBe('suppressed')
  })
})

describe('csv file names', () => {
  it('lowercases and replaces unsafe characters', () => {
    expect(csvFileName(['S14000021', 'East Kilbride & Strathaven'])).toBe(
      'who-gets-what-s14000021-east-kilbride-strathaven.csv',
    )
    expect(csvFileName(['constituency', 'spend-total', 'per-resident', '2024-25'])).toBe(
      'who-gets-what-constituency-spend-total-per-resident-2024-25.csv',
    )
  })
})
