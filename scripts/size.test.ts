import { describe, expect, it } from 'vitest'
import { closure, closureBeyond, dataProblems, mainChunk, staticImports } from './size.ts'

const CHUNKS = new Map([
  ['index-a.js', 'var e=1;import("./area-b.js");export{e as n}'],
  ['area-b.js', 'import{n as e}from"./index-a.js";import{t}from"./button-c.js";'],
  ['button-c.js', 'import{n as e}from"./index-a.js";export{e as t}'],
  ['about-d.js', 'import{n as e}from"./index-a.js";'],
])

describe('client chunks', () => {
  it('follow static imports and skip dynamic ones', () => {
    expect(staticImports(CHUNKS.get('index-a.js') ?? '')).toEqual([])
    expect([...closure('area-b.js', CHUNKS)].toSorted()).toEqual([
      'area-b.js',
      'button-c.js',
      'index-a.js',
    ])
  })

  it('count only the chunks a lazy entry adds to what is already loaded', () => {
    expect([...closureBeyond('area-b.js', 'about-d.js', CHUNKS)].toSorted()).toEqual([
      'area-b.js',
      'button-c.js',
    ])
  })

  it('take the router entry, which lazy-loads the routes, as the main chunk', () => {
    const split = new Map([
      ...CHUNKS,
      ['index-a.js', 'import{r}from"./jsx-e.js";import("./area-b.js");import("./about-d.js")'],
      ['jsx-e.js', 'export{}'],
      ['area-b.js', 'import{r}from"./jsx-e.js";import{n}from"./index-a.js"'],
      ['about-d.js', 'import{r}from"./jsx-e.js";import{n}from"./index-a.js"'],
      ['button-c.js', 'import{r}from"./jsx-e.js"'],
    ])

    expect(mainChunk(CHUNKS)).toBe('index-a.js')
    expect(mainChunk(split)).toBe('index-a.js')
  })
})

describe('data budgets', () => {
  it('pass files inside their budgets', () => {
    expect(
      dataProblems([
        { path: 'area/local-authority/E06000001.json', bytes: 19_999 },
        { path: 'geo/constituency.geojson', bytes: 999_000 },
        { path: 'downloads/fact_spend_area-local-authority-2024-25.csv', bytes: 600_000 },
        { path: 'downloads/all-tables.zip', bytes: 12_000_000 },
      ]),
    ).toEqual([])
  })

  it('hold the archive of every table under the 25 MiB asset limit', () => {
    expect(dataProblems([{ path: 'downloads/all-tables.zip', bytes: 26_214_401 }])).toEqual([
      'downloads/all-tables.zip: 26214401 bytes, over the archive budget of 26214400',
    ])
  })

  it('reject a file over its budget and a file no budget covers', () => {
    expect(
      dataProblems([
        { path: 'area/local-authority/E06000001.json', bytes: 20_001 },
        { path: 'misc/notes.txt', bytes: 10 },
      ]),
    ).toEqual([
      'area/local-authority/E06000001.json: 20001 bytes, over the area dossier budget of 20000',
      'misc/notes.txt: no budget covers this path',
    ])
  })
})
