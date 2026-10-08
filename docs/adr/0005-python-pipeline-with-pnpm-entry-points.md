# Build the data pipeline in Python with uv and DuckDB, run through pnpm scripts

The data pipeline is a Python package in `pipeline/`, managed by uv, using
DuckDB SQL over Parquet for the canonical model. The repository is polyglot,
but every entry point is a `pnpm run data:*` script that calls
`uv run --project pipeline ...`, so one command surface serves people, hooks
and CI. pytest holds the honesty tests. The compiled output is checked against
the JSON Schemas that the TypeScript contract generates in `contract/schema/`.

## Consequences

- `mise.toml` pins Python and uv beside Node and pnpm. uv honours the same
  release-age quarantine as pnpm.
- The TypeScript domain module owns the data contract. The pipeline proves
  conformance with JSON Schema and the shared fixtures in `contract/fixtures/`,
  so neither side re-declares the other's types by hand.
- Two test runners run at commit time: Vitest and pytest.

## Alternatives considered

- **A TypeScript pipeline on Node with `@duckdb/node-api`.** The research
  prototypes that produced the first verified figures were Python: pandas,
  DuckDB, openpyxl for the DWP and Social Security Scotland workbooks, and
  shapely with pyproj for the coastal flag and the data-zone apportionment.
  Porting them would reopen the verification of every number. Supply chain was
  not the reason: `@duckdb/node-api` installs without a lifecycle script.
- **mise tasks as the entry points.** The hk hooks, `AGENTS.md` and Workers
  Builds already run pnpm scripts. A second runner would split the command
  surface for a handful of data commands.
