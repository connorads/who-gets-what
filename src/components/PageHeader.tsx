import type { ReactNode } from 'react'

export function PageHeader({
  kicker,
  title,
  children,
}: {
  kicker: string
  title: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="pt-12 pb-4 md:pt-20 md:pb-8">
      <p className="kicker">{kicker}</p>
      <h1 className="mt-4 max-w-[18ch] font-display text-headline text-balance">{title}</h1>
      {children === undefined ? null : (
        <div className="mt-6 max-w-prose text-lg text-pretty text-ink-muted">{children}</div>
      )}
    </header>
  )
}

/** A numbered ledger entry: a hairline above, the figure column on the left. */
export function LedgerEntry({
  index,
  title,
  children,
}: {
  index: string
  title: string
  children: ReactNode
}) {
  return (
    <section className="rule-t grid gap-x-8 gap-y-2 py-6 md:grid-cols-[4rem_14rem_1fr]">
      <p className="font-mono text-sm text-brass-ink tabular" aria-hidden="true">
        {index}
      </p>
      <h2 className="font-display text-title">{title}</h2>
      <div className="max-w-prose space-y-3 text-ink-muted">{children}</div>
    </section>
  )
}
