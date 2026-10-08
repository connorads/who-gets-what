import { Link } from '@tanstack/react-router'
import { SITE_AUTHOR, SITE_SOURCE } from '#/lib/site.ts'
import { Monogram } from './Wordmark'
import { SITE_NAV } from './site-nav'

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="ledger-wrap grid gap-8 py-12 md:grid-cols-[1.5fr_1fr] md:items-start">
        <section aria-labelledby="footer-disclosure" className="max-w-prose">
          <div className="flex items-center gap-2.5">
            <Monogram className="size-6 text-ink" />
            <h2 id="footer-disclosure" className="text-lg">
              Who publishes this site
            </h2>
          </div>
          <p className="mt-3 text-ink-muted">
            Who Gets What is an independent project that publishes public data on UK benefits. It
            has no link to any political party, campaign or government department. It does not take
            a side on benefit policy. Every figure links to its source and to{' '}
            <Link to="/methods" className="underline">
              how we worked it out
            </Link>
            . The site covers Great Britain. Northern Ireland is not included.
          </p>
          <p className="mt-3 text-ink-muted">
            Made by <span translate="no">{SITE_AUTHOR.name}</span>. Follow{' '}
            <a href={SITE_AUTHOR.url} className="underline" translate="no">
              {SITE_AUTHOR.handle}
            </a>{' '}
            on&nbsp;X. The{' '}
            <a href={SITE_SOURCE} className="underline">
              source code
            </a>{' '}
            is open.
          </p>
        </section>

        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 md:justify-end">
            {SITE_NAV.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className="font-semibold no-underline hover:underline">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <p className="ledger-wrap pb-8 text-sm text-ink-muted">
        Contains public sector information licensed under the Open Government Licence v3.0. Contains
        OS data &copy; Crown copyright and database right.
      </p>
    </footer>
  )
}
