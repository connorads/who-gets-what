"""Per-value flag bits, mirroring `ValueFlag` in src/domain/measure.ts."""

APPORTIONED = 1 << 0
MODELLED = 1 << 1
SURVEY = 1 << 2
SUPPRESSED = 1 << 3
PARTIAL_COVERAGE = 1 << 4
HARMONISED = 1 << 5
SMALL_POPULATION = 1 << 6
SERIES_BREAK = 1 << 7

# Flags that describe where a value came from; they carry into any sum or ratio.
PROVENANCE = APPORTIONED | MODELLED | SURVEY | HARMONISED | PARTIAL_COVERAGE
