import { describe, expect, it } from 'vitest'
import { err } from '#/domain/result.ts'
import { fetchSource, required } from './source.ts'

describe('fetchSource', () => {
  it('resolves paths against the origin and parses JSON and bytes', async () => {
    const seen: string[] = []
    const source = fetchSource((request) => {
      seen.push(request.url)
      return Promise.resolve(
        request.url.endsWith('.json')
          ? Response.json({ ok: true })
          : new Response(new Uint8Array([1, 2, 3])),
      )
    }, 'https://assets.invalid')

    expect(await required(source.json('/data/r/meta/catalogue.json'))).toEqual({ ok: true })
    expect(new Uint8Array(await required(source.bytes('/data/r/layout/rings.bin')))).toEqual(
      new Uint8Array([1, 2, 3]),
    )
    expect(seen).toEqual([
      'https://assets.invalid/data/r/meta/catalogue.json',
      'https://assets.invalid/data/r/layout/rings.bin',
    ])
  })

  it('reports a missing file as a value with its path and status', async () => {
    const source = fetchSource(
      () => Promise.resolve(new Response('nope', { status: 404 })),
      'https://assets.invalid',
    )

    expect(await source.json('/data/r/missing.json')).toEqual(
      err({ kind: 'data-missing', path: '/data/r/missing.json', status: 404 }),
    )
    await expect(required(source.json('/data/r/missing.json'))).rejects.toThrow(
      'Release file missing: /data/r/missing.json (404)',
    )
  })
})
