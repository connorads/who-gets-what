# Name the maker

The site names the person who makes it: Connor Adams, `@connorads` on X. The
footer on every page, the `/about` page and the `twitter:creator` tag carry
the credit. `SITE_AUTHOR` in `src/lib/site.ts` holds the name, handle and
link once.

## Context

- ADR 0011 names no organisation behind the site, because none exists. A
  reader who asks "who runs this?" still needs an answer they can check.
- "An independent project" with no name gives a sceptical reader nothing to
  check and nobody to tell about a mistake.
- Share cards on X credit the account in `twitter:creator`.

## Options considered

- **Stay anonymous.** Rejected: an anonymous site about public money is
  harder to trust, and readers have no route to report a mistake.
- **Name the maker.** Chosen: one person, one public account, linked from
  every page.

## Consequences

- The footer and `/about` link to the X account. `/about` names it as the
  place to report a mistake.
- The neutrality rules in ADR 0004 still apply. The credit names a person,
  not a party or campaign.
- The shell test checks the credit and the tag on every shell page.
