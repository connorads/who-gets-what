import { HeadContent, Scripts, createRootRoute, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import type { ReactNode } from 'react'
import Footer from '#/components/Footer'
import Header from '#/components/Header'
import NotFound from '#/components/NotFound'
import { PREFERENCES_INIT_SCRIPT } from '#/lib/preferences.ts'
import { SITE_AUTHOR, SITE_DESCRIPTION, SITE_NAME } from '#/lib/site.ts'

import appCss from '../styles.css?url'
import atkinsonLatin from '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2?url'
import bricolageLatin from '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: `${SITE_NAME}: UK benefits by area` },
      { name: 'description', content: SITE_DESCRIPTION },
      { name: 'theme-color', content: '#fbf5ec' },
      { property: 'og:site_name', content: SITE_NAME },
      { name: 'apple-mobile-web-app-title', content: SITE_NAME },
      { property: 'og:locale', content: 'en_GB' },
      { name: 'twitter:creator', content: SITE_AUTHOR.handle },
    ],
    links: [
      // Body text and the display headline (the LCP element) start downloading before the CSS parses.
      {
        rel: 'preload',
        href: atkinsonLatin,
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'preload',
        href: bricolageLatin,
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
      },
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
      { rel: 'icon', href: '/brand/monogram.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
})

function RootDocument({ children }: { children: ReactNode }) {
  // Embeds sit in other sites' frames: no site chrome, just the chart and its source.
  const embed = useRouterState({ select: (state) => state.location.pathname.startsWith('/embed/') })
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFERENCES_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="flex min-h-dvh flex-col font-sans">
        {embed ? null : (
          <a href="#main" className="skip-link">
            Skip to content
          </a>
        )}
        {embed ? null : <Header />}
        <main id="main" tabIndex={-1} className="ledger-wrap flex-1 outline-none">
          {children}
        </main>
        {embed ? null : <Footer />}
        {/* Dev only: in a build the condition is false, so the devtools leave every page's main chunk. */}
        {import.meta.env.DEV ? (
          <TanStackDevtools
            config={{ position: 'bottom-right' }}
            plugins={[{ name: 'Tanstack Router', render: <TanStackRouterDevtoolsPanel /> }]}
          />
        ) : null}
        <Scripts />
      </body>
    </html>
  )
}
