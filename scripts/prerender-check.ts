/**
 * `pnpm run prerender:check`: after `pnpm run build`, check that every page
 * the build lists was written, that its share card exists, that the static
 * asset count stays inside the Workers limit, that no prerendered page
 * uses a banned or style-list word (ADR 0004).
 * Exits 1 on any problem.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBannedPhrases, findStylePhrases } from '../src/domain/neutrality.ts'
import { prerenderPages, type PrerenderPage } from './pages.ts'

/** Workers static assets allow 20,000 files per version. */
export const ASSET_LIMIT = 20_000

/** Where the prerenderer writes a page (`autoSubfolderIndex: false`). */
export function htmlFile(path: string): string {
  return path === '/' ? 'index.html' : `${path.replace(/^\//, '')}.html`
}

/** Visible text plus the attributes a reader or a search result shows. */
export function readableText(html: string): string {
  const withoutCode = html.replaceAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, ' ')
  const attributes = Array.from(
    withoutCode.matchAll(/\s(?:aria-label|alt|title|content|placeholder)="([^"]*)"/g),
    (match) => match[1],
  )
  return [withoutCode.replaceAll(/<[^>]+>/g, ' '), ...attributes].join(' ')
}

/**
 * A page without people's names. Names are data, not our words, and a page
 * marks each one `translate="no"`, so the style list skips "Simon Heap".
 */
export function withoutNames(html: string): string {
  return html.replaceAll(/<([a-z]+)\b[^>]*\btranslate="no"[^>]*>[^<]*<\/\1>/g, ' ')
}

export function pageProblems(
  pages: readonly PrerenderPage[],
  written: ReadonlySet<string>,
): readonly string[] {
  return pages
    .filter((page) => page.prerender?.enabled !== false && !written.has(htmlFile(page.path)))
    .map((page) => `${page.path}: not prerendered (no ${htmlFile(page.path)})`)
}

/** The share card path a page names in `og:image`, relative to the site root. */
export function shareCardPath(html: string): string | undefined {
  const url = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1]
  return url === undefined ? undefined : url.replace(/^[a-z]+:\/\/[^/]+\//, '')
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/'))
}

function main(): void {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const client = join(root, 'dist', 'client')
  if (!existsSync(client)) {
    console.error('dist/client is missing; run `pnpm run build` first')
    process.exitCode = 1
    return
  }
  const files = listFiles(client)
  const html = files.filter((file) => file.endsWith('.html'))
  const pages = prerenderPages(root)
  const problems = [
    ...pageProblems(pages, new Set(html)),
    ...(files.length < ASSET_LIMIT
      ? []
      : [`dist/client: ${files.length} files, over the ${ASSET_LIMIT} asset limit`]),
    ...html.flatMap((file) => {
      const page = readFileSync(join(client, file), 'utf8')
      const found = findBannedPhrases(readableText(page))
      const style = findStylePhrases(readableText(withoutNames(page)))
      const card = shareCardPath(page)
      return [
        ...(found.length === 0 ? [] : [`${file}: banned words ${found.join(', ')}`]),
        ...(style.length === 0 ? [] : [`${file}: style-list words ${style.join(', ')}`]),
        ...(card === undefined || existsSync(join(client, card))
          ? []
          : [`${file}: share card ${card} is missing`]),
      ]
    }),
  ]
  const count = (prefix: string) => html.filter((file) => file.startsWith(prefix)).length
  console.warn(
    `${html.length} HTML pages (${count('area/')} area, ${count('rank/')} rank, ${count('embed/')} embed); ${files.length} static assets`,
  )
  for (const problem of problems) console.error(problem)
  process.exitCode = problems.length === 0 ? 0 : 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
