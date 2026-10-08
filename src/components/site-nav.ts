/** The header's links: the three things most readers come for. */
export const PRIMARY_NAV = [
  { to: '/explore', label: 'Explore' },
  { to: '/area', label: 'Find an area' },
  { to: '/about', label: 'About' },
] as const

/** Every section of the site, listed once in the footer. */
export const SITE_NAV = [
  { to: '/explore', label: 'Explore' },
  { to: '/', label: 'Home' },
  { to: '/area', label: 'Areas' },
  { to: '/rank', label: 'Rankings' },
  { to: '/methods', label: 'Methods' },
  { to: '/data', label: 'Data' },
  { to: '/about', label: 'About' },
] as const
