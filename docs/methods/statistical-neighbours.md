# Statistical neighbours

Each dossier lists the 15 areas of the same level with the most similar
profile anywhere in Great Britain. The catalogue's `models.neighbours` gives
the count, the feature ids and the method in plain words.

## Profile

| Feature | Measure | Period |
| --- | --- | --- |
| `share-aged-0-15` | Share of residents aged 0 to 15 | mid-2024 |
| `share-aged-66-plus` | Share of residents aged 66 and over | mid-2024 |
| `deprivation-decile` | Decile within the area's own nation (IoD, WIMD, SIMD) | 2025, Scotland 2020 |
| `median-pay` | ln(median annual pay of full-time employees living there) | April 2024 |
| `population-density` | ln(residents per km2 of land) | mid-2024 |

- The share aged 16 to 64 is close to the remainder of the two age shares, so
  it is left out and age counts twice, not three times.
- Land area is ONS `Shape__Area` of the boundary clipped to the coastline
  (`dim_area.area_km2`).
- A decile compares an area with its own nation only, so neighbours match on
  relative deprivation, never on one cross-nation scale.

## Distance

1. Standardise each feature to mean 0 and standard deviation 1 across the
   level's areas.
2. Distance is the Euclidean distance over the features both areas have. When
   one lacks a feature, the sum of squares is scaled by 5 over the number
   compared, so distances stay comparable.
3. List the 15 nearest other areas, nearest first, ties by code. Distances
   are in standard deviations, rounded to 3 decimals.

Areas withheld by ONS for pay list `median-pay` in `missingInputs` and match on
the other four features.

Neighbours share a profile, not a place or a spending level: comparing an
area's spending with its neighbours' is the use, and the site states it as a
comparison.
