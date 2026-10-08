# Render data pages to static markup on the server and hydrate only the shell

Area dossiers, comparisons, rankings, embeds and the methods, data and area
index pages are rendered on the server to an HTML string
(`renderToStaticMarkup`) inside a TanStack Start server function, which reads
the release through the `ASSETS` binding. The route loader wraps the string in
`ServerMarkup`; a serialization adapter dehydrates it as empty, and
`StaticMarkup` renders it with `dangerouslySetInnerHTML`, so on first load
React keeps the server's DOM instead of re-rendering it. Behaviour comes from
`data-*` attributes wired by `src/lib/enhance.ts`, and the price basis switch
is CSS (`:has()` on three radios), so the page carries every basis.

## Context

- The area page budget is 120 kB gzip of JS, and the framework (React, the
  router and the Start client runtime) is 113 kB of it
  ([architecture](../architecture.md#performance)).
- A dossier has about 20 charts, 15 tables and 70 figures in three price
  bases. As hydrated React components with their data, the page code alone
  would exceed the 7 kB left.
- 982 dossiers, 66 rankings and 982 embeds are prerendered, so the markup is
  computed once per release.

## Consequences

- The area page ships about 6 kB of its own JS (118.9 kB with the shell).
  Charts use visx on the server only; no chart code reaches the browser.
- The markup reaches the browser once. Without the adapter the dehydrated
  loader data repeated it, which doubled the HTML (643 kB to 283 kB raw for
  Aldershot before other trims).
- Links inside the markup are plain anchors: moving between data pages is a
  document load of a static file, smoothed by cross-document view transitions.
  A client-side navigation to a data route calls the server function, which
  returns the markup as a plain string.
- Interactive controls must work from attributes and delegated listeners.
  Anything richer belongs in a client island, such as the explorer.
- React does not check the markup on hydration, so a test renders each page
  kind from the pulled release and Playwright checks the built pages.

## Alternatives considered

- **Hydrate the dossier as React components.** Measured over budget: the page
  components and their props would add more than the 7 kB left.
- **React Server Components (`@tanstack/react-start/rsc`).** Experimental in
  Start 1.168, and they need `@vitejs/plugin-rsc` beside the Cloudflare Vite
  plugin. The flight payload would also travel beside the HTML.
- **Raise the JS budget.** The budget follows the LCP target on a mid-range
  phone over slow 4G; static markup meets it without raising it.
