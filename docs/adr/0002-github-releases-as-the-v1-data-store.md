# Store data releases as GitHub Release assets

The canonical data store for v1 is a set of versioned GitHub Release assets on
this repository. Each data release `{release}` (for example `2026-10-05.1`)
has the tag `data-{release}` and three assets:

- `site-data-{release}.tar.gz`: the compiled `/data/{release}/` tree.
- `canonical-{release}.tar.gz`: the canonical Parquet tables.
- `manifest-{release}.json`: the release manifest, with a SHA-256 per file.

`data.lock.json` at the repository root pins the release the site builds
against, with the SHA-256 of the site asset. `pnpm run data:pull` downloads it
over HTTPS and checks the hash before it extracts anything.

## Consequences

- The repository is public, so pulling a release needs no token: a local
  build, CI and Workers Builds all download it the same way. Publishing a
  release needs `gh`, signed in as the maintainer.
- A data change is a reviewable diff to `data.lock.json`, and a rollback is a
  revert of that diff.
- Release assets are immutable once published. A correction is a new release
  id, never an edited asset.
- GitHub caps each release asset at 2 GiB, far above the expected size.

## Alternatives considered

- **R2 bucket.** It would add a Cloudflare account and credentials to every
  build and to the pipeline; a public release asset needs none. R2 fits
  once the data needs request-level access.
- **Basin Catalog (Iceberg tables on R2).** It depends on R2. Its value,
  versioned tables and revision diffs, serves data-revision diffs, which
  v1 does not ship.
