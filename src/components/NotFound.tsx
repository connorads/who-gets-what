import { Link } from '@tanstack/react-router'
import { PageHeader } from './PageHeader'

export default function NotFound() {
  return (
    <>
      <PageHeader kicker="Error 404" title="Page not found">
        <p>
          Check the address is correct. Area pages use the 2024 constituency boundaries and the
          April 2023 council boundaries, so an older area code will not work.
        </p>
      </PageHeader>
      <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
        <li>
          <Link to="/" className="underline">
            Home
          </Link>
        </li>
        <li>
          <Link to="/explore" className="underline">
            Explore the map
          </Link>
        </li>
        <li>
          <Link to="/area" className="underline">
            Find an area
          </Link>
        </li>
      </ul>
    </>
  )
}
