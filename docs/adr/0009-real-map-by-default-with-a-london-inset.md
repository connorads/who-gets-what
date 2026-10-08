# Open on the real map, with London drawn again in an inset

Supersedes in part
[ADR 0008](0008-draw-the-explorer-with-deckgl-alone.md): the camera fits the
level's bounds with an inset, and the skyline extrudes real shapes instead of
hex columns.

The explorer and the film open on a real geographic map of Great Britain.
Every area is drawn from its own generalised shapes, islands and holes
included, in Web Mercator fitted to the level's bounds. London is drawn a
second time, larger, in an inset: beside Great Britain when the stage is
wide, or over open sea (west of Wales, or the North Sea) on a phone. Hover,
focus and selection work in the inset as on the map.

Equal-size hexagons stay as an optional view, "Equal-size areas", for
constituencies only. The 3D skyline extrudes the real shapes on the map by
the measure on screen; hex columns are gone. The film's two skylines extrude
each area's ring of the reader's shape the same way: real land by default,
prisms on equal-size hexes.

The pipeline precomputes everything the map draws: `shapes.bin` holds every
polygon with its triangles, `map.svg` draws each area for server-rendered
maps, and the areas metadata gives the level's and each region's bounds. The
browser triangulates nothing.

## Context

- Readers found the hexes hard to read as places: a hexagon says nothing
  about where a seat is or how big it is.
- On a real map, about 75 London seats are a few pixels each, and the large
  rural seats of Scotland and Wales dominate the picture.
- The morph needs one fixed-size ring per area, but a 64-point ring is a
  crude coastline, and the geojson's minor parts were triangulated at
  runtime.

## Consequences

- The map at rest draws full shapes; the 64-point rings carry the marks
  between views, and the shapes fade in over them once they land.
- A dense region is legible and selectable at every stage width. The inset
  repeats London's areas, so the same seat appears twice on the map view.
- The no-JavaScript and first-paint view is the real map: one `<use>` per
  area of the sprite keeps the explorer's HTML near its 60 kB budget.
- 3D heights over real shapes exaggerate large areas, so the skyline names
  that in its key, and shows London at the same height scale in the inset.
- Equal-size areas remain one key press away for readers who want every
  constituency to count the same on screen.

## Alternatives considered

- **Keep hexes as the default.** Equal weight per seat, but it hides
  geography and reads as abstract.
- **Zoom and pan instead of an inset.** It needs a controller on a canvas
  that lets the page scroll, and a reader sees one part of the country at a
  time.
- **British National Grid.** Truer shapes at British latitudes, but deck.gl's
  `MapView` is Web Mercator, and changing projection would mean an
  `OrthographicView` and projected boundaries (ADR 0008's rejected option).
- **Insets for other cities.** Birmingham, Manchester and Glasgow seats stay
  legible on the main map at desktop width; more insets would crowd the
  stage.
- **Triangulate in the browser.** earcut over 43,000 vertices is fast, but
  the pipeline already repairs and simplifies the shapes, so it cuts the
  triangles once for every reader.
