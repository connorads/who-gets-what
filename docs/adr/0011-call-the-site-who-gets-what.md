# Call the site Who Gets What

The site is called "Who Gets What". It is an independent project and names no
organisation behind it.

The monogram is one coin cut into a half and two quarters, in the brass, clay
and verdigris of the benefit family groups. The wordmark sets the name in
Bricolage Grotesque, the display face, outlined to paths in
`public/brand/wordmark.svg`. The header sets the same name as live text in the
loaded web font.

## Context

- ADR 0004 asks the site to take no side. The name is the first thing a reader
  sees, so it must not set one group against another or imply a cause.
- No organisation runs the site. A name that sounds like a body with members
  would mislead a reader looking for who runs it.
- The site's question is plain: which people and which places receive which
  benefits. "Who gets what" says that in three common words. It is broad
  enough for later data, such as tax by area, without a new name.
- The mark shows one coin shared out, which matches the question.

## Options considered

- **"Benefit Stats" or a similar descriptive name.** Clear, but narrow, and it
  sounds like an official statistics product the site is not.
- **"Who Gets What".** Chosen: plain English, neutral, and a question the data
  answers rather than a stance.

## Consequences

- Every user-facing string, share card, CSV and zip file name, and the
  favicon set use the name and mark.
- Code identifiers use the short form `wgw`: the `wgw_pipeline` package and
  the `wgw-` prefix on storage keys and events.
