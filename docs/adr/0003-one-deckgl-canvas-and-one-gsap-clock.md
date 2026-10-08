# Draw every data mark on one deck.gl canvas, driven by one GSAP clock

Superseded in part by [ADR 0008](0008-draw-the-explorer-with-deckgl-alone.md):
deck.gl draws without MapLibre. The one canvas and the one clock stand.

Superseded in part by
[ADR 0010](0010-the-film-is-the-home-page-and-plays-like-a-video.md): while
the film plays, the narration's audio clock drives its progress, not scroll.

The explorer and the film draw every area mark on one WebGL2 canvas: deck.gl
9.4 interleaved in MapLibre 6.12 through `MapboxOverlay({ interleaved: true })`.
Map, hex, beeswarm and rank views are layouts of the same marks, keyed by the
level's stable area order. A layer extension mixes `aFrom` and `aTo` positions
in the vertex shader with a uniform `t`. GSAP 3.15 owns `t` and every other
animated value, so there is one clock. Small charts are visx 4 SVG,
prerendered on the server, and figures roll with NumberFlow.

## Consequences

- A view change moves marks; it never remounts them. The eye can follow an
  area through every view.
- Scroll position maps to `t` through ScrollTrigger, so a scrubbed morph
  reverses exactly and a `?frame=` parameter can pin any frame for screenshots.
- The canvas loads as a client-only island. Prerendered pages carry SVG and an
  HTML table, so they work with no WebGL and with motion off.
- The area order is an invariant of every bundle. Bundles carry its hash and
  the parser rejects a mismatch.

## Alternatives considered

- **three.js WebGPURenderer on a second canvas for the film's grains.** The
  handoff between canvases needs a 1 px alignment criterion that the one-canvas
  design does not have. A million grains fit in a deck.gl `ScatterplotLayer` on
  WebGL2 with the same `aFrom`/`aTo` extension.
- **deck.gl on WebGPU.** deck.gl documents it as not production ready, and
  `DataFilterExtension`, `CollisionFilterExtension` and basemap interleaving do
  not run on it.
- **deck.gl `transitions` for morphs.** They run on deck's own timer, so a
  scroll position cannot scrub them, and they would be a second clock beside
  GSAP.
- **CSS scroll-driven animations instead of ScrollTrigger.** Firefox 152 still
  ships them behind a flag.
- **Mosaic, Perspective, uPlot and Observable Plot beside visx.** visx canvas
  or a deck.gl `LineLayer` draws 650 lines, and visx covers the small
  multiples. Each extra engine is one more bundle and one more animation model.
