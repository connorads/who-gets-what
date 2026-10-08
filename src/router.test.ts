import { describe, expect, it } from 'vitest'
import { getRouter } from './router'

describe('getRouter', () => {
  it('registers the file routes', () => {
    const paths = Object.keys(getRouter().routesByPath).toSorted()

    expect(paths).toEqual([
      '/',
      '/about',
      '/area',
      '/area/$level/$area',
      '/area/$level/$area/vs/$other',
      '/data',
      '/embed/area/$level/$code',
      '/explore',
      '/film',
      '/methods',
      '/rank',
      '/rank/$metric/$denom',
      '/styleguide',
    ])
  })

  it('matches /about to the about route', () => {
    const matches = getRouter().matchRoutes('/about')

    expect(matches.map((m) => m.routeId)).toEqual(['__root__', '/about'])
  })
})
