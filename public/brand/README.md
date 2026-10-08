# Brand assets

Served from `/brand/`. No asset shows a person.

| File | Use | Origin |
| --- | --- | --- |
| `monogram.svg` | Favicon and small mark | Drawn in code, same paths as `src/components/Wordmark.tsx` |
| `wordmark.svg` | Monogram plus name, for documents and decks | Drawn in code; text outlined from Bricolage Grotesque (SIL OFL 1.1) |
| `halftone.webp` | Print reference for the derived-value dot screen; the app draws its own in CSS | gpt-image-2 |
| `../favicon.ico` | 16 and 32 px favicon for browsers that skip SVG | `magick` from `monogram.svg` |
| `../apple-touch-icon.png` | 180 px home screen icon on oat paper `#fbf5ec` | `magick` from `monogram.svg`, 64 colours |

The monogram is one coin cut into a half and two quarters: who gets what.
Brass `#c9a35e`, clay `#ce7c56` and verdigris `#428787` are the benefit
family groups' colours and stay fixed in both themes. The share sizes are a
sign, not data.

`wordmark.svg` sets "Who Gets What" in Bricolage Grotesque at weight 700 and
optical size 24, at size 25 in a 32-unit frame with -0.02 em tracking, outlined with
fontTools. Its ink switches with `prefers-color-scheme`: espresso `#2b211c`
on light, `#f7efe6` on dark.

## Prompts

`halftone.webp` came from one gpt-image-2 call at medium or low quality,
then `magick` and `cwebp` for size.

### halftone

> Seamless tileable texture, square 1:1. Offset-print halftone dot screen: a
> regular 45-degree grid of small round ink dots in warm brass #C9A35E on
> plain off-white paper #F4F0E6, dots of equal size, slight natural ink spread
> like magazine print under a loupe. No gradient, no text, no vignette,
> uniform across the whole frame so it tiles cleanly.
