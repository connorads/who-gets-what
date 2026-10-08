/**
 * `pnpm run build` step: dist/client/robots.txt, pointing crawlers at the
 * sitemap the prerender writes. Embeds carry noindex; nothing is disallowed.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { PLACEHOLDER_ORIGIN } from '../src/lib/site.ts'

export function robotsTxt(origin: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin.replace(/\/$/, '')}/sitemap.xml\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  // The same origin the build used: `.env.production`, unless the environment overrides it.
  const origin = loadEnv('production', root, 'VITE_')['VITE_SITE_ORIGIN'] ?? PLACEHOLDER_ORIGIN
  writeFileSync(join(root, 'dist', 'client', 'robots.txt'), robotsTxt(origin))
}
