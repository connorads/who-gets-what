---
name: verify
description: Verify the Who Gets What app's checks, build and Cloudflare Worker locally. Use after changes to routes, components, data code, tooling, dependencies or Worker configuration.
---

# Verify Who Gets What

1. Run `mise install`, then `pnpm install --frozen-lockfile`.
2. Run `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check` and
   `pnpm run test`. Each must exit 0.
3. Run `hk validate` and `hk check --all`. These add whitespace, typos,
   Markdown, gitleaks over staged changes and the build-script decision
   check. Run `gitleaks git --no-banner .` to scan the whole history.
4. Run `pnpm run build`, then `pnpm run size`, `pnpm run prerender:check`
   and `pnpm exec wrangler deploy --dry-run`. `size` and `prerender:check`
   must exit 0. The dry-run must end with `--dry-run: exiting now.` and list
   the `ASSETS` binding.
5. For data page, explorer or film changes, run `pnpm run test:e2e` against
   the build. For explorer or film motion changes, also measure frame rates
   as `e2e/explore-perf.spec.ts` and `e2e/film-perf.spec.ts` do, in a
   playwright-cli browser on a real GPU; `pnpm run perf:explore` runs in
   Playwright's headless shell, which renders WebGL in software.
6. For route, component or Worker changes, smoke the built Worker:
   `pnpm exec vite preview --host 127.0.0.1 --port 4319 --strictPort`.
   Require 200 from `/` and `/about`, 301 from `/film` to `/` and 404 from
   `/no-such-page`. Request every route the change touches. Stop the server
   afterwards.
7. For interactive changes, also run
   `pnpm run dev --host 127.0.0.1 --strictPort` and check the changed flow in
   a browser at `http://127.0.0.1:3000`, with the console open. Close any
   disposable browser session and stop the server.

For film changes, watch `/` in a playwright-cli browser at 1440 and
390 px wide: press Play and let it run to the guess, lock a guess, scroll
to take over and Resume, scroll it down and back up, open Read mode
(`?mode=read`) and reduced motion, pick a chapter from the bar, tab to the
guess sliders, and land a postcode. `?frame=0.5` pins one frame for a
screenshot. Check that each caption matches the picture under it and that
no card covers the control bar. After `pnpm run audio:build`, transcribe every new
take as [docs/film/audio.md](../../../docs/film/audio.md) describes.

For explorer changes, open `/explore` at 1440 and 390 px wide: the real map
is the default, with London again in its inset; pick an area in the inset;
raise the 3D view and return it flat; press E for equal-size areas
(constituencies only). Check that "Download this view" saves a CSV.

For pipeline or data contract changes, run `pnpm run data:compile`,
`pnpm run data:test` and `pnpm run data:pull -- --local` before step 2, so
the Vitest compiled-release tests and the build use the new release. Run
`uv run ruff check` and `uv run ruff format --check` in `pipeline/`.

For dependency changes, also run
`node .hk-hooks/pnpm-build-scripts-check.mjs`. Record a denial for any new
build script and confirm steps 2 to 5 still pass. Ask the user before
granting `true`.

Deployment and production smoke checks are out of scope here. After an
authorised deploy, request the public routes and require the same responses as
step 6.
