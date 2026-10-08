import { createFileRoute } from '@tanstack/react-router'
import { LedgerEntry, PageHeader } from '#/components/PageHeader'
import { textPageHead } from '#/lib/seo.ts'
import { SITE_AUTHOR } from '#/lib/site.ts'

export const Route = createFileRoute('/about')({
  head: () =>
    textPageHead(
      'About',
      '/about',
      `Who Gets What is an independent project by ${SITE_AUTHOR.name} that publishes official figures on UK benefits by area. It has no link to any party, campaign or government department.`,
    ),
  component: About,
})

function About() {
  return (
    <>
      <PageHeader kicker="About" title="Who we are and how we work">
        <p>
          We publish official figures on benefits for every constituency and council in Great
          Britain. Each figure links to where it came from and how we worked it out.
        </p>
      </PageHeader>
      <div className="mt-10">
        <LedgerEntry index="01" title="Who runs this site?">
          <p>
            <span translate="no">{SITE_AUTHOR.name}</span> makes Who Gets What as an independent
            project. It is not a registered organisation.
          </p>
          <p>
            We have no link to any political party, campaign or government department. We do not
            take a side on benefit policy.
          </p>
        </LedgerEntry>
        <LedgerEntry index="02" title="How do we stay neutral?">
          <p>We write down the rules that keep the figures fair, and automated tests check them.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              We divide each benefit by the people it is for, such as people aged 66 and over for
              pensioner benefits.
            </li>
            <li>We adjust for inflation by default, and you can switch to cash.</li>
            <li>We label income tax as income tax only.</li>
            <li>We compare how deprived an area is only with areas in the same nation.</li>
            <li>We mark every figure that is an estimate.</li>
            <li>Our sentences compare areas. They do not judge them.</li>
            <li>We name political parties in words and never give them a colour.</li>
          </ul>
        </LedgerEntry>
        <LedgerEntry index="03" title="What does the site do?">
          <p>
            We collect published statistics. We put them on the same boundaries and the same prices,
            so you can compare areas fairly. We show each figure with its source and its limits.
          </p>
          <p>We do not make forecasts or recommendations.</p>
        </LedgerEntry>
        <LedgerEntry index="04" title="Can I check the figures?">
          <p>
            Yes. Every figure links to its source. Our page on{' '}
            <a href="/methods">how we worked out the figures</a> sets out each rule and formula. You
            can <a href="/data">download all the data</a>, with each file&apos;s size and checksum.
          </p>
        </LedgerEntry>
        <LedgerEntry index="05" title="What if something is wrong?">
          <p>We publish corrections in a new data release. The release notes list what changed.</p>
          <p>
            To report a mistake, message{' '}
            <a href={SITE_AUTHOR.url} translate="no">
              {SITE_AUTHOR.handle}
            </a>{' '}
            on&nbsp;X.
          </p>
        </LedgerEntry>
      </div>
    </>
  )
}
