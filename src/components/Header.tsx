import { Link } from '@tanstack/react-router'
import MotionToggle from './MotionToggle'
import ThemeToggle from './ThemeToggle'
import { Wordmark } from './Wordmark'
import { PRIMARY_NAV } from './site-nav'

export default function Header() {
  return (
    <header className="site-header">
      <div className="ledger-wrap flex flex-wrap items-center gap-x-4 gap-y-1 py-2 md:flex-nowrap">
        <Link to="/" className="rounded-full no-underline" aria-label="Who Gets What, home">
          <Wordmark />
        </Link>

        <nav
          aria-label="Primary"
          className="order-3 -mx-2 w-[calc(100%+1rem)] md:order-none md:mx-0 md:ml-auto md:w-auto"
        >
          <ul className="flex gap-x-1 overflow-x-auto px-1 md:px-0">
            {PRIMARY_NAV.map((item) => (
              <li key={item.to} className="shrink-0">
                <Link to={item.to} className="nav-link" activeProps={{ 'aria-current': 'page' }}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center md:ml-0">
          <MotionToggle />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
