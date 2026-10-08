/**
 * Server functions that render data pages. Each reads the pinned release
 * through the Worker's `ASSETS` binding, at prerender and on demand, and
 * returns markup: the renderers and the data code never reach the browser.
 */
import { createServerFn } from '@tanstack/react-start'

/** A string field of a server function input; anything else reads as empty and finds no page. */
function text(input: unknown, key: string): string {
  const value: unknown =
    typeof input === 'object' && input !== null ? Reflect.get(input, key) : undefined
  return typeof value === 'string' ? value : ''
}

const siteData = async () => (await import('#/data/site-data.server.ts')).siteData

export const getAreaPage = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({ level: text(input, 'level'), area: text(input, 'area') }))
  .handler(async ({ data }) => {
    const { renderAreaPage } = await import('#/pages/area/render.tsx')
    return renderAreaPage(await siteData(), data)
  })

export const getComparePage = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    level: text(input, 'level'),
    area: text(input, 'area'),
    other: text(input, 'other'),
  }))
  .handler(async ({ data }) => {
    const { renderComparePage } = await import('#/pages/compare/render.tsx')
    return renderComparePage(await siteData(), data)
  })

export const getEmbedPage = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({ level: text(input, 'level'), code: text(input, 'code') }))
  .handler(async ({ data }) => {
    const { renderEmbedPage } = await import('#/pages/embed/render.tsx')
    return renderEmbedPage(await siteData(), data)
  })

export const getRankPage = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({ metric: text(input, 'metric'), denom: text(input, 'denom') }))
  .handler(async ({ data }) => {
    const { renderRankPage } = await import('#/pages/rank/render.tsx')
    return renderRankPage(await siteData(), data)
  })

export const getRankIndex = createServerFn({ method: 'GET' }).handler(async () => {
  const { renderRankIndex } = await import('#/pages/rank/render.tsx')
  return renderRankIndex(await siteData())
})

export const getAreaIndex = createServerFn({ method: 'GET' }).handler(async () => {
  const { renderAreaIndex } = await import('#/pages/area/render.tsx')
  return renderAreaIndex(await siteData())
})

export const getMethodsPage = createServerFn({ method: 'GET' }).handler(async () => {
  const { renderMethodsPage } = await import('#/pages/reference.tsx')
  return renderMethodsPage(await siteData())
})

export const getDataPage = createServerFn({ method: 'GET' }).handler(async () => {
  const { renderDataPage } = await import('#/pages/reference.tsx')
  return renderDataPage(await siteData())
})
