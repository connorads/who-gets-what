# Publish data as static files compiled at build time, not from a runtime database

The pipeline compiles every number the site shows into static files: one JSON
dossier per area, one binary bundle per metric and denominator, JSON metadata
and Parquet downloads. TanStack Start prerenders pages from them, and client
islands fetch them from Workers static assets. No database answers a request.
The file layout is the data contract, set out in `docs/architecture.md`.

## Context

- The data changes at most monthly. Between releases, every reader gets the
  same answer to the same question.
- The explorer needs 632 constituencies or 350 local authorities, about 20
  metrics and up to 15 fiscal years. That is under 200,000 values, less than
  1 MB as `Float32`.
- About 1,000 area pages are prerendered, so the build needs all the data
  anyway.

## Consequences

- Requests to static assets are free and unlimited on Workers. Worker
  invocations are billed and capped (100,000 a day on the free plan). Data
  traffic never invokes the Worker.
- Each release lives under `/data/{release}/`, so every data URL is immutable
  and cacheable for a year.
- Workers static assets cap a version at 20,000 files of at most 25 MiB each.
  The release must stay inside both limits.
- New metrics need a pipeline release and a site build, not a query change.
- Ad hoc questions ("ask the data", MCP) need a queryable store. That would
  be a separate service and does not change how pages get their numbers.

## Alternatives considered

- **DuckDB-WASM with Mosaic in the browser.** The dataset fits in typed arrays,
  so a SQL engine adds a wasm download on the path to the first chart, against
  a target of a first chart in under 1 s on throttled 4G. Mosaic 0.32 also pins
  a dev build of `@duckdb/duckdb-wasm` (`1.33.1-dev57.0`). DuckDB stays at
  build time.
- **A query API on the Worker backed by D1.** It serves the same answer to
  every request until the next release, while each request counts against
  Worker billing and limits. The prerender needs the data at build time anyway,
  so the database would be a second copy of the same files.
