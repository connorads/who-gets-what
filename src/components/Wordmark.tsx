/**
 * The monogram is one coin cut into unequal shares: who gets what. The
 * shares take the benefit family groups' colours; their sizes are a sign,
 * not data. public/brand/monogram.svg draws the same paths.
 */
export function Monogram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path d="M17 16V2.5a13.5 13.5 0 0 1 0 27Z" fill="var(--brass)" />
      <path d="M15 17v13.5A13.5 13.5 0 0 1 1.5 17Z" fill="var(--brand-clay)" />
      <path d="M15 15H1.5A13.5 13.5 0 0 1 15 1.5Z" fill="var(--brand-verdigris)" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <Monogram className="size-7 shrink-0" />
      <span className="font-display text-[1.2rem] leading-none font-bold tracking-[-0.02em] text-ink">
        Who Gets What
      </span>
    </span>
  )
}
