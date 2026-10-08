/**
 * Mark style bits shared by the morph layer's shader and the SVG fallback.
 * Kept apart from the layer so server code can use them without deck.gl.
 */

/** Apportioned or modelled value: halftone screen (ADR 0004 rule 6). */
export const STYLE_HALFTONE = 1
/** No value for this area: hatched. */
export const STYLE_NO_VALUE = 2
