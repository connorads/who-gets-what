import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { prerenderPages } from './scripts/pages.ts'
import { PLACEHOLDER_ORIGIN } from './src/lib/site.ts'

const root = fileURLToPath(new URL('.', import.meta.url))

const config = defineConfig(({ command, mode }) => {
  // `.env.production` sets the deployed origin; the environment overrides it.
  const origin = loadEnv(mode, root, 'VITE_')['VITE_SITE_ORIGIN'] ?? PLACEHOLDER_ORIGIN
  if (command === 'build' && origin === PLACEHOLDER_ORIGIN) {
    console.warn(
      `VITE_SITE_ORIGIN is not set: canonical links, share cards and the sitemap use ${PLACEHOLDER_ORIGIN}`,
    )
  }
  return {
    resolve: { tsconfigPaths: true },
    plugins: [
      devtools(),
      cloudflare({ viteEnvironment: { name: 'ssr' } }),
      tailwindcss(),
      tanstackStart({
        // Pages are listed, not crawled: crawling would follow every compare link.
        prerender: {
          enabled: true,
          crawlLinks: false,
          autoStaticPathsDiscovery: false,
          autoSubfolderIndex: false,
          failOnError: true,
        },
        pages: command === 'build' ? [...prerenderPages(root)] : [],
        sitemap: { enabled: true, host: origin },
        // Loaders call server functions, whose client stubs would otherwise ride
        // in every page's main chunk; split, each route fetches its own.
        router: {
          codeSplittingOptions: {
            defaultBehavior: [['loader'], ['component'], ['errorComponent'], ['notFoundComponent']],
          },
        },
      }),
      viteReact(),
    ],
  }
})

export default config
