# Draw the explorer with deck.gl alone, without a basemap library

Supersedes the MapLibre host in
[ADR 0003](0003-one-deckgl-canvas-and-one-gsap-clock.md). One canvas, one
GSAP clock and the morph layer stand.

Superseded in part by [ADR 0009](0009-real-map-by-default-with-a-london-inset.md):
the camera fits the level's bounds with an inset, and the skyline extrudes
real shapes instead of hex columns.

The explorer canvas is a deck.gl 9.4 `Deck` with one `MapView`, created in
`src/viz/engine/engine.ts`. The engine sets its view state from the camera
that `fitCamera` (`src/viz/layout/projection.ts`) computes, and the camera
never moves except to tilt for the pension skyline. deck.gl creates the one
WebGL2 canvas; no basemap library loads.

The film's engine (`src/viz/engine/film-engine.ts`) follows the same
decision: a `Deck` with one `MapView`, whose view state is the camera pose
the film computes for each frame.

## Context

- The explorer draws no tiles and no third-party style. MapLibre 6 only
  hosted the canvas: it gave deck.gl a WebGL2 context, a camera and a resize
  loop.
- MapLibre was about 270 kB of the 509 kB gzip engine chunk, against a
  450 kB budget ([architecture](../architecture.md#performance)).
- deck.gl 9.4's interleaved overlay read fields that MapLibre 6 builds
  mangle, so the engine carried a shim for `map.transform`.
- MapLibre started its tile worker although it loaded nothing.

## Consequences

- The engine chunk is about 227 kB gzip, inside its budget. The film's
  chunk beyond its route is about 293 kB gzip, from 574 kB.
- Layouts keep their longitude and latitude rings. `projection.ts` uses the
  same Web Mercator maths and 512-pixel tiles as deck.gl's
  `WebMercatorViewport`, so `rings.bin` needs no conversion and the
  skyline's `ColumnLayer` keeps its metre heights and pitched camera.
- Neither canvas has a controller. Both set `touchAction: 'pan-y'`, so a
  reader on a phone scrolls the page over them.
- A tile basemap would need a deck.gl `TileLayer` or a new decision.

## Alternatives considered

- **Keep MapLibre and raise the engine budget.** It pays 270 kB for a host
  that draws nothing, and keeps the `transform` shim.
- **An `OrthographicView` in CSS pixels.** Layouts would skip the
  unprojection, but the boundary rings would need projecting on load and the
  skyline would need its own perspective camera and pixel heights. The
  `MapView` keeps both as they are.
