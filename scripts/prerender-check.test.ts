import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { areaPages, embedPages, prerenderPages, rankPages, releaseFolder } from './pages.ts'
import {
  htmlFile,
  pageProblems,
  readableText,
  shareCardPath,
  withoutNames,
} from './prerender-check.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const pulled = (() => {
  try {
    return existsSync(releaseFolder(root))
  } catch {
    return false
  }
})()

describe('prerender check', () => {
  it('leaves people’s names out of the text the style list reads', () => {
    const html = '<p>Votes for <td translate="no">Simon Heap</td>, Green Party</p>'

    expect(readableText(withoutNames(html))).not.toContain('Heap')
    expect(readableText(withoutNames(html))).toContain('Green Party')
  })

  it('maps a page path to the file the prerenderer writes', () => {
    expect(htmlFile('/')).toBe('index.html')
    expect(htmlFile('/area/constituency/E14001063-aldershot')).toBe(
      'area/constituency/E14001063-aldershot.html',
    )
  })

  it('reports listed pages with no file', () => {
    expect(
      pageProblems([{ path: '/rank/a/total' }, { path: '/about' }], new Set(['about.html'])),
    ).toEqual(['/rank/a/total: not prerendered (no rank/a/total.html)'])
  })

  it('expects no file for a page the Worker renders on demand', () => {
    expect(pageProblems([{ path: '/explore', prerender: { enabled: false } }], new Set())).toEqual(
      [],
    )
  })

  it('finds the share card a page names', () => {
    expect(
      shareCardPath('<meta property="og:image" content="https://example.org/og/area/x.png"/>'),
    ).toBe('og/area/x.png')
  })

  it('reads text and attributes but not scripts', () => {
    const text = readableText(
      '<p title="a burden">x</p><script>var crisis</script><meta content="y">',
    )

    expect(text).toContain('burden')
    expect(text).not.toContain('crisis')
  })
})

describe.runIf(pulled)('prerender list over the pulled release', () => {
  it('lists one page and one embed per area, and one page per metric and denominator', () => {
    const folder = releaseFolder(root)

    expect(areaPages(folder)).toHaveLength(982)
    expect(rankPages(folder)).toHaveLength(66)
    expect(embedPages(folder)).toHaveLength(982)
    expect(new Set(areaPages(folder).map((page) => page.path)).size).toBe(982)
  })

  it('dates every sitemap entry by the data release, with no priority', () => {
    const listed = prerenderPages(root).filter((page) => page.sitemap?.exclude !== true)
    const released = basename(releaseFolder(root)).slice(0, 'yyyy-mm-dd'.length)

    expect(new Set(listed.map((page) => page.sitemap?.lastmod))).toEqual(new Set([released]))
    expect(
      listed.filter((page) => page.sitemap !== undefined && 'priority' in page.sitemap),
    ).toEqual([])
  })
})
